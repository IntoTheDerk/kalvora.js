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
| `kal_api.APIService`             | `/api/`          |
| `kal_txn.TXNService`             | `/txn/`          |
| `kal_validator.ValidatorService` | `/validator/`    |
| `GuardianService` (guardian package) | `/guardian/` |

The protobuf package names come from the official Kalvora protos
(`kal_txn`, `kal_validator`, `kal_api`). The bridge guardian service uses its
own protobuf package, which has not been re-issued; the SDK names its
Kalvora-side identifiers `NETWORK_TYPE_KALVORA` and `KalvoraGuardian*Payload`.
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

The official Kalvora protos (`txn.proto`, `validator.proto`, `kal_api.proto`;
packages `kal_txn`, `kal_validator`, `kal_api`) are the source of truth for the
wire protocol. They are committed to `proto/` byte-identical to the release,
without repo-local options: the Go `go_package` option is supplied by `buf`
managed mode and TypeScript generation needs none. `guardian.proto` (the
guardian service's own package) is not part of the official release and is
kept as-is.

`proto:sync` accepts either the official flat release directory or a
kalvora-indexer `proto/` checkout (per-package folders such as
`proto/txn/txn.proto`, whose nested imports are rewritten to the flat layout).
kalvora-indexer adds a `go_package` option to each file, so a check against an
indexer checkout reports drift for those lines; check against the official
release.

```bash
npm run proto:check -- --source <official-protos-dir>   # fail if proto/ differs
npm run proto:sync  -- --source <official-protos-dir>   # copy verbatim
npm run build:proto   # regenerate proto/generated with buf + protoc-gen-es v2
```

Without `--source`, the scripts use `KALVORA_PROTO_SOURCE`, then
`../kalvora-indexer/proto`. Generated code is git-ignored and rebuilt locally.

## Tests

- `npm test` runs the vitest suite. Unit tests are offline: builders are
  exercised with explicit `nonce` + `feeAmountParts`, and RPC code with
  ConnectRPC's in-memory `createRouterTransport`.
- `npm run test:live` runs read-only checks against a real node. It is skipped
  unless `KALVORA_LIVE_ENDPOINT` is set, e.g.
  `KALVORA_LIVE_ENDPOINT=https://kal-proto.visiondynamics.ch npm run test:live`.
  Live tests never submit transactions.
