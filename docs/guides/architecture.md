---
title: Architecture
group: Guides
---

# Architecture

The SDK builds and signs protobuf messages for the fresh-genesis Kalvora protocol, submits them over gRPC-Web, and reads finalized wallet, transaction and governance state.

## Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ KalvoraClient (src/client)            network presets, submitAndWait │
├───────────────────────────────┬──────────────────────────────────────┤
│ Transaction builders          │ Query clients (src/query)            │
│ src/<txn-type>/  build/create/│ KalvoraQueryClient    APIService     │
│ send  (coin, mint, vote, …)   │ ValidatorQueryClient  ValidatorSvc   │
│                               │ GuardianQueryClient   GuardianSvc    │
├───────────────────────────────┴──────────────────────────────────────┤
│ shared/tx/standard  BaseTXN envelope, nonce, fees, input parsing     │
│ shared/fee-calculators  base / contract / interface fee computation  │
│ sign/  registered single-key and policy proofs, sponsor, signed hash │
├──────────────────────────────────────────────────────────────────────┤
│ grpc/  createClient (gRPC-Web transport, Envoy paths, KalvoraRpcError)│
├──────────────────────────────────────────────────────────────────────┤
│ proto/generated  protobuf-es v2 bindings (txn, api, validator, guardian)│
└──────────────────────────────────────────────────────────────────────┘
```

- **Builders** live in transaction-specific modules such as `src/mint` and `src/allowance`. A typical module offers three operations.
  - `buildXTXN(input, options)` — unsigned protobuf message (may query the
    network for nonce and fees),
  - `createXTXN(input, signer, options)` — build and sign with a registered wallet,
  - `sendXTXN(txn, grpcConfig)` — submit, returns the hex hash.
- **Query clients** turn protobuf responses into plain values (`bigint`
  amounts, base58 addresses, hex hashes, `Date`s) and throw
  `KalvoraRpcError` on failure.
- **Wallets** hold a Falcon key and a selected address hash. A policy wallet binds permanent member slots and signing rules to its own address. A finalized registration maps each address to its signing identity.
- **`KalvoraClient`** ties one endpoint configuration to query clients, submission and matching receipts. Applications supply their trusted chain ID and a finality verifier.

## Transport

The SDK uses the ConnectRPC binary gRPC-Web transport over `fetch`. Node.js requires 20.19 or later. The standalone Falcon wallet was exercised in Node.js 24 and Microsoft Edge. React Native wallet and provider integrations require runtime-specific verification.

Kalvora nodes sit behind Envoy, which exposes short paths instead of the fully
qualified protobuf service names. `createClient` rewrites request URLs
accordingly:

| Protobuf service                 | HTTP path prefix |
|----------------------------------|------------------|
| `kal_api.APIService`             | `/api/`          |
| `kal_txn.TXNService`             | `/txn/`          |
| `kal_validator.ValidatorService` | `/validator/`    |
| `kal_guardian.GuardianService`   | `/guardian/`     |

The protobuf package names come from the official Kalvora protos
(`kal_txn`, `kal_validator`, `kal_api`) and the bridge guardian proto
(`kal_guardian`); the SDK names the guardian's Kalvora-side identifiers
`NETWORK_TYPE_KALVORA` and `KalvoraGuardian*Payload`.
The short `/api/`,
`/txn/`, `/validator/` and `/guardian/` prefixes are Envoy route aliases: Envoy
rewrites them to the fully qualified `/<package>.<Service>/<Method>` path, so
the Envoy routes of a node must target the same package names as this SDK. A
caller-supplied `transport` bypasses the rewrite and sends the fully qualified
path directly.

### Security defaults

- HTTPS on port 443 is the default. The SDK never silently downgrades to HTTP.
- `fallbackToHttp` only works for loopback/private development hosts.
- Credentials embedded in endpoint URLs are rejected; URLs are redacted in logs.
- Pass `transport` in `GRPCConfig` to supply your own ConnectRPC transport
  (for example `createRouterTransport` in tests).

### Errors

Every failed unary RPC throws `KalvoraRpcError`:

```typescript
import { isKalvoraRpcError, RpcCode } from 'kalvora.js';

try {
  await query.getBalance(address, contractId);
} catch (error) {
  if (isKalvoraRpcError(error) && error.code === RpcCode.NotFound) {
    // the wallet never held this token
  }
}
```

Normalisation happens at the client boundary (a proxy around the generated
client) rather than in a transport interceptor, because ConnectRPC re-wraps
exceptions thrown by interceptors as `Code.Unknown`, which would erase the
server's status code.

## Transaction identity and signing

1. Obtain `kal_main` or `kal_proto` and its trusted final block-zero hash from the operator. `deriveChainId` computes SHA-256 over the UTF-8 bytes of `KAL_CHAIN_ID_V2|<network>|` followed by the 32 raw genesis hash bytes. Builders set this chain ID, the signature domain and the concrete transaction type before sizing or signing.
2. Select the Base58 wallet address. Ordinary external signers use the complete raw address in `PublicKey.wallet_address`. Registration carries the raw Falcon key or policy descriptor. A wallet registered in block H can spend in H+1. Each address has its own committed nonce and balances.
3. Resolve the next nonce and calculate an authorized fee cap. Automatic quotes size the completed protobuf, including address widths, the selected padded Falcon proofs or policy witnesses, sponsor fields when applicable and the final hash. Coin uses its authorization slots for nonces.
4. Sign the canonical protobuf. `getTransactionSigningBytes` prepares the owner preimage with signatures, witnesses, hash and fee payer cleared. A single-key owner uses `base.signature`; a policy uses `wallet_address` and witnesses in ascending permanent slot order. `signCoinTXN` signs each Coin authorization slot over the same preimage. A policy slot has an empty signature entry with witnesses on its key.
5. Where sponsorship is supported, `countersignTransaction` attaches a distinct registered single-key fee payer and its nonce. The sponsor signs the owner-approved transaction with the sponsor signature and hash cleared. Validator assignments have separate owner and operational proofs.
6. Hash the complete signed protobuf using SHA3-256 with only `base.hash` cleared. The hash identifies those signed bytes, including every proof. A new randomized Falcon signature changes the transaction ID.

Historical Ed25519 and Ed448 wallet and signing APIs remain available for older records. New user envelopes on the fresh-genesis protocol require registered addresses. [Wallet adapter integration](../adapter-integration-guide.md)

### Offline construction

For offline standard envelopes, supply the trusted chain context, exact next nonce, fee cap and timestamp. Individual builders may also need token denomination, instrument or governance settings, or other state normally read from the network. A fixed set of inputs gives deterministic unsigned bytes. Keep the signed bytes and hash for reconciliation after a submission timeout. [Worked examples](./transactions.md)

## Protocol definitions

This migration targets validator build **200030**, attestation protocol **33**, with Wasm preparation gas enabled. The public `txn.proto`, `validator.proto` and `kal_api.proto` in the November 25 handoff match `w-tw/kal-network` commit `daa5938f94c0f24c155269944b0dd02a7b3ae4e6`. The format-2 genesis schema, launch profile and chain-ID changes come from the validator working tree represented by the handoff. The operator supplies the actual deployment profile and genesis pin. [Protocol handoff](../kalvora-js-protocol-handoff-2026-11-25/documents/howto/kalvora_js_protocol_handoff.md)

The SDK tracks those three public schemas under `proto/`. The guardian service owns `guardian.proto` separately. The existing Buf build generates all four public TypeScript modules. The handoff's storage, launch and worker IPC schemas serve validator and operator tooling.

```bash
npm run proto:sync -- --source docs/kalvora-js-protocol-handoff-2026-11-25/kal_validator/proto
npm run proto:check -- --source docs/kalvora-js-protocol-handoff-2026-11-25/kal_validator/proto
npm run build:proto
```

Point `--source` at the matching sibling `../kal-network/kal_validator/proto` checkout to check it directly. Generated files in `proto/generated/` are git-ignored and rebuilt locally.

## Tests

- `npm test` runs the vitest suite. Unit tests are offline: builders are
  exercised with explicit `nonce` + `feeAmountParts`, and RPC code with
  ConnectRPC's in-memory `createRouterTransport`.
- `npm run test:live` runs read-only checks against a real node. It is skipped
  unless `KALVORA_LIVE_ENDPOINT` is set, e.g.
  `KALVORA_LIVE_ENDPOINT=https://kal-proto.visiondynamics.ch npm run test:live`.
  Live tests never submit transactions.
