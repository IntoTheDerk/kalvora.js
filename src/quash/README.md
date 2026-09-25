# Quash (`QuashTXN`)

Cancels a **pending time-delayed** transaction before it executes
(rpc `TXNService.Quash`).

Restricted keys on a contract may have a `time_delay`. Transactions signed
by such a key (mint, revoke, contract update, ...) are held pending for that
delay. While pending, a key holding the `quash` permission can stop it by
hash.

## Permission required

The signer's public key must be a `RestrictedKey` on the contract with
`quash = true`. Quashing an executed, expired, or unknown hash is rejected by
the network.

## Example

```typescript
import { createQuashTXN, sendQuashTXN } from 'kalvora.js';

const txn = await createQuashTXN(
  {
    contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    txnHash: pendingTxnHashHex, // 64 hex chars, optional 0x prefix
    publicKey: 'A_<signer base58 public key>'
  },
  privateKey
);
const hash = await sendQuashTXN(txn);
```

| Function | Purpose |
|---|---|
| `buildQuashTXN(input, options?)` | Unsigned `QuashTXN` |
| `createQuashTXN(input, privateKey, options?)` | Build + sign |
| `sendQuashTXN(txn, grpcConfig?)` | Submit a signed txn, returns hex hash |

## Offline / deterministic building

Pass both `nonce` (the signer's *next* nonce) and `feeAmountParts` to skip all
network calls; add `timestamp` for byte-identical output:

```typescript
const txn = await buildQuashTXN(input, { nonce: 8, feeAmountParts: '1000', timestamp });
```
