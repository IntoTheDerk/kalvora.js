# Revoke (`RevokeTXN`)

Revokes a specific NFT / SBT item (by `itemId`) of a contract from the wallet
that currently holds it (rpc `TXNService.Revoke`). Typical uses: soul-bound
credentials, licences, memberships the issuer must be able to withdraw.

## Permission required

The signer's public key must be a `RestrictedKey` on the contract with
`revoke = true`. With a `time_delay` on that key, the revocation is pending
and quashable (see [`QuashTXN`](../quash/README.md)) until the delay ends.

## Example

```typescript
import { createRevokeTXN, sendRevokeTXN } from 'kalvora.js';

const txn = await createRevokeTXN(
  {
    contractId,                       // canonical Base58 mint id
    recipientAddress: holderAddress,
    itemId: '17',                      // decimal uint256
    publicKey
  },
  privateKey
);
const hash = await sendRevokeTXN(txn);
```

A successful revoke deletes the item. `itemId` is a decimal uint256
(`parseUint256`). The builder does not look up the contract's restricted
keys; the node rejects a signer that does not have `revoke`.

| Function | Purpose |
|---|---|
| `buildRevokeTXN` (`buildRevoke`) | Unsigned `RevokeTXN` |
| `createRevokeTXN(input, privateKey, options?)` | Build + sign |
| `sendRevokeTXN(txn, grpcConfig?)` | Submit a signed txn, returns hex hash |

## Offline / deterministic building

Pass both `nonce` (the signer's *next* nonce) and `feeAmountParts` to skip all
network calls; add `timestamp` for byte-identical output:

```typescript
const txn = await buildRevokeTXN(input, { nonce: 3, feeAmountParts: '1000', timestamp });
```
