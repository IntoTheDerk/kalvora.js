---
title: Architecture
group: Guides
---

# Architecture

This guide explains how the SDK is laid out, how it talks to the network, and
how the protocol definitions flow from `kalvora-indexer` into typed
TypeScript.

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
│ sign/  signWithKey, signAndFinalize, KalvoraSigner                   │
├──────────────────────────────────────────────────────────────────────┤
│ grpc/  createClient (gRPC-Web transport, Envoy paths, KalvoraRpcError)│
├──────────────────────────────────────────────────────────────────────┤
│ proto/generated  protobuf-es v2 bindings (txn, api, validator, guardian)│
└──────────────────────────────────────────────────────────────────────┘
```

- **Builders** are standalone, tree-shakeable functions. Each transaction type
  lives in its own folder (`src/mint`, `src/allowance`, …) and exposes the same
  three steps:
  - `buildXTXN(input, options)` — unsigned protobuf message (may query the
    network for nonce and fees),
  - `createXTXN(input, privateKey, options)` — build + sign,
  - `sendXTXN(txn, grpcConfig)` — submit, returns the hex hash.
- **Query clients** turn protobuf responses into plain values (`bigint`
  amounts, base58 addresses, hex hashes, `Date`s) and throw
  `KalvoraRpcError` on failure.
- **`KalvoraClient`** ties one network configuration to the query clients and
  submission, and implements *submit → wait for inclusion*.

## Transport

The SDK uses [ConnectRPC](https://connectrpc.com) with the **gRPC-Web** binary
protocol over `fetch`, so the same code runs in Node.js (≥ 20), browsers, and
React Native.

Kalvora nodes sit behind Envoy, which exposes short paths instead of the fully
qualified protobuf service names. `createClient` rewrites request URLs
accordingly:

| Protobuf service                 | HTTP path prefix |
|----------------------------------|------------------|
| `zera_api.APIService`            | `/api/`          |
| `zera_txn.TXNService`            | `/txn/`          |
| `zera_validator.ValidatorService`| `/validator/`    |
| `zera_guardian.GuardianService`  | `/guardian/`     |

The `zera_*` package names are part of the wire protocol inherited from the
upstream codebase and must not change; SDK identifiers use the Kalvora name.

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

## Transactions

All transactions except `CoinTXN` share a single-signer `BaseTXN` envelope,
built by `buildStandardTransaction` in `src/shared/tx/standard.ts`:

1. validate the signer's public key identifier and shared options,
2. resolve the nonce (`options.nonce` or `APIService.Nonce + 1`),
3. build `BaseTXN` (timestamp, fee instrument, memo, `safe_send`),
4. create the protobuf message from the type-specific fields,
5. compute base and interface fees unless `feeAmountParts` is given,
6. assert the result carries no signature material.

Signing (`signWithKey` / `signAndFinalize`) serialises the unsigned message,
signs it (Ed25519 or Ed448, chosen from the key identifier), stores the
signature in `base.signature`, then hashes the signed bytes (SHA3-256) into
`base.hash`. The hash is the transaction ID returned by `send*`.

`CoinTXN` is multi-input: each input has its own key, nonce, and signature in
`TransferAuthentication`; see `signCoinTXN` / `signCoinTXNWithKeys`.

### Deterministic / offline construction

Pass both `nonce` and `feeAmountParts` to any standard builder and it makes no
network calls. Combined with a fixed `timestamp`, the unsigned bytes are fully
deterministic — useful for cold signing, hardware wallets, and golden tests.

## Protocol definitions

`kalvora-indexer` is the source of truth for the wire protocol. Its protos
live in per-package folders (`proto/txn/txn.proto`, …); the SDK keeps them
flat in `proto/`.

```bash
npm run proto:check   # fail if proto/ differs from ../kalvora-indexer/proto
npm run proto:sync    # copy + rewrite import paths
npm run build:proto   # regenerate proto/generated with buf + protoc-gen-es v2
```

Set `KALVORA_PROTO_SOURCE` or pass `--source <dir>` when the indexer checkout
is not a sibling directory. Generated code is git-ignored and rebuilt locally.

## Tests

- `npm test` runs the vitest suite. Unit tests are offline: builders are
  exercised with explicit `nonce` + `feeAmountParts`, and RPC code with
  ConnectRPC's in-memory `createRouterTransport`.
- `npm run test:live` runs read-only checks against a real node. It is skipped
  unless `KALVORA_LIVE_ENDPOINT` is set, e.g.
  `KALVORA_LIVE_ENDPOINT=https://kal-protonet.visiondynamics.ch npm run test:live`.
  Live tests never submit transactions.
