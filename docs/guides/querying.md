---
title: Querying
group: Guides
---

# Querying the network

`KalvoraQueryClient` wraps every client-facing RPC of `zera_api.APIService`.
Get one from a `KalvoraClient` (`kalvora.query`) or directly:

```typescript
import { createQueryClient } from 'kalvora.js';

const query = createQueryClient();                       // protonet, HTTPS
const local = createQueryClient({ endpoint: 'http://localhost:8080', fallbackToHttp: false });
```

## Conventions

| Kind            | You pass                          | You get back                    |
|-----------------|-----------------------------------|---------------------------------|
| Wallet address  | base58 string                     | base58 string                   |
| Token amounts   | —                                 | `bigint`, smallest units        |
| USD rates/fees  | —                                 | `bigint`, scaled by `USD_SCALE` (1e18 = $1) |
| Hashes          | hex string (optional `0x`)        | lower-case hex string           |
| Heights, nonces | `bigint`, `number`, or digit string | `bigint`                      |

Helpers: `partsToWhole(parts, denomination)`, `formatScaled(value)`.

## Wallets

```typescript
await query.getNonce(address);        // last used nonce (0n for new wallets)
await query.getNextNonce(address);    // nonce for the next transaction
await query.getBalance(address, contractId);       // throws NOT_FOUND if never held
await query.getBalanceOrZero(address, contractId); // 0n instead of NOT_FOUND
await query.getItems(address);        // NFT/SBT items → [{ contractId, itemId }]
```

`getAllBalances` (the `TotalBalance` RPC) returns balances without token IDs
and is not implemented by every gateway; prefer `getBalance` per token.

## Contracts, tokens, and fees

```typescript
const { contract } = await query.getContract(contractId);  // InstrumentContract
contract.symbol; contract.governance; contract.restrictedKeys;

await query.getDenomination(contractId);          // 1000000000n (9 decimals)
await query.getContractSupply(contractId);        // { maxSupply, currentSupply }
await query.getCurrencyEquivalent(contractId);    // USD per token × 1e18
await query.getContractFee(contractId);           // NOT_FOUND if the contract charges none
await query.getTokenFeeInfo([idA, idB]);          // rate, denomination, authorization, fees
await query.getAuthorizedFeeTokens();             // tokens accepted for base fees
await query.getBaseFee(TRANSACTION_TYPE.COIN_TYPE, wallet.publicKey);
```

## Blocks and transaction results

```typescript
import { summarizeBlock, listBlockTransactions, findTransactionResult } from 'kalvora.js';

const tip = await query.getLatestBlockHeight();   // ≈ 2·log₂(height) requests; pass a hint to speed up
const block = await query.getBlock({ height: tip });
const byHash = await query.getBlock({ hash: '9d67eb…' });

summarizeBlock(block);
// { height, hash, previousHash, timestamp, transactionCount,
//   transactionsByType: { COIN_TYPE: 3 }, results: [{ hash, statusName, success, baseFees, … }] }

listBlockTransactions(block);                     // [{ type, list, hash, txn }]
findTransactionResult(block, txnHash);            // TransactionResult | undefined
```

### Waiting for a transaction

```typescript
const fromHeight = await query.getLatestBlockHeight(lastSeenHeight);
const hash = await sendMintTXN(signed);
const result = await query.waitForTransaction(hash, { fromHeight, timeoutMs: 60_000 });
result.success;      // false if the network rejected it (see result.statusName)
result.blockHeight;
```

`KalvoraClient.submitAndWait(txn)` does all three steps and keeps a height
hint between calls.

## Governance

```typescript
import { PROPOSAL_TYPE } from 'kalvora.js';

const ledger = await query.getProposalLedger(PROPOSAL_TYPE.ALL_PROPOSALS);
ledger.proposals;    // Map<proposalId, record>
ledger.voted;        // Map<wallet, record>
```

## Smart contract events

```typescript
const events = await query.searchSmartContractEvents('my_contract', new Date(Date.now() - 86_400_000));
for (const event of events) {
  console.log(event.function, event.eventData, event.blockHeight, event.txnHash);
}
```

## Raw database access

`getDatabaseValue(DATABASE_TYPE.X, key)` exposes the validator's internal
records. Encodings differ per table (plain strings, binary protobuf, or
protobuf text format), so prefer the typed helpers above.

## Validator and guardian services

```typescript
import { createValidatorQueryClient, createGuardianQueryClient, KeyPairSigner, NETWORK_TYPE } from 'kalvora.js';

const validator = createValidatorQueryClient(config);
await validator.getNonce(address);
await validator.getCheckpointInfo(new KeyPairSigner(publicKey, privateKey)); // signed request

const guardian = createGuardianQueryClient({ endpoint: 'https://guardian.example' });
await guardian.getPayload(txnHash, NETWORK_TYPE.ZERA);   // bridge payload / VAA
await guardian.getMintInfo([contractId]);               // Map<contractId, solanaMint>
```

## Raw protobuf access

Every client exposes `.raw`, the generated ConnectRPC client, for fields the
typed wrappers do not surface. Errors are still normalised to
`KalvoraRpcError`.
