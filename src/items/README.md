# Items (NFT and SBT)

Item mint, NFT transfer, and SBT burn. Full option list:
[transactions guide](../../docs/guides/transactions.md).

| Alias | Same as | Signed? |
|---|---|---|
| `buildItemMint` | `buildItemizedMintTXN` | no |
| `buildNftTransfer` | `buildNFTTXN` | no |
| `buildSbtBurn` | `buildBurnSBTTXN` | no |

`itemId` is a decimal uint256 (`'1'`, not `'badge-001'`). `parseUint256`
accepts the same form. `validFrom` must be earlier than `expiry`, and
`expiry` must be after the transaction timestamp.

Online builds check that the contract is an NFT or SBT, that a transfer or
burn is moving an item the signer holds, and that an item fee is authorized
for the fee token. Pass both `nonce` and `feeAmountParts` to skip those
network checks.

## Item fee

The node prices an item fee as
`(feeTokenDenomination * itemFee) / rate`, with a missing rate, `0`, or `1`
replaced by `10^18` ($1.00):

```typescript
import { itemFeeParts } from 'kalvora.js';

itemFeeParts(item.contractFees.fee, denomination, rate); // smallest units, decimal string
```

## Read one item

`getItems` returns only `{ contractId, itemId }`. The holder, fees, and
metadata are on the contract-item record:

```typescript
const item = await query.getContractItem(itemId, contractId);
```
