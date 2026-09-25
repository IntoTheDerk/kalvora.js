# Kalvora Smart Swap

`kalvora.js` exposes a browser- and React Native-safe facade over the Kalvora
indexer's route discovery and unsigned transaction builder. The application
injects a `kal-indexer-ts` `KalvoraClient` (or its `client.v1.dex` module), then
uses `kalvora.js` to deserialize, sign, and submit the returned transaction.

The facade does not import a sibling checkout, dynamically resolve packages, or
send private keys to the indexer.

## Indexer contract

- Client: `KalvoraClient` from `kal-indexer-ts`
- Default base URL in that client: `https://api.kalscan.io`
- API call: `GET /v1/dex?request=swap` with the remaining fields encoded as
  query parameters
- Authentication: the indexer client sends `Authorization: Api-Key <apiKey>` or
  `Authorization: Bearer <bearerToken>`; an API key takes precedence when both
  are configured
- Amounts: `amountIn` and `minAmountOut` are human-readable token units
- Build response: the version 1 serialized envelope is always read from
  `response.transaction`

The injected `KalvoraClient` configuration keys used by this contract are
`baseUrl`, `apiKey`, `bearerToken`, and `timeoutMs` (8,000 ms by default; `0`
disables its timeout). `kalvora.js` itself does not read indexer environment
variables. `KALVORA_INDEXER_URL`, `KALVORA_INDEXER_API_KEY`, and
`KALVORA_INDEXER_BEARER_TOKEN` are application-level naming conventions only.

The deployed indexer controls CORS. Browser applications must use an origin
allowed by that service. Do not embed an API key or bearer token in public
browser source; use an appropriate server-side/proxy trust boundary when the
credential is secret.

## Create the facade

`kal-indexer-ts` is not a dependency of `kalvora.js`. Obtain it through your
application/deployment integration, then inject it:

```typescript
import { smartSwap } from "kalvora.js";
import { KalvoraClient } from "kal-indexer-ts";

const indexer = new KalvoraClient({
  baseUrl: process.env.KALVORA_INDEXER_URL ?? "https://api.kalscan.io",
  apiKey: process.env.KALVORA_INDEXER_API_KEY,
});

const swaps = smartSwap.createSmartSwap(indexer);
```

If the indexer package is not available to your consumer, provide an object
implementing the exported `SmartSwapDexClient` interface:

```typescript
import { createSmartSwap, type SmartSwapDexClient } from "kalvora.js";

declare const dexClient: SmartSwapDexClient;
const swaps = createSmartSwap(dexClient);
```

## Quote

Quotes do not send a public key:

```typescript
const quote = await swaps.getQuote({
  tokenIn: "LEET1337",
  tokenOut: "solana-SOL000000",
  amountIn: 10,
});
```

## Quote and build

```typescript
const result = await swaps.swap(
  {
    tokenIn: "LEET1337",
    tokenOut: "solana-SOL000000",
    amountIn: 10,
    minAmountOut: "9.5",
    feeContractID: "KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao",
  },
  publicKey,
);

const unsignedEnvelope = result.transaction;
```

## Build from quoted stages

```typescript
const result = await swaps.swapFromStages(
  {
    stages: quote.stages,
    minAmountOut: "9.5",
    feeContractID: "KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao",
  },
  publicKey,
);
```

Both build methods reject a response without a non-empty version 1 transaction
with this stable error:

```text
Kalvora indexer swap response is missing a valid version 1 serialized transaction
```

The facade also requires the envelope type to be exactly
`zera_txn.SmartContractExecuteTXN`, valid base64 data, and a decoded size no
larger than 1 MiB. These checks constrain the envelope format; they do not prove
that a remote indexer built the transaction the user intended.

Local argument errors are `TypeError` instances prefixed by the operation name,
for example `smartSwap.swap: publicKey must be a non-empty string`. HTTP,
authentication, timeout, and other errors thrown by the injected DEX client are
propagated unchanged; the facade does not hide their status or error class.

## Sign and submit

Signing is local and explicit:

```typescript
import {
  deserializeTransaction,
  signAndFinalize,
  SMART_SWAP_TRANSACTION_TYPE,
  sendSmartContractExecuteTXN,
  type SmartContractExecuteTXN,
} from "kalvora.js";

const unsigned = deserializeTransaction(result.transaction);
if (unsigned.$typeName !== SMART_SWAP_TRANSACTION_TYPE) {
  throw new Error(`Unexpected transaction type: ${unsigned.$typeName}`);
}
const execute = unsigned as SmartContractExecuteTXN;
// Before requesting a signature, decode and display/validate the complete
// transaction intent: signer/sender, contract and function, token amounts,
// min output, fee token/amount, platform fee recipient/rate, and route stages.
await reviewTransactionIntent(execute);
const signed = await signAndFinalize(execute, walletSigner);
const hash = await sendSmartContractExecuteTXN(signed, grpcConfig);
```

The SDK does not expose `swapAndSend` helpers: keeping indexer access,
authorization, wallet signing, and network submission as separate steps avoids
passing private keys across the indexer boundary.
