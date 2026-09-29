# Compliance (`ComplianceTXN`)

Assigns or revokes KYC / compliance levels for one or more wallets on a
contract (rpc `TXNService.Compliance`). Each assignment becomes a
`ComplianceAssign` entry.

## Permission required

The signer's public key must be a `RestrictedKey` on the contract with
`compliance = true`.

## Assignment fields

| Field | Type | Meaning |
|---|---|---|
| `recipientAddress` | base58 string | Wallet whose level changes |
| `complianceLevel` | integer `0..4294967295` (`uint32`) | Level; meaning defined by the contract |
| `assign` | boolean | `true` assign, `false` revoke (`assign_revoke`) |
| `expiry` | `Date` (optional) | Assignment expiry; only allowed when `assign` is `true` |

At least one assignment is required, and each
`(recipientAddress, complianceLevel)` pair may appear only once per
transaction.

## Example

```typescript
import { createComplianceTXN, sendComplianceTXN } from 'kalvora.js';

const txn = await createComplianceTXN(
  {
    contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    assignments: [
      { recipientAddress: '<wallet A>', complianceLevel: 1, assign: true,
        expiry: new Date('2027-12-31T00:00:00Z') },
      { recipientAddress: '<wallet B>', complianceLevel: 2, assign: false }
    ],
    publicKey: 'A_<signer base58 public key>'
  },
  privateKey
);
const hash = await sendComplianceTXN(txn);
```

| Export | Purpose |
|---|---|
| `buildComplianceTXN(input, options?)` | Unsigned `ComplianceTXN` |
| `createComplianceTXN(input, privateKey, options?)` | Build + sign |
| `sendComplianceTXN(txn, grpcConfig?)` | Submit a signed txn, returns hex hash |
| `MAX_COMPLIANCE_LEVEL` | `4294967295` |

## Offline / deterministic building

Pass both `nonce` (the signer's *next* nonce) and `feeAmountParts` to skip all
network calls; add `timestamp` for byte-identical output:

```typescript
const txn = await buildComplianceTXN(input, { nonce: 21, feeAmountParts: '1000', timestamp });
```
