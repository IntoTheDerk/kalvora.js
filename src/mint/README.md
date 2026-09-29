# Mint (`MintTXN`)

Mints new supply of a fungible token contract and credits it to a recipient
wallet (rpc `TXNService.Mint`).

## Permission required

The signer's public key must be a `RestrictedKey` on the contract with
`mint = true`. If that key has a `time_delay`, the mint is held pending and
can be cancelled with a [`QuashTXN`](../quash/README.md) until the delay ends.

## Amount units

`amount` is always in the token's **smallest units ("parts")**, as an integer
string, safe-integer number, or bigint (must be > 0). Whole-token amounts are
not accepted, so no denomination lookup happens. Convert first if needed:

```typescript
import { toSmallestUnits } from 'kalvora.js';
const amount = toSmallestUnits('1.5', 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', { denomination });
```

## Example

```typescript
import { createMintTXN, sendMintTXN } from 'kalvora.js';

const txn = await createMintTXN(
  {
    contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    amount: '2500000000',
    recipientAddress: '<recipient base58 address>',
    publicKey: 'A_<signer base58 public key>'
  },
  privateKey
);
const hash = await sendMintTXN(txn);
```

| Function | Purpose |
|---|---|
| `buildMintTXN(input, options?)` | Unsigned `MintTXN` |
| `createMintTXN(input, privateKey, options?)` | Build + sign |
| `sendMintTXN(txn, grpcConfig?)` | Submit a signed txn, returns hex hash |

## Offline / deterministic building

Pass both `nonce` (the signer's *next* nonce) and `feeAmountParts` to skip all
network calls; add `timestamp` for byte-identical output:

```typescript
const txn = await buildMintTXN(input, {
  nonce: 12,
  feeAmountParts: '1000',
  timestamp: new Date('2026-01-01T00:00:00Z')
});
```

Other options (`memo`, `feeId`, `safeSend`, interface fee, `grpcConfig`) come
from the shared `StandardTXNOptions`.
