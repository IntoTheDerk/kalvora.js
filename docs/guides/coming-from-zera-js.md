---
title: Coming from zera.js
group: Guides
---

# Coming from zera.js

kalvora.js is derived from the Apache-2.0 [zera.js](https://github.com/zera-os/zera.js) SDK
(see NOTICE). If you know zera.js, or have code written against an early
Kalvora port of it, these are the differences: legacy upstream (`Zera*`) names are gone,
query functions are consolidated into typed clients, and every transaction
module follows the same `build* / create* / send*` naming.

## 1. Native token ID changed

The native KALV token is now
`KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao` (9 decimals). The
placeholder `KAL111112` is rejected by the network as a malformed contract ID.

- Use `KALVORA_NATIVE_TOKEN` instead of hard-coded IDs.
- All builder fee defaults use the new ID automatically.

## 2. Renamed identifiers

| zera.js / early port | kalvora.js |
|---------------------------------------|------------------------------------------|
| `ZeraSigner`                          | `KalvoraSigner`                          |
| `ZeraWalletAdapter`                   | `KalvoraWalletAdapter`                   |
| `ZeraProvider`                        | `KalvoraProvider`                        |
| `ZeraWCSignTransactionResult` (and other `ZeraWC*` types) | `KalvoraWCSignTransactionResult` (…) |
| `ZERA_WC_NAMESPACE`, `ZERA_WC_CHAINS`, `ZERA_WC_METHODS`, `ZERA_WC_EVENTS`, `ZERA_WC_REQUIRED_NAMESPACES` | `KALVORA_WC_*` |
| `ZeraError`                           | `KalvoraError`                           |
| `AnyZeraTransaction`                  | `AnyKalvoraTransaction`                  |
| `generateZeraAddress`                 | `generateKalvoraAddress`                 |
| `generateZeraPublicKeyIdentifier`     | `generateKalvoraPublicKeyIdentifier`     |
| `ZERA_TYPE`, `ZERA_TYPE_HEX`, `ZERA_SYMBOL`, `ZERA_NAME` | `KALVORA_TYPE`, `KALVORA_TYPE_HEX`, `KALVORA_SYMBOL`, `KALVORA_NAME` |
| `ZERA_MAINNET_NETWORK`, `KALVORA_MAINNET_NETWORK` | `KALVORA_PROTONET_NETWORK`   |
| `ZV_PROPOSAL_CONTEXT_SCHEMA`, `ZV_PROPOSAL_POLICY_VERSION` | `KALVORA_PROPOSAL_CONTEXT_SCHEMA`, `KALVORA_PROPOSAL_POLICY_VERSION` |
| `MAINNET_GRPC_CONFIG`, `TESTNET_GRPC_CONFIG` | `PROTONET_GRPC_CONFIG` (or `KALVORA_NETWORKS.protonet.grpc`) |
| `lockZera`, `lockZeraAndSend`         | `lockKalvora`, `lockKalvoraAndSend`      |
| `releaseZera`, `releaseZeraAndSend`   | `releaseKalvora`, `releaseKalvoraAndSend`|
| `bridgeZeraToSol`, `bridgeZeraToSolAndSend` | `bridgeKalvoraToSol`, `bridgeKalvoraToSolAndSend` |
| `BridgeZeraOptions`, `ReleaseZeraOptions` | `BridgeKalvoraOptions`, `ReleaseKalvoraOptions` |
| `guardianBridge.fetchZeraVAA`, `guardianBridge.submitVAAToZera` | `fetchKalvoraVAA`, `submitVAAToKalvora` |

Wire-level identifiers are unchanged: the WalletConnect namespace string is
still `'zera'`, injected providers are still discovered under the same global,
and protobuf package/message names (`zera_txn.CoinTXN`, `ZeraPayload`, …) are
part of the protocol.

## 3. Consistent builder names

Every transaction module is named after its protobuf message and exposes
`build<Msg>` (unsigned), `create<Msg>` (build + sign), and `send<Msg>`.

| zera.js / early port | kalvora.js |
|---------------------------------------|------------------------------|
| `createContract`                      | `createContractTXN`          |
| `sendCreateContract`                  | `sendContractTXN`            |
| `updateContract`                      | `createContractUpdateTXN`    |
| `sendUpdateContract`                  | `sendContractUpdateTXN`      |
| `buildItemMintTXN` / `createItemMintTXN` / `sendItemMintTXN` | `buildItemizedMintTXN` / `createItemizedMintTXN` / `sendItemizedMintTXN` |
| `buildNFTTransferTXN` / `createNFTTransferTXN` / `sendNFTTransferTXN` | `buildNFTTXN` / `createNFTTXN` / `sendNFTTXN` |
| `buildSmartContractDeployTXN` / `createSmartContractDeployTXN` / `sendSmartContractDeployTXN` | `buildSmartContractTXN` / `createSmartContractTXN` / `sendSmartContractTXN` |

## 4. Query functions → query client

The standalone zera.js query helpers are replaced by `KalvoraQueryClient`, which
returns `bigint`s instead of `Decimal`/strings and throws `KalvoraRpcError`.

| zera.js / early port | kalvora.js |
|---------------------------------------|-------------------------------------------------|
| `getNonce(address)` (next nonce, `Decimal`) | `query.getNextNonce(address)` (`bigint`)  |
| `getNonces(addresses)`                | `Promise.all(addresses.map(a => query.getNextNonce(a)))` |
| `getBalance(address, contractId)`     | `query.getBalance(address, contractId)`         |
| `getBalances(...)`                    | `query.getBalance` per token                    |
| `getBaseFee(txnType, publicKey)`      | `query.getBaseFee(txnType, publicKey)`          |
| `getExchangeRate(contractId)`         | `query.getCurrencyEquivalent(contractId)`       |
| `getTokenFeeInfo`, `getTokenInfoForSingle`, `getTokenRate`, `getTokenDenomination`, `isTokenSupported`, `getTokenInfoMap` | `query.getTokenFeeInfo([...])`, `query.getDenomination(id)`, `query.getAuthorizedFeeTokens()` |
| `createValidatorAPIClient`            | `createQueryClient`                             |

```typescript
import { createQueryClient } from 'kalvora.js';
const query = createQueryClient(grpcConfig);
```

## 5. Errors

Failed RPCs throw `KalvoraRpcError` with the real gRPC `code` (`RpcCode`),
`codeName`, `method`, and `detail`. In zera.js and the early port the status code was lost (errors
arrived as `[unknown]`). The message format is unchanged:
`gRPC <Method> failed: [<code>] <detail>`.

## 6. Submission

- `submitTransaction` / `send*` reject unsigned transactions **before** any
  network call, and always return the real hex hash (earlier versions could return the
  string `"Transaction submitted (no hash available)"`).
- `signWithKey` / `signAndFinalize` throw when a transaction has no `base`
  (earlier versions silently produced an unsigned transaction) and discard any previous
  signature/hash before signing.

## 7. Tooling

- `npm test` is plain vitest; the custom test runners were removed.
- `dotenv` and `bip32` are no longer runtime dependencies.
- `npm run proto:check` / `proto:sync` keep protos aligned with kalvora-indexer.

## New in kalvora.js

- `KalvoraClient` with `submitAndWait`, network presets.
- Query clients for `APIService` (all read RPCs), read-only `ValidatorService`,
  and `GuardianService`; block/transaction-result decoders.
- Builders for `MintTXN`, `RevokeTXN`, `QuashTXN`, `ComplianceTXN`,
  `AllowanceTXN`, `DelegatedTXN`, `ExpenseRatioTXN`, `ValidatorRegistration`,
  `ValidatorHeartbeat`, plus `createTextGovernanceProposalTXN` /
  `sendGovernanceProposalTXN`.
- Shared `StandardTXNOptions` on the new builders: `safeSend`, interface fees,
  offline construction.
- `dex` namespace export (previously documented but not exported).
- `proto` namespace with the raw generated protobuf modules.
