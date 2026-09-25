# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-09-25

First public beta of the Kalvora SDK. As a 0.x release, APIs may change in
any minor version before 1.0.0.

kalvora.js is derived from the Apache-2.0 zera.js SDK. It is Kalvora-native,
covers the full protocol surface of the current node protobuf definitions,
and hardens signing and submission. The "Changed" and "Removed" sections list
differences from zera.js and its early Kalvora port; see
[docs/guides/coming-from-zera-js.md](./docs/guides/coming-from-zera-js.md).

### Added

- `KalvoraClient` facade with `submit`, `submitAndWait`, cached tip height, and
  `KALVORA_NETWORKS` presets / `resolveNetwork`.
- `KalvoraQueryClient` covering every client-facing `APIService` RPC with
  `bigint` amounts, base58 addresses, and hex hashes; plus
  `getLatestBlockHeight`, `waitForTransaction`, `getBalanceOrZero`,
  `getCurrencyEquivalent`, `getContractSupply`.
- `ValidatorQueryClient` (read-only `ValidatorService`, incl. signed
  `GetCheckpointInfo` / `SyncValidatorList`) and `GuardianQueryClient`.
- Block and result decoders: `summarizeBlock`, `listBlockTransactions`,
  `findTransactionResult`, `partsToWhole`, `formatScaled`.
- Transaction builders (build / create / send) for `MintTXN`, `RevokeTXN`,
  `QuashTXN`, `ComplianceTXN`, `ExpenseRatioTXN`, `AllowanceTXN` (+ revoke
  helper, USD ↔ currency-equivalent conversion), `DelegatedTXN`,
  `ValidatorRegistration` (+ `attachGeneratedSignature`), and
  `ValidatorHeartbeat`; `createTextGovernanceProposalTXN` /
  `sendGovernanceProposalTXN`.
- Shared `buildStandardTransaction` pipeline and `StandardTXNOptions`
  (`safeSend`, interface fees, offline/deterministic construction) with strict
  input parsers.
- `KalvoraRpcError` with the real gRPC status code, `RpcCode`,
  `isKalvoraRpcError`.
- `proto` namespace exposing the generated bindings; `dex` namespace export.
- `npm run proto:sync` / `proto:check` (kalvora-indexer is the source of
  truth), `npm run docs` (TypeDoc), `npm run validate`, `npm run test:live`.
- Guides: getting started, transactions, querying, architecture, migration.

### Changed (from zera.js / the early port)

- **Breaking:** native token is `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao`;
  the network rejects the former `KAL111112` placeholder.
- **Breaking:** `Zera*` identifiers renamed to `Kalvora*`; builder names made
  consistent (`createContractTXN`, `createContractUpdateTXN`, …); see the
  migration guide for the full table. Wire-level names are unchanged.
- **Breaking:** zera.js-style query helpers (`getNonce`, `getBalance`, `getBaseFee`,
  `getExchangeRate`, token-info helpers, `createValidatorAPIClient`) are no
  longer exported; use `createQueryClient()`.
- **Breaking:** staking / bootstrapping / bridge options take
  `feeAmountParts` (smallest units) instead of the misleading `feeAmountUsd`,
  whose value was passed through as raw parts.
- `submitTransaction` and `send*` reject unsigned transactions before any
  network call and always return the real hex hash.
- The build no longer installs packages globally or rewrites sources with
  `eslint --fix`.
- `npm test` is plain vitest with a quiet reporter.

### Fixed

- RPC errors lost their status code (surfaced as `[unknown]`) because
  ConnectRPC re-wraps interceptor exceptions; errors are now normalised at the
  client boundary for every transport.
- `signWithKey` / `signAndFinalize` silently returned an unsigned transaction
  when `base` was missing, and signed over stale signature/hash material when
  re-signing.
- `signCoinTXN` / `signCoinTXNWithKeys` wrote signatures into a detached
  object when `auth` was unset, returning an unsigned (but hashed) CoinTXN.
- `feeAmountParts` is written to `BaseTXN.fee_amount` in canonical form
  (e.g. `' 5 '`/`'007'` previously went on the wire verbatim).
- `ValidatorRegistration` automatic fees now include the generated-key
  signature size.

### Removed (from zera.js / the early port)

- Deprecated aliases (`ZERA_*`, `ZV_*`, `MAINNET_GRPC_CONFIG`,
  `TESTNET_GRPC_CONFIG`, `*ItemMint*`, `*NFTTransfer*`,
  `*SmartContractDeploy*`, Solana `*2022*` aliases).
- Unused dependencies `dotenv`, `bip32` (runtime) and `mocha`, `chai`,
  `chokidar`, `glob`, `minimist` (dev); custom test runners; the legacy
  connectivity test that submitted an empty `CoinTXN`.

