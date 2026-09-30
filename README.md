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
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-0a0a0a?style=flat-square" alt="Node.js 20 or later">
  <img src="https://img.shields.io/badge/types-TypeScript-0a0a0a?style=flat-square" alt="TypeScript types included">
</p>

`kalvora.js` is a client SDK for the Kalvora network. It creates and restores
wallets, builds, signs and submits every protocol transaction type, and reads
chain state through typed gRPC-Web clients, from Node.js, browsers and React
Native alike. Keys stay where you put them: sign in-process, or hand the
unsigned bytes to a browser wallet, a WalletConnect session, a hardware device
or any signer you write.

> **Alpha.** The version is `0.0.x`, and any release may change any API. Pin an
> exact version (`npm install kalvora.js@0.0.1-alpha.1`), test on protonet
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
| **Wallets** | BIP-39 mnemonics, HD derivation (standard SLIP-0010 for Ed25519, Kalvora's own scheme for Ed448), addresses and public key identifiers. Available on its own as `kalvora.js/wallet`, with no network code. |
| **Transactions** | Typed `build → sign → send` for every protocol transaction type: coin transfers, minting, contracts, items (NFT/SBT), governance proposals and votes, allowances, delegated voting, compliance, quash/revoke, expense ratios, smart contracts and validator operations. |
| **Queries** | `KalvoraQueryClient` for every client-facing read RPC (balances, nonces, contracts, fees, supply, blocks, proposals, smart-contract events), plus validator and guardian clients. Amounts are `bigint`s; failures are structured `KalvoraRpcError`s. |
| **Workflows** | `KalvoraClient.submitAndWait`, offline and deterministic building, external signers, wallet adapters (injected provider, deep links, WalletConnect v2). |
| **Use cases** | Staking, validator bootstrapping, DEX pools and swaps, the Kalvora ↔ Solana bridge, and an indexer-backed smart swap. |
| **Runtime** | ConnectRPC gRPC-Web over `fetch`, HTTPS by default. ESM and CommonJS builds with bundled type declarations. |

## Install

```bash
npm install kalvora.js
```

Requires Node.js 20 or later, a modern browser, or React Native. The Solana
bridge helpers use the optional dependencies `@solana/web3.js` and
`@solana/spl-token`; everything else works without them.

## Quick start

Create a wallet, check its balance, and send a transfer that waits for block
inclusion:

```typescript
import {
  KalvoraClient,
  createWallet,
  generateMnemonicPhrase,
  createCoinTXN,
  partsToWhole,
  KEY_TYPE,
  KALVORA_NATIVE_TOKEN
} from 'kalvora.js';

// 1. Wallet: standard Kalvora address (base58 of the raw public key)
const wallet = await createWallet({
  keyType: KEY_TYPE.ED25519,
  mnemonic: generateMnemonicPhrase(24)
});

// 2. Network: protonet over HTTPS by default
const kalvora = new KalvoraClient();
const { balance, denomination } = await kalvora.query.getBalanceOrZero(wallet.address, KALVORA_NATIVE_TOKEN);
console.log(`${partsToWhole(balance, denomination)} KALV`);

// 3. Build and sign a transfer (whole-token amounts), then wait for inclusion
const txn = await createCoinTXN(
  [{ publicKey: wallet.publicKey, privateKey: wallet.privateKey, amount: '1.5' }],
  [{ to: recipientAddress, amount: '1.5' }],
  KALVORA_NATIVE_TOKEN,
  { baseFeeId: KALVORA_NATIVE_TOKEN },
  '',
  kalvora.grpcConfig
);
const result = await kalvora.submitAndWait(txn);
console.log(result.success ? `included in block ${result.blockHeight}` : result.statusName);

wallet.secureClear(); // wipe key material when you are done
```

`submitAndWait` resolves once the transaction is in a block; check
`result.success`, because inclusion does not mean the transaction succeeded.

## Wallets and keys

### Mnemonics and wallets

```typescript
import {
  createWallet,
  deriveMultipleWallets,
  generateMnemonicPhrase,
  validateMnemonicPhrase,
  KEY_TYPE
} from 'kalvora.js';

const mnemonic = generateMnemonicPhrase(24);        // 12, 15, 18, 21 or 24 words
validateMnemonicPhrase(mnemonic);                   // true

const wallet = await createWallet({
  keyType: KEY_TYPE.ED25519,                        // or KEY_TYPE.ED448
  mnemonic,
  passphrase: '',                                   // optional BIP-39 passphrase
  hdOptions: { accountIndex: 0 }                    // m/44'/5258'/0'/0'/0'
});

wallet.address;         // base58 address
wallet.publicKey;       // public key identifier (A_… for Ed25519, B_… for Ed448)
wallet.privateKey;      // base58 private key — keep secret
wallet.derivationPath;  // "m/44'/5258'/0'/0'/0'"

// Several accounts from one mnemonic (the seed is computed once)
const accounts = await deriveMultipleWallets({ keyType: KEY_TYPE.ED25519, mnemonic, count: 5 });
```

Leave `hashTypes` unset (or pass `[]`) for the standard address. Passing hash
types produces a legacy hashed address format.

### Raw keys

`deriveHDPrivateKey` returns only the 32-byte key at a path and zeroes every
intermediate node:

```typescript
import { deriveHDPrivateKey, generateSeed, KEY_TYPE, SLIP0010_DERIVATION_PATH } from 'kalvora.js/wallet';

const seed = generateSeed(mnemonic);
const key = deriveHDPrivateKey(seed);                                       // Ed25519, m/44'/5258'/0'/0'/0'
const key448 = deriveHDPrivateKey(seed, SLIP0010_DERIVATION_PATH, KEY_TYPE.ED448);
try {
  // use the keys
} finally {
  key.fill(0);
  key448.fill(0);
  seed.fill(0);
}
```

### Lightweight entry: `kalvora.js/wallet`

`kalvora.js/wallet` exports the wallet surface on its own (mnemonics, HD
derivation, key pairs, address encoding). It depends only on `@noble/curves`,
`@noble/hashes`, `bip39` and `bs58`, contains no network, protobuf or
transaction code, and never touches the network, which makes it a good fit for
a browser custody layer. It is ESM-only; CommonJS callers use the main entry,
which exports the same functions.

### Derivation

Ed25519 derivation is exactly
[SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md), so
any SLIP-0010 wallet derives the same Ed25519 key from the same mnemonic and
path. No standard covers Ed448, so Ed448 uses Kalvora's own scheme. The
byte-level specification and reference vectors are in
[docs/guides/hd-derivation.md](./docs/guides/hd-derivation.md).

## Querying the network

`KalvoraClient` bundles the query clients behind one endpoint configuration:

```typescript
import { KalvoraClient, isKalvoraRpcError, RpcCode } from 'kalvora.js';

const kalvora = new KalvoraClient();                 // or { grpc: { endpoint: 'https://my-node.example' } }

await kalvora.query.getNextNonce(address);           // bigint
await kalvora.query.getBalance(address, contractId); // { balance, denomination, rate }
await kalvora.query.getContract(contractId);         // { contract, timestamp, validatorPublicKey }
await kalvora.query.getContractSupply(contractId);   // { maxSupply, currentSupply }
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
import { buildMintTXN, buildCoinTXN, signAndFinalize, signCoinTXN, KeyPairSigner } from 'kalvora.js';

const signer = new KeyPairSigner(wallet.publicKey, wallet.privateKey);

// Mint: amounts in smallest units; nonce + feeAmountParts make it fully offline
const mint = await buildMintTXN(
  { contractId, amount: 5_000_000_000n, recipientAddress, publicKey: signer.publicKey },
  { nonce: 12n, feeAmountParts: '1000' }
);
await kalvora.submit(await signAndFinalize(mint, signer));

// Coin transfer: whole-token amounts
const transfer = await buildCoinTXN(
  [{ publicKey: signer.publicKey, amount: '2' }],
  [{ to: recipientAddress, amount: '2' }],
  KALVORA_NATIVE_TOKEN,
  { baseFeeId: KALVORA_NATIVE_TOKEN },
  '',
  kalvora.grpcConfig
);
await kalvora.submitAndWait(await signCoinTXN(transfer, [signer]));
```

`CoinTXN` amounts are whole tokens (`'1.5'`) that the SDK converts with the
token's denomination; the other builders take smallest units and never need a
denomination lookup (convert with `toSmallestUnits`). The
[transactions guide](./docs/guides/transactions.md) lists every type, the
permission its signer needs, and the shared options.

## Wallet adapters and external signers

Any object with a `publicKey` and an async `sign(bytes)` is a `KalvoraSigner`,
so hardware wallets, MPC services and cold storage plug straight into
`signAndFinalize`:

```typescript
import type { KalvoraSigner } from 'kalvora.js';

const signer: KalvoraSigner = {
  publicKey: 'A_…',
  sign: bytes => myHardwareWallet.sign(bytes) // 64-byte Ed25519 or 114-byte Ed448 signature
};
```

In the browser, `KalvoraWalletAdapter` connects to a Kalvora wallet and gives
you a signer. Inside a wallet's dApp browser it uses the injected provider
(`window[KALVORA_INJECTED_PROVIDER_KEY]`); in an external browser it falls back
to a deep-link round trip (`KALVORA_DEFAULT_DEEP_LINK`):

```typescript
import { KalvoraWalletAdapter, buildVoteTXN, signAndFinalize, sendVoteTXN, PROTONET_GRPC_CONFIG } from 'kalvora.js';

const adapter = new KalvoraWalletAdapter();
adapter.on('connect', info => console.log('connected', info)); // { publicKey, address, mode }
await adapter.connect();

const vote = await buildVoteTXN(contractId, proposalHash, adapter.publicKey!, {
  support: true,
  grpcConfig: PROTONET_GRPC_CONFIG
});
await sendVoteTXN(await signAndFinalize(vote, adapter.signer!), PROTONET_GRPC_CONFIG);
```

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
| HD path | `m/44'/5258'/account'/change'/address'` (SLIP-44 coin type `5258`, every segment hardened; [derivation spec](./docs/guides/hd-derivation.md)) |
| Protobuf packages | `kal_txn`, `kal_api`, `kal_validator` (official Kalvora protos); `kal_guardian` (bridge guardian service) |

## Documentation

| Guide | Covers |
|-------|--------|
| [Getting started](./docs/guides/getting-started.md) | Wallets, connecting, sending, external signers, errors |
| [HD derivation](./docs/guides/hd-derivation.md) | Exact key derivation for Ed25519 (SLIP-0010) and Ed448, reference vectors |
| [Transactions](./docs/guides/transactions.md) | Every transaction type, required permissions, shared options |
| [Querying](./docs/guides/querying.md) | Query clients, blocks, results, events, guardian payloads, raw access |
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
| `kalvora.js/wallet` | Wallets and keys only: mnemonics, HD derivation, key pairs, addresses. No network or protobuf code | ESM, types |

Every public API is exported from one of these two entry points; deep imports
into `dist/` are not supported.

## Stability

| Area | Status |
|------|--------|
| Wallets, key derivation, signing | Ed25519 derivation is SLIP-0010 and pinned by the official test vectors; Ed448 derivation is pinned by Kalvora vectors |
| Transaction builders (`build*` / `create*` / `send*`) | Alpha: shapes may still change in any release |
| Query clients (`KalvoraQueryClient`, validator, guardian) | Alpha: verified read-only against a protonet node |
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
- **Wipe key material.** Call `wallet.secureClear()` when a wallet object is
  no longer needed, and zero raw keys and seeds (`key.fill(0)`) after use.
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
