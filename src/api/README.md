# Internal API services (`src/api`)

These services back the fee calculator and nonce resolution used by the
transaction builders (token fee info, exchange rates, base fees, nonces). They
are **internal** and no longer exported from the package root as of 2.0.

Applications should use the typed query client instead:

```typescript
import { createQueryClient } from 'kalvora.js';

const query = createQueryClient();
await query.getNextNonce(address);
await query.getBalance(address, contractId);
await query.getTokenFeeInfo([contractId]);
await query.getBaseFee(TRANSACTION_TYPE.COIN_TYPE, publicKey);
```

See [`src/query`](../query/README.md) and the
[migration guide](../../docs/guides/coming-from-zera-js.md#4-query-functions--query-client).
