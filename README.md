<p align="center">
  <strong>kalvora.js</strong>
</p>

<p align="center">
  The TypeScript SDK for the Kalvora network
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kalvora.js"><img src="https://img.shields.io/npm/v/kalvora.js?style=flat-square&color=0a0a0a" alt="npm version"></a>
  <img src="https://img.shields.io/badge/status-alpha-red?style=flat-square" alt="status: alpha">
  <a href="https://github.com/intothederk/kalvora.js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0a0a0a?style=flat-square" alt="Apache-2.0 license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020.19-0a0a0a?style=flat-square" alt="Node.js 20.19 or later">
  <img src="https://img.shields.io/badge/types-TypeScript-0a0a0a?style=flat-square" alt="TypeScript types included">
</p>

`kalvora.js` is a client SDK for the Kalvora network. It creates and restores
wallets, builds, signs and submits every protocol transaction type, and reads
chain state through typed gRPC-Web clients. Keys stay where you put them: sign in-process, or hand the
unsigned bytes to a browser wallet, a WalletConnect session, a hardware device
or any signer you write.

> **Alpha.** The version is `0.0.x`, and any release may change any API. Pin an
> exact release or reviewed commit, test on protonet
> before anything touches real funds, and please
> [report issues](https://github.com/IntoTheDerk/kalvora.js/issues).

## Contents

- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [Wallets and keys](#wallets-and-keys)
- [Querying the network](#querying-the-network)
- [Building, signing and submitting transactions](#building-signing-and-submitting-transactions)
- [Wallet adapters and external signers](#wallet-adapters-and-external-signers)
- [Network facts](#network-facts)
- [Documentation](#documentation)
- [Entry points](#entry-points)
- [Stability](#stability)
- [Development](#development)
- [Security notes](#security-notes)
- [License](#license)

## Features

| | |
|---|---|
| **Wallets** | Falcon-512 and Falcon-1024, independent address hash selection and restorable key backups. Available on its own as `kalvora.js/wallet`, with no network code. |
| **Transactions** | Typed `build → sign → send` for every protocol transaction type: coin transfers, minting, contracts, items (NFT/SBT), governance proposals and votes, allowances, delegated voting, compliance, revoke, expense ratios, smart contracts and validator operations. |
| **Queries** | `KalvoraQueryClient` for every client-facing read RPC (balances, nonces, contracts, fees, supply, blocks, proposals, smart-contract events), plus validator and guardian clients. Amounts are `bigint`s; failures are structured `KalvoraRpcError`s. |
| **Workflows** | `KalvoraClient.submitAndWait`, offline and deterministic building, external signers, wallet adapters (injected provider, deep links, WalletConnect v2). |
| **Use cases** | Staking, validator bootstrapping, DEX pools and swaps, the Kalvora ↔ Solana bridge, and an indexer-backed smart swap. |
| **Runtime** | ConnectRPC gRPC-Web over `fetch`, HTTPS by default. ESM and CommonJS builds with bundled type declarations. |

## Install

```bash
npm install kalvora.js
```

Use Node.js 20.19 or later for the SDK toolchain. Falcon signing requires a cryptographically secure random source in the target runtime. The Solana
bridge helpers use the optional dependencies `@solana/web3.js` and
`@solana/spl-token`; everything else works without them.

## Quick start

Obtain the network name, final block-zero hash and endpoints from the operator. Generate a Falcon wallet, protect its backup, and prefund its receiving address with enough native KALV to register.

```typescript
import { FalconWallet, KalvoraClient, pinNetwork, buildWalletRegistration, signAndFinalize } from 'kalvora.js';

const network = pinNetwork('protonet', 'kal_proto', trustedFinalGenesisHash);
const wallet = FalconWallet.generate({ networkName: 'kal_proto', genesisHash: trustedFinalGenesisHash });
await saveToProtectedStorage(wallet.exportBackup());
console.log(wallet.walletAddress); // Receiving address for prefunding

const client = new KalvoraClient({ network, grpc: { endpoint: trustedEndpoint, trustedOperatorAddress } });
const registration = await buildWalletRegistration(wallet, { grpcConfig: client.grpcConfig });
await signAndFinalize(registration, wallet);
const receipt = await client.submitAndWait(registration, { verifyFinalizedBlock });
if (!receipt.success) throw new Error(receipt.statusName);
```

Supply `verifyFinalizedBlock` from your application's trusted finalized source. If registration finalizes at height H, the wallet can spend at H+1. After an ambiguous submission, reconcile the original hash, committed nonce and signing-wallet record before retrying identical signed bytes. A new Falcon signature can change the transaction hash.

See the [migration overview and remaining acceptance checks](./docs/protocol-migration-overview-2026-11-25.md).

## Wallets and keys

### Fresh-genesis wallets

The wallet-only entry point exports `FalconWallet`, the two padded Falcon variants and all eleven hash choices. `FalconWallet.restore(backup)` restores the key with its selected address and network pin. BLAKE3-256 is the default. A different hash for the same key creates a separate address, balance and nonce.

Historical Ed25519 and Ed448 backups use the [older HD derivation scheme](./docs/guides/hd-derivation.md). Generate and register a fresh Falcon address for the new genesis. See [wallet creation and backup](./src/wallet-creation/README.md).

## Querying the network

`KalvoraClient` bundles the query clients behind one endpoint configuration:

```typescript
import { KalvoraClient, isKalvoraRpcError, RpcCode } from 'kalvora.js';

const kalvora = new KalvoraClient();                 // or { grpc: { endpoint: 'https://my-node.example' } }

await kalvora.query.getNextNonce(address);           // bigint
await kalvora.query.getBalance(address, contractId); // { balance, denomination, rate }
await kalvora.query.getContract(contractId);         // { contract, timestamp, validatorPublicKey }
await kalvora.query.getContractSupply(contractId);   // { maxSupply, currentSupply, circulation }
await kalvora.getLatestBlockHeight();                // bigint, cached height hint

try {
  await kalvora.query.getBalance(address, contractId);
} catch (error) {
  if (isKalvoraRpcError(error) && error.code === RpcCode.NotFound) {
    // the wallet never held this token (getBalanceOrZero returns 0n instead)
  }
}
```

Standalone clients are available too: `createQueryClient`,
`createValidatorQueryClient` and `createGuardianQueryClient`. Block and result
decoders (`summarizeBlock`, `listBlockTransactions`, `findTransactionResult`)
turn raw blocks into plain values. See the
[querying guide](./docs/guides/querying.md).

## Building, signing and submitting transactions

Every transaction type has three functions:

| Step | Function | Does |
|---|---|---|
| build | `build<Txn>(…)` | Validates input, resolves nonce and fees, returns the **unsigned** protobuf message |
| create | `create<Txn>(…)` | `build` plus signing with a private key |
| send | `send<Txn>(txn, grpcConfig)` | Submits a **signed** message and returns the hex hash |

Keep the key out of the builder by signing separately. Single-signer
transactions use `signAndFinalize`; multi-input coin transfers use
`signCoinTXN`:

```typescript
import { buildMintTXN, buildCoinTXN, signAndFinalize, signCoinTXN } from 'kalvora.js';

const signer = wallet; // Registered Falcon wallet from the quick start

// Mint: amounts in smallest units; nonce + feeAmountParts make it fully offline
const mint = await buildMintTXN(
  { contractId, amount: 5_000_000_000n, recipientAddress, publicKey: signer.walletAddress },
  { grpcConfig: client.grpcConfig }
);
await client.submit(await signAndFinalize(mint, signer));

// Coin transfer: whole-token amounts
const transfer = await buildCoinTXN(
  [{ publicKey: signer.walletAddress, amount: '2' }],
  [{ to: recipientAddress, amount: '2' }],
  KALVORA_NATIVE_TOKEN,
  { baseFeeId: KALVORA_NATIVE_TOKEN },
  '',
  client.grpcConfig
);
await client.submitAndWait(await signCoinTXN(transfer, [signer]));
```

`CoinTXN` amounts are whole tokens (`'1.5'`) that the SDK converts with the
token's denomination; the other builders take smallest units and never need a
denomination lookup (convert with `toSmallestUnits`). The
[transactions guide](./docs/guides/transactions.md) lists every type, the
permission its signer needs, and the shared options.

## Wallet adapters and external signers

An injected provider or deep link identifies the selected account by its registered address and Falcon public key. Pass the trusted wire chain ID when creating the adapter. Build transactions with the selected address and pass the adapter's signer to `signAndFinalize` or `signCoinTXN`.

For a wallet on another device, `WalletConnectSigner` signs through a
WalletConnect v2 session negotiated with `KALVORA_WC_REQUIRED_NAMESPACES`. The
strings shared with wallet apps are exported as constants
(`KALVORA_PROVIDER_METHODS`, `KALVORA_DEEP_LINK_PARAMS`,
`KALVORA_WC_NAMESPACE`, …), so you never hard-code them. See the
[wallet adapter guide](./docs/adapter-integration-guide.md).

## Network facts

| | |
|---|---|
| Native token | `KALVORA_NATIVE_TOKEN` = `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao` (KALV, 9 decimals) |
| Default endpoint | `https://kal-proto.visiondynamics.ch` (gRPC-Web over HTTPS, port 443; `KALVORA_PROTONET_ENDPOINT`) |
| Network preset | `KALVORA_NETWORKS.protonet` (the `KalvoraClient` default) |
| Historical Ed HD path | `m/44'/5258'/account'/change'/address'` (SLIP-44 coin type `5258`, every segment hardened). See the [derivation spec](./docs/guides/hd-derivation.md). |
| Protobuf packages | `kal_txn`, `kal_api`, `kal_validator` (official Kalvora protos); `kal_guardian` (bridge guardian service) |

## Documentation

| Guide | Covers |
|-------|--------|
| [Getting started](./docs/guides/getting-started.md) | Wallets, connecting, sending, external signers, errors |
| [HD derivation](./docs/guides/hd-derivation.md) | Exact key derivation for Ed25519 (SLIP-0010) and Ed448, reference vectors |
| [Transactions](./docs/guides/transactions.md) | Every transaction type, required permissions, shared options |
| [Contract IDs](./docs/guides/contract-ids.md) | Checksummed Base58 ids, genesis ids, deriving an id while creating a contract |
| [Querying](./docs/guides/querying.md) | Query clients, blocks, results, events, guardian payloads, raw access |
| [Proposals](./src/proposal/README.md) | Text proposals and proposals that execute a coin transfer |
| [Architecture](./docs/guides/architecture.md) | Layers, transport, signing, protocol sync, tests |
| [Wallet adapters](./docs/adapter-integration-guide.md) | Injected wallets, deep links, WalletConnect, protocol constants |
| [CHANGELOG](./CHANGELOG.md) | Every release, with breaking changes marked |

Every module also has a `README.md` next to its source, and every public
function carries TSDoc. Generate the API reference with `npm run docs`
(output in `docs/api/`).

## Entry points

| Import | Contents | Formats |
|---|---|---|
| `kalvora.js` | The full SDK: client, queries, wallets, signing, every transaction builder, adapters, use cases, raw protobuf bindings (`proto`) | ESM, CommonJS, React Native, types |
| `kalvora.js/wallet` | Offline Falcon keys, address selection, signing, backup and restore, plus historical Ed mnemonic and HD derivation tools | ESM, types |

Every public API is exported from one of these two entry points; deep imports
into `dist/` are not supported.

## Stability

| Area | Status |
|------|--------|
| Wallets and signing | Fresh-genesis Falcon addresses and registration proofs are tested against the validator vectors. Historical Ed derivation has separate test vectors. |
| Transaction builders (`build*` / `create*` / `send*`) | Alpha: shapes may still change in any release |
| Query clients (`KalvoraQueryClient`, validator, guardian) | Alpha. Fresh-genesis registry, receipt and governance reads have in-memory RPC coverage. Live rehearsal is pending. |
| Wallet adapters | Alpha: protocol constants are fixed; the adapter API may change |
| Use cases (`staking`, `bootstrapping`, `dex`, bridge, `smartSwap`) | Experimental: depend on contract deployments that may differ per network |
| Wire protocol (`proto`) | Mirrors the official protobuf definitions; changes when the protocol does |

Breaking changes are listed in the [CHANGELOG](./CHANGELOG.md).

## Development

```bash
npm install
npm run proto:install      # protobuf toolchain (buf, protoc-gen-es)
npm run build:proto        # generate proto/generated from proto/*.proto
npm run validate           # type-check + lint + tests
npm run build              # dist/ (ESM, CJS bundle, types) + bundle validation
```

| Script | Purpose |
|--------|---------|
| `npm run type-check` / `lint` / `lint:fix` | TypeScript and ESLint |
| `npm test` / `test:watch` / `test:coverage` | Offline unit tests (vitest) |
| `npm run test:live` | Read-only checks against a node; set `KALVORA_LIVE_ENDPOINT` |
| `npm run docs` | TypeDoc API reference in `docs/api/` |
| `npm run proto:check` | Maintainers: fail if `proto/` differs from the official protos (`--source <dir>` or `KALVORA_PROTO_SOURCE`) |
| `npm run proto:sync` | Maintainers: copy the official protos verbatim (then `build:proto`) |

Generated protobuf output and build output are git-ignored. Unit tests never
touch the network: builders run with an explicit `nonce` and `feeAmountParts`,
and RPC code runs against ConnectRPC's in-memory transport.

## Security notes

- **Never put keys in URLs or logs.** Private keys, mnemonics and seeds do not
  belong in query strings, analytics, error reports or console output. The
  SDK's logger redacts known secret fields, but it cannot protect values you
  log yourself.
- **Protect backups.** A Falcon backup contains the unencrypted secret key. Store it in the wallet's protected key store and clear any caller-owned raw key or seed buffers after use.
- **HTTPS only.** The transport uses HTTPS on port 443 and never silently
  downgrades to HTTP. `fallbackToHttp` works only for loopback and private
  development hosts, and endpoint URLs with embedded credentials are rejected.
- **Prefer external signers.** In dApps, let the user's wallet sign through
  `KalvoraWalletAdapter` or WalletConnect so private keys never enter your
  page. Deep-link callbacks are accepted only for a live request this page
  started, and a returned address must match the wallet's public key.
- **Test on protonet first**, and pin an exact SDK version in production.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE) for attribution.
