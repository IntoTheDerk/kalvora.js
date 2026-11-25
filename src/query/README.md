# Query clients (`src/query`)

Typed, read-only access to Kalvora network state. Full guide:
[docs/guides/querying.md](../../docs/guides/querying.md).

| Client | Service | Create with |
|--------|---------|-------------|
| `KalvoraQueryClient` | `kal_api.APIService` — every client-facing read RPC | `createQueryClient(config)` or `kalvora.query` |
| `ValidatorQueryClient` | read-only `kal_validator.ValidatorService` subset | `createValidatorQueryClient(config)` or `kalvora.validator` |
| `GuardianQueryClient` | guardian `GuardianService` read RPCs (bridge payloads, prices, mint info) | `createGuardianQueryClient(config)` or `kalvora.guardian` |

## RPC coverage

| RPC | Method |
|-----|--------|
| `Nonce` | `getNonce`, `getNextNonce` |
| `GetSigningWallet` | `getSigningWallet`, `resolveOperator` |
| `Balance` | `getBalance`, `getBalanceOrZero` |
| `TotalBalance` | `getAllBalances` (not implemented by every gateway) |
| `Items` | `getItems` |
| `Database` `CONTRACT_ITEMS` | `getContractItem` |
| `Contract` | `getContract` |
| `Denomination` | `getDenomination` |
| `ContractFee` | `getContractFee` |
| `BaseFee` | `getBaseFee` |
| `GetTokenFeeInfo` | `getTokenFeeInfo` |
| `GetAllAuthorizedFees` | `getAuthorizedFeeTokens` |
| `Block` | `getBlock`, `hasBlock`, `getLatestBlockHeight`, `getTransactionResult`, `waitForTransaction` |
| `ProposalLedger` | `getProposalLedger` |
| `ProposalDetail` | `getProposalDetail` |
| `SmartContractEventsSearch` | `searchSmartContractEvents` |
| `Database` | `getDatabaseValue`, `getCurrencyEquivalent` (`CURRENCY_EQUIVALENTS`), `getContractSupply` (`CONTRACT_SUPPLY`) |
| Validator `Nonce`, `Balance` | `ValidatorQueryClient.getNonce`, `.getBalance` |
| Validator `SyncValidatorList` | signed request via a `KalvoraSigner` |
| Validator `GetCheckpointInfo` | deprecated; clean-genesis nodes return `PERMISSION_DENIED` |
| Guardian `GetPayload`, `SearchPayload`, `GetPriceData`, `GetMintInfo` | `GuardianQueryClient` methods |

Not wrapped (not client-facing): `SmartContractActivityRequest`,
`AuthenticateGuardian` (guardian ↔ guardian), and the validator
block/gossip/attestation streams. `SmartContractEvents` is a validator push
to a server you register; this SDK does not listen, and
`acceptSmartContractEvent` verifies a response you already have.
Every client exposes `.raw` for direct protobuf access.

## Decoders

Pure functions usable on data from any source: `summarizeBlock`,
`listBlockTransactions`, `findTransactionResult`, `toTransactionResult`,
`decodeContractSupply` (`circulation` aliases `currentSupply`), `partsToWhole`,
`formatScaled`, `parseUintString`, `USD_SCALE`. Pushed smart-contract events
are checked with `acceptSmartContractEvent` and
`verifySmartContractEventSignature`. `nextSmartContractEventSearchStart`
advances a timestamp filter; it is not a cursor or a guarantee of complete
paging. Obtain the operator address from a trusted validator assignment and set
`trustedOperatorAddress` on the client. The client resolves the registry key,
checks its address, and verifies signed contract replies and event searches.
A pinned network requires this address or an explicit verified operator.
Results expose `operatorVerified` for callers using an unpinned endpoint.

```ts
const operator = await query.resolveOperator(trustedOperatorAddress);
const events = await query.searchSmartContractEvents('dex', since, { operator, pageSize: 100 });
acceptSmartContractEvent(pushedEvent, operator);
```

Positive page sizes from 1 through 256 verify the digest for each request
and follow its signed opaque cursor. A changed index restarts the read from
the original timestamp. Zero uses the all-or-error query for up to 256 matches.
`getProposalDetail(proposalIdHex, pageSize)` returns `{ firstPage, voters }`
from one digest-pinned snapshot or `undefined` when the proposal is no longer
active. Consult committed results for its outcome. Both paging methods give
up after two restarts if the data keeps changing.
`itemContractDatabaseKey` builds the
`CONTRACT_ITEMS` key.

Database reads are uncertified diagnostics, including values returned by the
typed supply and currency-equivalent helpers. Public checkpoint metadata and
downloads are disabled at clean genesis; recovery uses verified local snapshots
and controlled operator access.

Processing receipts require an explicitly present `TXNStatusFees.status`.
`toTransactionResult` rejects rows without it; `findTransactionResult`,
`summarizeBlock`, and transaction polling ignore such incomplete rows. An RPC
acceptance or a processing receipt alone does not establish finality: verify
the block's finality evidence before treating the transaction as confirmed.
Supply `verifyFinalizedBlock` to `waitForTransaction` or `submitAndWait` to bind
the receipt to your committee verifier or trusted finalized block source.
`listGovernanceChildOutcomes(block)` resolves receipt indices, including zero.
A terminal group marker covers the reported number of children with one digest.
It carries no child receipt. `acceptedVotingRatio` holds the accepted proposal's
frozen ratios, and status 45 can include charged compute in `gas`.

Protocol 35 (validator build 200032) can process successive governance closing
steps in one certified block. A queue that exhausts the block allowance resumes
at a later height. Consume every `proposalResultTxns` and
`governanceChildOutcomes` entry in the committed block and use `ProposalDetail`
for the current phase. Polling can skip intermediate closing states. These same
reads work with a separately pinned protocol 33 chain.

Balance and nonce reads accept canonical wallet addresses of all six supported
widths, the burn account (`W5jE3KNH`), and proposal escrow (Base58 of ASCII
`p_` followed by the raw 32-byte proposal ID). Items and signing-wallet lookups
require a canonical wallet identity.

`validator.syncValidatorList(operator)` returns each validator's liveness times
as separate bigint Unix seconds. `lastHeartbeatTimeSeconds` advances after an
accepted heartbeat or produced block. `lastSignedHeartbeatTimeSeconds` tracks
only the last accepted signed heartbeat and survives owner lifecycle changes.

If submission times out, reconcile the original signed hash, committed nonce
and registry before retrying the same bytes within the validator's ±10-minute
timestamp window. A newly signed Falcon transaction can have a different hash.

## Verified behaviour (live node, 2026-09)

- Unknown wallet/token balance → `NOT_FOUND`; wallet with no items →
  `NOT_FOUND` ("Invalid Wallet").
- `BaseFee` requires a valid public key.
- Validator signed requests: signature over the protobuf request with
  `signature` unset; timestamps must be close to the node clock.
- `CONTRACT_SUPPLY` is a binary protobuf record `{1: maxSupply, 2: circulation}`.
  `decodeContractSupply` returns that second field as both `currentSupply`
  and `circulation`.
- `getAuthorizedFeeTokens` caches a successful response for 60 seconds.

## Tests

`tests/` runs offline against ConnectRPC's in-memory router transport.
`tests/live.test.ts` performs read-only calls against a real node when
`KALVORA_LIVE_ENDPOINT` is set (`npm run test:live`).
