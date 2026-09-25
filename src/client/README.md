# KalvoraClient (`src/client`)

A single object bound to one Kalvora network.

```typescript
import { KalvoraClient } from 'kalvora.js';

const kalvora = new KalvoraClient();                         // 'protonet' preset
const custom  = new KalvoraClient({ grpc: { endpoint: 'https://node.example' } });
const bridged = new KalvoraClient({ guardian: { endpoint: 'https://guardian.example' } });
```

| Member | Description |
|--------|-------------|
| `network` | Resolved `KalvoraNetwork` (`id`, `name`, `grpc`, `nativeToken`, `nativeDecimals`, `nativeSymbol`) |
| `grpcConfig` | Effective endpoint config — pass it to builders and `send*` functions |
| `nativeToken` | Native token mint ID for the network |
| `query` | `KalvoraQueryClient` |
| `validator` | `ValidatorQueryClient` |
| `guardian` | `GuardianQueryClient` (requires the `guardian` option) |
| `getLatestBlockHeight()` | Tip height, cached as a hint for cheap repeated calls |
| `submit(txn)` | Submit any signed transaction; returns the hex hash |
| `submitAndWait(txn, opts)` | Submit, then wait for block inclusion; returns the `TransactionResult` plus `blockHeight` |

`submitAndWait` records the tip height **before** submitting, so the including
block cannot be missed. Inclusion is not success: check `result.success` /
`result.statusName`.

## Networks

`KALVORA_NETWORKS` holds built-in presets (currently `protonet`);
`resolveNetwork(nameOrDefinition)` returns a defensive copy. Pass a custom
`KalvoraNetwork` object to target private deployments.
