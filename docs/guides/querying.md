---
title: Querying
group: Guides
---

# Querying the network

`KalvoraQueryClient` wraps every client-facing RPC of `kal_api.APIService`.
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
await query.getContractSupply(contractId);        // { maxSupply, currentSupply, circulation }
await query.getCurrencyEquivalent(contractId);    // USD per token × 1e18
await query.getContractFee(contractId);           // NOT_FOUND if the contract charges none
await query.getTokenFeeInfo([idA, idB]);          // rate, denomination, authorization, fees
await query.getAuthorizedFeeTokens();             // tokens accepted for base fees (cached 60s)
await query.getBaseFee(TRANSACTION_TYPE.COIN_TYPE, wallet.publicKey);
await query.getContractItem(itemId, contractId);  // NFT record: holder, fees, metadata
```

`circulation` is the same value as `currentSupply`. It is field 2 of the
on-chain `MaxSupply` record. `getContractItem` reads `CONTRACT_ITEMS`.
`itemId` is the decimal uint256 stored on the item. `getItems` only returns
the id pair.

`getAuthorizedFeeTokens` keeps its result for 60 seconds. A fee instrument
is qualified when it is `KALVORA_NATIVE_TOKEN` or appears in that list.

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
import { nextSmartContractEventSearchStart } from 'kalvora.js';

const start = new Date(Date.now() - 86_400_000);
const events = await query.searchSmartContractEvents('my_contract', start);
for (const event of events) {
  console.log(event.function, event.eventData, event.blockHeight, event.txnHash);
}
const nextStart = nextSmartContractEventSearchStart(events); // one millisecond after the newest
```

Events are oldest-first and are pruned after about three days. Pass
`nextStart` as the next search start to page forward.

A validator can also push `SmartContractEvents` to a server you registered.
There is no listening server in this SDK. When you receive a
`SmartContractEventsResponse`, `acceptSmartContractEvent` checks the
validator signature (Ed25519 for an `A_` key, Ed448 for `B_`) over the
protobuf bytes with `signature` cleared, and throws when it does not verify.
`verifySmartContractEventSignature` returns the boolean instead.

## Raw database access

`getDatabaseValue(DATABASE_TYPE.X, key)` exposes the validator's internal
records. Encodings differ per table (plain strings, binary protobuf, or
protobuf text format), so prefer the typed helpers above.

## Validator and guardian services

```typescript
import {
  createValidatorQueryClient,
  createGuardianQueryClient,
  KeyPairSigner,
  NETWORK_TYPE,
  NETWORK_TYPE_KALVORA
} from 'kalvora.js';

const validator = createValidatorQueryClient(config);
await validator.getNonce(address);
await validator.getCheckpointInfo(new KeyPairSigner(publicKey, privateKey)); // signed request

const guardian = createGuardianQueryClient({ endpoint: 'https://guardian.example' });
await guardian.getPayload(txnHash, NETWORK_TYPE_KALVORA);   // payload / VAA for a Kalvora txn
await guardian.getPayload(solanaSig, NETWORK_TYPE.SOLANA);  // payload / VAA for a Solana txn
await guardian.getMintInfo([contractId]);                  // Map<contractId, solanaMint>
```

`NETWORK_TYPE_KALVORA` is the guardian protocol's network value for Kalvora
(`0`); `NETWORK_TYPE.SOLANA` is `1`. A `KalvoraClient` built with a
`guardian` endpoint exposes the same client as `kalvora.guardian`.

## Raw protobuf access

Every client exposes `.raw`, the generated ConnectRPC client, for fields the
typed wrappers do not surface. Errors are still normalised to
`KalvoraRpcError`.
