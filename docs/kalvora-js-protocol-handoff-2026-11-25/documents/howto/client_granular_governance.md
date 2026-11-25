# Client Granular Governance Guide

`GRANULAR` is standalone governance with proposal-specific timing, an immutable
voter whitelist, and optional instrument weighting. Existing proposal-submission
ownership, authentication, permissions, compliance, and funding rules still apply.

## Contract configuration

Set `governance.type = GRANULAR` and configure the existing
`allowed_proposal_instrument` list. These instruments authorize proposers; they do
not define the granular electorate. The existing `allow_multi` flag controls
whether option proposals are allowed. Binary proposals remain available in either
case.

Leave unused contract-level voting instruments, percentages, periods, and staged
settings empty/default. Granular cannot have pre-governance. Each proposal carries
its own required rules; contract defaults never fill missing proposal rules.

## Submit a proposal

Use the existing `GovernProposal` RPC and `kal_txn.GovernanceProposal`. Supply
`start_timestamp`, `end_timestamp`, and the `granular` message:

```text
granular {
    threshold: 6000
    regular_quorum: 7500
    voter_wallets: RAW_WALLET_A
    voter_wallets: RAW_WALLET_B
    voter_wallets: RAW_WALLET_C
    voting_instrument: "$OPTIONAL_INSTRUMENT"
}
```

Both percentages must be present and between `1` and `10000` inclusive;
`10000 = 100%`. Include 1–1000 unique canonical wallet identities as raw bytes.
Use the existing identity format for the intended voter, including supported
wider identities. Do not replace identities with display Base58 text, truncate
them to 32 bytes, or rehash them.

Omit `voting_instrument` for equal voting weight: every accepted listed vote has
weight 1, without a governance holding requirement. A present instrument selects
the usual live weight of that one coin/NFT/SBT; a present empty ID is invalid.
Listed wallets may record votes at zero instrument weight. Their choices remain
recorded and are reweighted by subsequent applicable asset changes while open.

Weights are decimal integer strings. Individual item weights retain their
existing `uint256` limit; granular per-wallet and proposal totals use the
canonical item supply accounting limit of `2^512 - 1`. Clients should preserve
these values as arbitrary-precision integers when calculating shares.

Use valid whole UTC seconds, with `start < end` and end strictly after the
accepting block timestamp. In the protocol-12 candidate, end must be at most
90 days after acceptance, even when start is in the future. A past start is allowed, but no vote precedes proposal
acceptance. Voting uses containing block time and the window `[start, end)`.
The accepted whitelist, instrument, percentages, and timestamps cannot be edited.

## Vote and interpret the result

Use the existing `GovernVote` RPC and `kal_txn.GovernanceVote`. Binary proposals
require explicit `support` and no `support_option`. Option proposals require a
valid zero-based `support_option`; option 0 is the existing `against` choice.
Use the existing option/action validation and `allow_multi` rules.

Each listed wallet votes directly. Delegation is ignored for granular. A sponsor
can fund a normal vote without becoming its voter. Repeating or replacing a vote
never adds a second participant. The existing native `Vote` call uses the same
governance vote path: `"true"`/`"false"` selects binary support and a numeric string
selects an option; its proposal ID argument remains hexadecimal text.

Participation is the count of distinct listed wallets with an accepted recorded
vote divided by the full whitelist size. Zero-weight votes count participation,
and later loss of weight does not remove participation. Wallets that never vote
remain in the denominator.

For binary passage, positive YES weight must reach `regular_quorum` as a share
of total cast YES/NO weight, and participation must reach `threshold`. For option
proposals, granular forces the existing `chicken_dinner` policy: once participation
is met and total effective cast weight is positive, the highest-weight option
wins without an approval-quorum requirement. The quorum field is still required
and validated. Ties select the lowest option index, including against at index 0.
Against finalizes with the existing result semantics and no option actions.

Early readiness is checked after the applicable block's votes and asset updates.
A transient passing tally during block processing is not final. The normal
governance result must commit to finalize the decision. At end, the decision
inputs close at the deadline tally; later asset changes cannot alter that result
even if processing is delayed. Failure runs no approved children. Passage runs
the binary action list or selected nonzero option branch through the existing
execution path once; child execution outcomes remain separate from approval.

## Read bounded proposal details

Use the additive API-service RPC:

```protobuf
rpc ProposalDetail(ProposalDetailRequest) returns (ProposalDetailResponse);
```

Start with a raw 32-byte `proposal_id`, `voter_offset = 0`, and `page_size` from
1 through 1000. Zero selects the default page size of 100. The response contains
common typed proposal metadata, a `granular` summary of accepted percentages and
instrument presence, whitelist size, participant count, effective YES/NO or option
weights, closing state, and the requested `voters` rows. Each row has the exact
wallet bytes and an optional current typed vote. It does not copy the full
whitelist, action payloads, or legacy encoded proposal blob into every response.

Follow `next_voter_offset` while `has_more` is true. Voter pages follow immutable
whitelist order. Offset equal to whitelist size returns an empty completed page;
larger offsets and oversized pages return `INVALID_ARGUMENT`. Pass the first
response's `state_digest` as `expected_state_digest` on later pages to read one
unchanged proposal version. `ABORTED` means state changed: restart at offset zero
with an empty expected digest. This digest is a concurrency check over the stored
proposal, not a certificate of finalized history.

`participant_count` includes zero-weight recorded voters. `closed` means decision
inputs are frozen; `result_ready` also includes deadline failures awaiting result
processing. Neither field is a committed terminal result. Obtain the terminal
outcome from committed `ProposalResult` or cancellation history. Once active
state is removed, `ProposalDetail` returns `NOT_FOUND`.

An early passing decision closes at the completed block checkpoint, after all
votes and asset changes in that block. In that case `closed_seconds` is the
checkpoint block's timestamp, which can precede the proposal's `end_date`.
Later signed or native votes cannot change the frozen decision. A signed vote
included after closure receives `PROPOSAL_NOT_IN_VOTING_PERIOD` and follows the
ordinary failed-transaction fee and nonce rules. Wait for a committed
`ProposalResult` before treating the approved actions as executed.

The single raw state read is capped at 8 MiB, independently of the 3.5 MiB typed
response cap, so derived voter state can grow beyond the original signed proposal
without requiring clients to download its actions. Reads and responses have
byte/work limits, including at most 4096 option summaries per response, and
return `RESOURCE_EXHAUSTED` with no partial response when exceeded. The existing `ProposalLedger` bulk endpoint keeps
its current bounds, including the Base58 work limit; use `ProposalDetail` for
large granular electorates. Legacy proposals receive common typed metadata with
no granular voter rows, and their existing bulk-query behavior is unchanged.

## Fees and cancellation

Granular reuses adaptive proposal funding: the normal quote funds submission
and one final result, with the exact remainder held in proposal escrow. Final
processing consumes the remaining escrow on either pass or failure. Votes keep
normal fees and verified sponsorship/native metering. There is no additional
granular surcharge or ordinary pass/fail refund.

In the protocol-12 candidate, the original proposer may cancel while the
proposal is open. Unused escrow returns to the recorded payer, including a
sponsor; earned processing fees remain paid. Closing the decision prevents
cancellation even when its result is waiting for block space. Contract
administrators gain no cancellation authority. The cancellation transaction
keeps the normal transaction fee rules.

See the [protocol-12 availability implementation handoff](../security/REPORT_20261106_governance_availability_v12.md)
for the implementation's outstanding validation and liveness gaps.
