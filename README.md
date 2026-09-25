<p align="center">
  <strong>kalvora.js</strong>
</p>

<p align="center">
  The TypeScript SDK for the Kalvora network
</p>

<p align="center">
  <a href="https://github.com/intothederk/kalvora.js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0a0a0a?style=flat-square" alt="Apache-2.0 license"></a>
  <a href="https://www.npmjs.com/package/kalvora.js"><img src="https://img.shields.io/npm/v/kalvora.js?style=flat-square&color=0a0a0a" alt="npm version"></a>
  <img src="https://img.shields.io/badge/status-beta-orange?style=flat-square" alt="status: beta">
</p>

> **Beta.** kalvora.js is under active development alongside the Kalvora
> network. While the version is `0.x`, APIs may change in any minor release,
> and the network itself (endpoints, contract deployments) is still evolving.
> Pin an exact version,
> test against protonet before anything touches real funds, and please
> [report issues](https://github.com/IntoTheDerk/kalvora.js/issues).

`kalvora.js` gives Kalvora applications everything needed to talk to the
network from Node.js, browsers, and React Native:

- **Wallets** — BIP-39 mnemonics, SLIP-0010 HD derivation (Ed25519 / Ed448), addresses.
- **Transactions** — typed `build → sign → send` for every protocol transaction
  type: coin transfers, minting, contracts, items (NFT/SBT), governance,
  allowances, delegated voting, compliance, quash/revoke, expense ratios,
  smart contracts, and validator operations.
- **Queries** — typed clients for every read RPC (balances, nonces, contracts,
  fees, supply, blocks, proposals, smart-contract events), with `bigint`
  amounts and structured `KalvoraRpcError`s.
- **Workflows** — `KalvoraClient.submitAndWait`, offline/deterministic
  building, external signers, wallet adapters (injected, deep link,
  WalletConnect), and staking / DEX / bridge / smart-swap helpers.

## Install

```bash
npm install kalvora.js
```

Requires Node.js ≥ 20 (or any modern browser / React Native runtime).

## Quick start

```typescript
import {
  KalvoraClient,
  createWallet,
  generateMnemonicPhrase,
  createCoinTXN,
  KEY_TYPE,
  HASH_TYPE,
  KALVORA_NATIVE_TOKEN
} from 'kalvora.js';

// 1. Wallet
const wallet = await createWallet({
  keyType: KEY_TYPE.ED25519,
  hashTypes: [HASH_TYPE.SHA3_256],
  mnemonic: generateMnemonicPhrase(24)
});

// 2. Network (protonet over HTTPS by default)
const kalvora = new KalvoraClient();
const { balance, denomination } = await kalvora.query.getBalance(wallet.address, KALVORA_NATIVE_TOKEN);

// 3. Build + sign a transfer, then wait for block inclusion
const txn = await createCoinTXN(
  [{ publicKey: wallet.publicKey, privateKey: wallet.privateKey, amount: '1.5' }],
  [{ to: recipient, amount: '1.5' }],
  KALVORA_NATIVE_TOKEN,
  { baseFeeId: KALVORA_NATIVE_TOKEN },
  '',
  kalvora.grpcConfig
);
const result = await kalvora.submitAndWait(txn);
console.log(result.success ? `included in block ${result.blockHeight}` : result.statusName);
```

## Documentation

| Guide | Covers |
|-------|--------|
| [Getting started](./docs/guides/getting-started.md) | Wallets, connecting, sending, external signers, errors |
| [Transactions](./docs/guides/transactions.md) | Every transaction type, required permissions, shared options |
| [Querying](./docs/guides/querying.md) | Query clients, blocks, results, events, raw access |
| [Architecture](./docs/guides/architecture.md) | Transport, signing, fees, protocol sync, tests |
| [Coming from zera.js](./docs/guides/coming-from-zera-js.md) | Name and API differences from the zera.js SDK |
| [Wallet adapters](./docs/adapter-integration-guide.md) | Injected wallets, deep links, WalletConnect |

Every module also has a `README.md` next to its source, and every public
function carries TSDoc. Generate the API reference with `npm run docs`
(output in `docs/api/`).

## Network facts

| | |
|---|---|
| Native token | `KALVORA_NATIVE_TOKEN` = `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao` (KALV, 9 decimals) |
| Default endpoint | `https://kal-protonet.visiondynamics.ch` (gRPC-Web, HTTPS only by default) |
| HD path | `m/44'/5258'/account'/change'/address'` (coin type `5258`, all hardened) |
| Wire packages | `zera_txn`, `zera_api`, `zera_validator`, `zera_guardian` (protocol names, unchanged) |

The SDK never silently downgrades to HTTP. The WalletConnect namespace string
remains `zera` for wire compatibility until a Kalvora wallet standard exists.

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
| `npm run proto:check` | Maintainers: fail if `proto/` differs from the protocol source checkout (`KALVORA_PROTO_SOURCE`) |
| `npm run proto:sync` | Maintainers: copy protos from the protocol source (then `build:proto`) |
| `npm test` / `test:watch` / `test:coverage` | Offline unit tests (vitest) |
| `npm run test:live` | Read-only checks against a node; set `KALVORA_LIVE_ENDPOINT` |
| `npm run docs` | TypeDoc API reference |

Generated protobuf output and build output are git-ignored.

## Stability

| Area | Status |
|------|--------|
| Wallets, key derivation, signing | Stable API; covered by deterministic test vectors |
| Transaction builders (`build*` / `create*` / `send*`) | Beta: shapes may still change before 1.0.0 |
| Query clients (`KalvoraQueryClient`, validator, guardian) | Beta: verified read-only against a live node |
| Use cases (`staking`, `bootstrapping`, `dex`, bridge, `smartSwap`) | Experimental: depend on contract deployments that may differ per network |
| Wire protocol (`proto`) | Mirrors the node's protobuf definitions; changes when the protocol does |

Breaking changes are listed in the [CHANGELOG](./CHANGELOG.md).

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE) for attribution.
