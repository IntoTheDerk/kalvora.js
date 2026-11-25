---
title: Querying
group: Guides
---

# Querying the network

`kalvora.query` provides typed access to `kal_api.APIService`. Obtain the
network name and final block-zero hash from the deployment operator, and the
operator wallet address from a trusted validator assignment. This example
uses the `kal_proto` deployment.

```typescript
import { createKalvoraClient, pinNetwork, TRANSACTION_TYPE } from 'kalvora.js';

const network = pinNetwork('protonet', 'kal_proto', trustedBlockZeroHashHex);
const kalvora = createKalvoraClient({
  network,
  grpc: { endpoint: validatorEndpoint, trustedOperatorAddress }
});
const query = kalvora.query;
```

## Conventions

| Kind            | You pass                          | You get back                    |
|-----------------|-----------------------------------|---------------------------------|
| Wallet address  | full Base58 wallet address        | raw bytes in protobuf records   |
| Token amounts   | —                                 | `bigint`, smallest units        |
| USD rates/fees  | —                                 | `bigint`, scaled by `USD_SCALE` (1e18 = $1) |
| Hashes          | hex string (optional `0x`)        | lower-case hex string           |
| Heights, nonces | `bigint`, `number`, or digit string | `bigint`                      |

Helpers: `partsToWhole(parts, denomination)`, `formatScaled(value)`.

## Wallets

```typescript
const registration = await query.getSigningWallet(address);
if (registration?.identity.case === 'falcon') {
  console.log(registration.identity.value.variant, registration.identity.value.rawPublicKey);
} else if (registration?.identity.case === 'policy') {
  console.log(registration.identity.value, registration.policyHash);
}
await query.getNonce(address);        // last used nonce (0n for new wallets)
await query.getNextNonce(address);    // nonce for the next transaction
await query.getBalance(address, contractId);       // throws NOT_FOUND if never held
await query.getBalanceOrZero(address, contractId); // 0n instead of NOT_FOUND
await query.getItems(address);        // NFT/SBT items → [{ contractId, itemId }]
```

`getSigningWallet` returns `undefined` for a successful empty registry
response and propagates RPC errors. A wallet may receive funds before
registration. Once registration finalizes in block H, its spending and
safe-send eligibility begin in H+1. The first signed nonce is 1. A different
hash choice for the same Falcon key selects a separate address and nonce.
For balances by token ID, use `getBalance`.

## Contracts, tokens, and fees

```typescript
const { contract, operatorVerified } = await query.getContract(contractId);
contract.symbol; contract.governance; contract.restrictedKeys;

await query.getDenomination(contractId);          // 1000000000n (9 decimals)
await query.getContractSupply(contractId);        // { maxSupply, currentSupply, circulation }
await query.getCurrencyEquivalent(contractId);    // USD per token × 1e18
await query.getContractFee(contractId);           // NOT_FOUND if the contract charges none
await query.getTokenFeeInfo([idA, idB]);          // rate, denomination, authorization, fees
await query.getAuthorizedFeeTokens();             // tokens accepted for base fees (cached 60s)
await query.getBaseFee(TRANSACTION_TYPE.COIN_TYPE, wallet.walletAddress);
await query.getBaseFee(TRANSACTION_TYPE.MINT_TYPE, wallet.walletAddress, sponsor.walletAddress);
await query.getContractItem(itemId, contractId);  // NFT record: holder, fees, metadata
```

On the pinned client above, `getContract` resolves the operator's registered
Falcon key, checks that it derives the trusted operator address, then verifies
the signed response and requested contract ID. A failed check throws.
Unpinned query clients without a configured operator report `operatorVerified: false`.
For a policy fee quote pass a protobuf `PublicKey` with the address and the
selected witness slots. The optional third argument identifies a single-key
sponsor or validator co-signer by address.

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
const byHash = await query.getBlock({ hash: blockHashHex });

summarizeBlock(block);
// { height, hash, previousHash, timestamp, transactionCount,
//   transactionsByType: { COIN_TYPE: 3 }, results: [{ hash, statusName, success, baseFees, … }] }

listBlockTransactions(block);                     // [{ type, list, hash, txn }]
findTransactionResult(block, txnHash);            // TransactionResult | undefined
```

### Waiting for a transaction

```typescript
const fromHeight = await query.getLatestBlockHeight(lastSeenHeight);
const hash = await kalvora.submit(signed);
const result = await query.waitForTransaction(hash, {
  fromHeight, timeoutMs: 60_000, verifyFinalizedBlock
});
result.success;      // true only for an explicit OK receipt with the submitted hash
result.blockHeight;
```

`verifyFinalizedBlock` is an application-supplied callback. Check the block
against your pinned chain and committee or a trusted finalized block source.
`kalvora.submitAndWait(signed, { verifyFinalizedBlock })` performs the same
workflow. Without the callback the methods report inclusion with a matching
processing receipt. Failed execution can still charge fees. For
`SMART_CONTRACT_OUTPUT_TOO_LARGE` (45), inspect `result.gas` for charged compute.

After a timeout, look for the original hash and check the committed owner and
sponsor nonces and registration state. When retrying within the signed
±10-minute window, resubmit the same signed bytes to preserve the hash.

## Governance

```typescript
import { PROPOSAL_TYPE } from 'kalvora.js';

const ledger = await query.getProposalLedger(PROPOSAL_TYPE.ALL_PROPOSALS);
ledger.proposals;    // Map<proposalId, record>
ledger.voted;        // Map<wallet, record>
const snapshot = await query.getProposalDetail(proposalHashHex, 100);
if (snapshot) {
  const { firstPage, voters } = snapshot;
  console.log(firstPage.phase, firstPage.preGovernanceStage, firstPage.postGovernanceStage);
  console.log(firstPage.granular?.participantCount, voters.length);
}
```

Proposal detail page size zero selects 100 and the maximum is 1,000.
The client follows offsets with the first page's state digest and restarts
from offset zero after `ABORTED`. A missing active proposal returns
`undefined`. Read committed proposal results and `listGovernanceChildOutcomes(block)`
for terminal outcomes. Keep step and receipt index zero. One terminal group
marker can cover multiple children that never executed or paid fees.

## Smart contract events

```typescript
import { acceptSmartContractEvent } from 'kalvora.js';

const start = new Date(Date.now() - 86_400_000);
const events = await query.searchSmartContractEvents('my_contract', start, { pageSize: 100 });
for (const event of events) {
  console.log(event.function, event.eventData, event.blockHeight, event.txnHash);
}
const operator = await query.resolveOperator(trustedOperatorAddress);
const accepted = acceptSmartContractEvent(pushedEvent, operator);
```

Use page sizes from 1 through 256 for authenticated, oldest-first paging. The
client verifies the enclosing Falcon signature and the digest of the exact
request, then follows the signed opaque cursor. If the index changes it
discards partial results and restarts. Both event and proposal pagination
propagate the error after two restarts. Page size zero requests a single
all-or-error response for up to 256 matches. Events are pruned after roughly
three days.

For a pushed event, pass the received protobuf and the expected operator to
`acceptSmartContractEvent` as above. It verifies the concrete message with its
top-level signature cleared. `verifySmartContractEventSignature(event, operator)`
returns a boolean for the same check.

## Raw database access

`getDatabaseValue(DATABASE_TYPE.X, key)` exposes the validator's internal
records as uncertified diagnostics. Encodings differ per table (plain strings,
binary protobuf, or protobuf text format). Typed decoders do not certify the
underlying state; the raw RPC also exposes `diagnosticUnverified`.

## Validator and guardian services

```typescript
import {
  createGuardianQueryClient,
  NETWORK_TYPE,
  NETWORK_TYPE_KALVORA
} from 'kalvora.js';

const validator = kalvora.validator;
await validator.getNonce(address);
const validators = await validator.syncValidatorList(operatorWallet); // registered Falcon signer
for (const entry of validators) {
  console.log(entry.lastSignedHeartbeatTimeSeconds, entry.lastHeartbeatTimeSeconds);
}

const guardian = createGuardianQueryClient({ endpoint: 'https://guardian.example' });
await guardian.getPayload(txnHash, NETWORK_TYPE_KALVORA);   // payload / VAA for a Kalvora txn
await guardian.getPayload(solanaSig, NETWORK_TYPE.SOLANA);  // payload / VAA for a Solana txn
await guardian.getMintInfo([contractId]);                  // Map<contractId, solanaMint>
```

The signed heartbeat time advances after an accepted operational signature.
Producer liveness also advances after a produced block. Both fields retain
whole Unix seconds as bigint values. Public checkpoint metadata and downloads
are disabled at clean genesis.
The deprecated `getCheckpointInfo` helper receives `PERMISSION_DENIED` from
current nodes. Recovery uses verified local snapshots and controlled operator access.

`NETWORK_TYPE_KALVORA` is the guardian protocol's network value for Kalvora
(`0`); `NETWORK_TYPE.SOLANA` is `1`. A `KalvoraClient` built with a
`guardian` endpoint exposes the same client as `kalvora.guardian`.

## Raw protobuf access

Every client exposes `.raw`, the generated ConnectRPC client, for fields the
typed wrappers do not surface. Errors are still normalised to
`KalvoraRpcError`.
