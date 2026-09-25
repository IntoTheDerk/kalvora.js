# gRPC transport (`src/grpc`)

Low-level ConnectRPC plumbing shared by every client in the SDK. Most
applications use the typed clients in [`src/query`](../query/README.md) and
the `send*` functions instead of this module directly.

## `createClient(service, config)`

Creates a ConnectRPC client for any generated service descriptor
(`APIService`, `TXNService`, `ValidatorService`, `GuardianService`) using the
**gRPC-Web binary** protocol over `fetch` (Node.js ≥ 20, browsers, React Native).

```typescript
import { createGrpcClient, proto } from 'kalvora.js';

const api = createGrpcClient(proto.api.APIService, { endpoint: 'https://kal-protonet.visiondynamics.ch' });
```

`GRPCConfig` highlights:

| Field | Default | Notes |
|-------|---------|-------|
| `endpoint` | — | Full base URL; overrides `host`/`port`/`protocol` |
| `host` / `port` / `protocol` | `kal-protonet.visiondynamics.ch` / `443` / `https` | |
| `transport` | — | Bring your own ConnectRPC transport (e.g. `createRouterTransport` in tests) |
| `fetch` | `globalThis.fetch` | Custom fetch (agents, proxies) |
| `fallbackToHttp` / `fallbackPort` | `false` / `8080` | HTTP retry, **only** for loopback/private development hosts |

Security: URLs with embedded credentials are rejected, logged URLs are
redacted, and public hosts can never be downgraded to HTTP implicitly.

### Envoy path mapping

Kalvora nodes expose short paths; request URLs are rewritten automatically:
`zera_api.APIService → /api/`, `zera_txn.TXNService → /txn/`,
`zera_validator.ValidatorService → /validator/`,
`zera_guardian.GuardianService → /guardian/`.

## Errors — `KalvoraRpcError`

Every failed unary call (for any transport) throws `KalvoraRpcError` with the
real gRPC `code` (`RpcCode`), `codeName`, `method`, `service`, `detail`, and
the original `ConnectError` as `cause`. Normalisation wraps the client rather
than using an interceptor, because ConnectRPC rewraps interceptor exceptions as
`Code.Unknown`.

## Transaction submission

`submitTransaction(txn, config)` routes any signed transaction to the correct
`TXNService` method based on its protobuf `$typeName` and returns the hex hash.
Unsigned transactions are rejected before any network call.
`createTransactionClient(config)` returns a reusable client.

## Files

| File | Purpose |
|------|---------|
| `client-factory.ts` | `createClient`, transport, URL rewriting, error normalisation |
| `errors.ts` | `KalvoraRpcError`, `isKalvoraRpcError`, `RpcCode` |
| `transaction/transaction-client.ts` | Universal `submitTransaction` |
| `api/validator-api-client.ts` | Internal minimal API client used by fee/nonce services |
| `utils/grpc-web-fetch-wrapper.ts` | Binary-safe fetch for React Native / browsers |
