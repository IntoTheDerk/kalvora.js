# Client Council Governance Guide

Pre-governance is an ordered sequence of council reviews before a proposal
enters public governance. Every configured council must approve the proposal
before it is eligible to be presented to regular voters. Contracts can also
configure ordered post-governance reviews after public approval and before
proposal actions execute. An empty contract post-governance list adds no mandatory
post review; a permitted proposal-specific list can still add reviews.

## Mandatory contract reviews

Read the target contract's `Governance` message. Pre-governance is enabled when
the legacy `pre_governance` field is present or the ordered
`pre_governance_stages` array is nonempty. These configurations are mutually
exclusive. Each entry uses the same message:

```protobuf
message PreGovernance {
    string voting_instrument = 1;
    uint32 days = 2;
    uint32 threshold = 3;
    uint32 regular_quorum = 4;
}
```

`threshold` and `regular_quorum` use `10000` as 100%.

The array contains at most 32 entries. Each entry defines its own instrument,
duration, participation threshold, and approval quorum. An instrument may
repeat; each occurrence requires fresh votes. A legacy singleton is treated
as a one-entry sequence. With neither mandatory configuration, proposals with no additional PRE steps
enter regular governance directly.

`post_governance_stages` is an independent ordered array of the same
`PreGovernance` entries, with at most 32 steps. Each post review has its own
instrument, period, participation threshold and approval quorum; repeat
instruments require fresh votes. Pre and post reviews can be configured
independently. A configured post list is required for every proposal on that
contract; an empty contract post list configures no mandatory post review.

## Proposal-specific additional reviews

`Governance.allow_proposal_councils` defaults to `false`. When true, an authorized
proposer may add independently configured instrument-based review steps through
`GovernanceProposal.additional_pre_governance` and
`additional_post_governance`. Each optional message contains a `stages` array of
`PreGovernance` entries. For example:

```json
{
  "additional_pre_governance": {
    "stages": [
      {
        "voting_instrument": "<council instrument ID>",
        "days": 3,
        "threshold": 7500,
        "regular_quorum": 7500
      }
    ]
  }
}
```

The flow is mandatory contract PRE, additional proposal PRE, public governance,
mandatory contract POST, then additional proposal POST. Added steps never replace
mandatory councils. Each phase permits at most 32 combined mandatory and added
steps. A contract with 30 mandatory PRE steps therefore permits two additional
PRE steps. With permission enabled, either phase can receive added steps even if
the contract array is empty. PRE and POST additions are independent.

Omit an optional additional-review message to add no steps in that phase. A
present message with an empty `stages` array is invalid. Supplying additions when
the contract flag is false is also invalid. Each added step uses normal
instrument-holder eligibility, compliance, distinct-wallet participation and
binary approval rules. Repeated instruments require fresh ballots. The complete
combined configuration is saved when the proposal is accepted and retained
through restart and pending transitions. API proposal views expose these
effective combined arrays, so clients must use the proposal view to find its
actual step count and current instrument.

A legacy singleton PRE becomes the first array step when PRE additions are
supplied; every PRE vote for that proposal must then carry an explicit step
index. POST-only additions retain legacy singleton PRE vote compatibility.
The flag supports the existing council-compatible STAGED, CYCLE and STAGGERED
governance types.

The arrays and stage-bound vote fields belong to the clean-genesis protocol-12
candidate. Validators and clients using them must be updated together.

The pre-governance voting instrument is a council instrument and is separate
from the contract's regular public `voting_instrument` list.

### Scoping NFT and SBT voting items

An individual NFT or SBT voting item can be limited to a specific governed
contract by including this parameter in its `ItemizedMintTXN`:

```text
key:   pre_governance_contract_id
value: <governed contract ID>
```

For either council phase, a wallet's membership eligibility uses active
positive holdings from:

- items whose `pre_governance_contract_id` matches the proposal's contract;
  plus
- items that do not contain the key, which are universal.

Items scoped to other contracts do not establish membership. A wallet
may hold separate items scoped to different authority contracts. If every
minted item omits the key, all items count for all contracts that use that
NFT/SBT as their pre-governance instrument.

Protocol 12 counts distinct compliance-eligible member wallets. Each eligible
wallet contributes at most one member and one effective YES or NO choice,
regardless of its token balance, item count or item weight. Participation uses
the eligible member count as its denominator; approval uses the captured cast
choices. An empty electorate, no cast choices or no YES choices cannot pass.
Delegation preserves each contributing wallet's own membership eligibility.

Membership and choices are reconciled in bounded maintenance blocks at a fixed
anchor. Universal/scoped holding changes and compliance changes can therefore
delay a result while reconciliation catches up. Ordinary transactions pause
while the closing barrier is active. Clients must wait for the certified result.

This parameter is ignored for fungible token instruments and regular
governance voting.

Adaptive and granular governance cannot be combined with either council phase.

## Proposal lifecycle

Clients submit the normal `GovernanceProposal` through the `GovernProposal`
RPC. There is no separate pre-governance proposal transaction.

For a proposal with pre-governance:

1. The proposal enters the first configured council review.
2. Council members vote using normal `GovernanceVote` transactions.
3. Council voting is binary, using `support`; `support_option` is not used.
4. The proposal can pass before its deadline when the captured eligible-member
   participation threshold and approval quorum are reached. Reconciliation and
   bounded result scheduling must finish before the result commits.
5. If it does not pass before the final voting day ends, it fails.
6. A committed passing result activates the next council, if one remains.
   That council receives its full voting period starting at the approval's
   commit-block timestamp; its first votes can be accepted in a subsequent
   block. A frozen result waiting for inclusion has not activated that next
   council yet.
7. Each council starts with fresh ballots and captured tallies, including when
   the instrument repeats. A failed council ends the entire proposal.
8. Approval of the last council automatically enters the contract's regular
   governance pipeline.
9. Public voters then vote according to the contract's regular staged, cycle,
   or staggered governance rules.

For array-based pre-governance, every `GovernanceVote` must set the optional
`pre_governance_stage` field to the active zero-based step index, including
explicitly setting zero for the first step. A stale index is rejected. The
field also binds the vote to pre-governance: omit it for regular governance.
Legacy singleton votes may omit the field; when supplied it must be zero and
is likewise rejected after regular governance begins.

After a final public approval survives any cohort ranking cut, a contract with
post-governance enters its first post review. The public vote's winning option
is fixed. Council votes approve or reject that outcome; they do not choose a
different option. Approved actions remain held until every post step passes.

Post reviews use the same early-pass, deadline-only failure, fresh-ballot and
full next-window rules as pre reviews. NO votes do not reject a proposal early.
Only the final post approval queues the original base actions and actions for
the public winning option. A post failure or eligible cancellation ends the
proposal without releasing its actions. Proposals with no effective post steps retain
their existing execution after successful public governance.

Every post-governance ballot must explicitly set `post_governance_stage` to
the active zero-based index, including zero. A ballot cannot set both phase
indices. Each index binds the signed vote to its phase and step, so a delayed
pre or public ballot cannot become a post vote.

The native smart-contract `Vote` function keeps its existing arguments. To
target an array step, pass `pre:<index>:true` or `pre:<index>:false` as the
option string, for example `pre:0:true` for YES in the first review. The host
sets the step before calculating fees and hashing the vote. Ordinary `true`,
`false`, and numeric option strings retain their existing behavior; they do
not identify a step and cannot vote in array-based pre-governance or any post
review. Use `post:<index>:true` or `post:<index>:false` for post reviews.

A pre-governance vote does not carry into public governance. Council members
may vote again during the regular voting phase if they also hold a regular
voting instrument.

`ProposalResult.pre_governance` and `post_governance` identify council
outcomes. A result with both flags false is public. A public `final_stage=true`
approval starts post review when configured. A successful final post result has
`post_governance=true`, `final_stage=true`, and `passed=true`; it queues the
approved actions through the existing execution pipeline. Clients should track
those queued actions separately from the approval result.

## Fees and cancellation

The proposer funds every mandatory and additional pre- and post-governance processing stage upfront,
alongside regular-governance processing. Each committed step consumes its own
allocation, without resubmitting the proposal or charging submission again. Council
voters do not pay a special council surcharge beyond normal vote transaction
fees.

Failure in either council phase consumes the remaining proposal escrow. In the
protocol-12 candidate, the original proposer may use `ProposalCancel` while
the proposal remains open and its result is not currently closing or frozen.
A settled transition awaiting calendar or ledger recovery remains cancellable.
Cancellation returns unused escrow to the recorded payer and retains earned processing fees;
the cancellation transaction keeps the normal fee rules. A result waiting
for block space remains frozen. See the
[availability implementation handoff](../security/REPORT_20261106_governance_availability_v12.md)
for outstanding validation and liveness gaps.

## KAL PREGOV authorization

The genesis `PREGOV` contract is a Soulbound Token contract used for council
authorization in KAL governance.

- PREGOV itself has no pre-governance phase. Its proposals use four-day
  staggered governance with KAL as the voting instrument.
- KAL pre-governance lasts 30 days.
- Participation threshold is 75% (`7500`).
- Approval quorum is 75% (`7500`).
- No PREGOV SBTs are minted at genesis.
- A wallet with no active PREGOV SBT has the **No Pregov** state and cannot
  participate in council voting.
- PREGOV SBTs may carry different item weights or authorization metadata, but
  eligible council wallets each count once in protocol-12 pre-governance.

PREGOV SBTs are soulbound and therefore are not transferred between wallets.
Clients should treat mint, revoke, expiry, and burn events as authorization
changes.

## Genesis authority proposals

KAL includes nine parallel authority contracts:

- `KIP` approves required validator-version upgrades.
- `LEGAL` issues legal and compliance governance actions.
- `MINT` authorizes additional KAL minting.
- `TREASURY` represents treasury governance.
- `TECH` represents technology and infrastructure funding.
- `MARKETING` represents outreach and marketing funding.
- `BRIDGETOKENS` updates bridged-token contract authorities.
- `BRIDGEGUARDIANS` represents bridge guardian governance.
- `SMARTCONTRACTMAINTENANCE` (symbol `SCM`) represents update authority over
  network smart contracts.

All nine use the same two-step proposal flow:

1. PREGOV holders perform the 30-day 75%/75% council review.
2. Approved proposals enter four-day staggered voting by KAL holders, using a
   0.5% participation threshold and 50.10% approval quorum.

KAL governance can update each authority contract at key weight 0, but clients
should submit role actions as proposals to the relevant authority contract.
For example, required-version transactions belong to KIP proposals and KAL
mint transactions belong to MINT proposals.

TREASURY, TECH, MARKETING, BRIDGEGUARDIANS, and SMARTCONTRACTMAINTENANCE currently expose governed
authority contracts but do not yet have dedicated native transaction
integrations. Clients must not claim that those roles can execute their
described smart-contract or guardian operations until the corresponding
integration is deployed.

## Client status

`ProposalLedgerResponse.proposal_statuses` exposes typed active-proposal
records alongside the legacy encoded key/value arrays. Each `ProposalStatus`
contains:

- the raw proposal ID;
- the persisted `kal_validator.Proposal`;
- the effective ordered `pre_governance_stages` list and
  `pre_governance_stage_count`, including a legacy singleton as one entry;
- optional `pre_governance_stage`, the active zero-based council index while
  the phase is `PRE_GOVERNANCE`;
- `pre_governance`, the current council configuration during pre-governance
  (the first configured entry afterward), for legacy clients; and
- the ordered `post_governance_stages` list and `post_governance_stage_count`;
- optional `post_governance_stage` and current `post_governance` configuration
  while the phase is `POST_GOVERNANCE`; and
- `promotion_pending`, which indicates an accepted approval is awaiting
  activation of a council, entry into regular governance, or final execution.

Read `Proposal.phase` to distinguish:

- `PRE_GOVERNANCE`: council review is active;
- `REGULAR_GOVERNANCE`: the proposal is in the public governance pipeline;
- `POST_GOVERNANCE`: public approval has passed and the final council reviews
  remain before execution.

During `PRE_GOVERNANCE`, use `pre_governance_start_date` and
`pre_governance_end_date` for the current review window. `Proposal.stage` is
the zero-based pre-gov index in this phase; in regular governance it retains
the existing regular-stage meaning. During post-governance use
`post_governance_start_date`, `post_governance_end_date`, and `Proposal.stage`
for the current post step. The optional `post_governance_winning_option`
preserves the public result, including index zero. A pending initial post
activation can have no post window yet; clients must wait for activation.
The active proposal's legacy
weighted `yes` and `no` maps are not authoritative member counts. Final council
results serialize the captured member counts under the council instrument;
confirm the committed result rather than deriving approval from raw holdings.

Each committed pre-governance `ProposalResult` identifies its zero-based step
in `stage`. An intermediate passing result approves that council only; the
proposal remains in pre-governance until the last council passes. Post results
set `post_governance` and their zero-based `stage`; a result cannot identify
both council phases. The final passing post result releases the public actions.

The bounded `ProposalDetail` response also exposes the effective list, optional
active indices, frozen public winner, and pending-transition flag. During
either council phase its `start` and `end` describe the current council window.
Those dates are omitted while initial post activation is pending without a
representable window.

Failed and cancelled proposals are removed from the active proposal database.
Clients should derive their terminal status from the committed
`ProposalResult` or cancellation transaction rather than expecting a retained
active record.

## Smart-contract creation limitation

Council configuration is currently accepted through protobuf contract
creation and update transactions. The legacy smart-contract Postcard contract
schema is positional and has no layout-version marker, so adding a nested
`Governance` field would make existing payloads ambiguous. Smart contracts
must not attempt to configure council arrays until a versioned Postcard schema
is introduced.

## Implementation validation

### Proposal-specific additional councils

On November 10, 2026, all 51 focused CTest cases selected for proposal-specific
additional councils passed, with zero skipped or pending selected cases. This used
an assertion-enabled Debug build with -O2, all nine opt-in options enabled, and
the pinned real Wasm artifacts and converter. Coverage includes signed additive
PRE/public/POST lifecycles, concurrent proposal groups, exact upfront fees, mixed
STAGED/CYCLE cut accounting, empty base phases, cancellation, snapshot/API
integrity, all 64 council projections with bounded cleanup/counter checks, and
existing legacy, recovery and branch-restoration regressions.

The [focused validation record](../../.audit-test-scratch/proposal-councils-validation.json)
binds the selected passes to their commands, properties, executable/argument
hashes, runtime fingerprint and required source assets. Source-driven gates also
match the final source snapshot. Results aggregate verified serial runs.

On November 10, 2026, subsequent full-suite validation passed all 329 registered
CTest cases, with zero skipped or pending cases and all nine opt-in settings
enabled. The results are recorded in the
[full-suite coverage record](../../.audit-test-scratch/proposal-councils-full-suite-coverage/current-coverage.json).

### Earlier full-suite validation

Before proposal-specific additional councils were introduced, all 327 registered
CTest cases passed on 2026-11-10, with zero skipped or pending cases. That full-suite
result describes the earlier source snapshot. Validation used an assertion-enabled Debug build with -O2 in Ubuntu/WSL, the pinned RocksDB 8.0.0, WasmEdge 0.11.2 and blst dependencies, and the real Wasm fixture artifacts recorded in the evidence. The pinned WABT converter's verified SHA3-256 was `79e13c5c859ba316f2512fd9003e4d23fe11747a3425a946a6c6d953d3d637c0`. All nine opt-in options were ON:

- `KAL_ENABLE_SECURITY_LOAD_TESTS`
- `KAL_ENABLE_KAL082_REGRESSION`
- `KAL_ENABLE_KAL008_REGRESSION`
- `KAL_ENABLE_PENDING_WINDOW_REGRESSION`
- `KAL_ENABLE_KAL009_REGRESSION`
- `KAL_ENABLE_KAL010_REGRESSION`
- `KAL_ENABLE_KAL083_REGRESSION`
- `KAL_ENABLE_KAL083_ITEM_REGRESSION`
- `KAL_ENABLE_KAL014_REGRESSION`

Coverage aggregates immutable serial runs. Every retained compiled-case pass matches the current test command and properties, executable and argument-artifact hashes, converter/runtime fingerprint, and required source assets. Source-driven gates also match their required source snapshot. Failed, skipped, and unfinished test cases do not count. Completed passing cases from interrupted serial runs may be retained only when all required evidence bindings match. The [sealed coverage report](../../.audit-test-scratch/pre-proposal-councils-validation/coverage/current-coverage.json), [registry](../../.audit-test-scratch/pre-proposal-councils-validation/coverage/registry.json), [binary manifest](../../.audit-test-scratch/pre-proposal-councils-validation/coverage/binaries.json), and [runtime fingerprint](../../.audit-test-scratch/full-suite-runtime-fingerprint.json) retain the exact comparisons, external digests and per-case provenance.

Live-chain fixture repairs drain real certified maintenance and use actual committed history and heights. Sync lock controls drain before pausing, then retain the 10-second ordinary-writer check. Pending-only nonce checks are distinct from committed nonces; production expiry retains exact omitted pending/relay pairs at 600 seconds and retires them at 601 without canonical effects. Component item fixtures initialize the exact clean-genesis frozen-store marker only in a checked empty namespace and verify proposal/tally/contribution persistence after close/reopen. Production validation, wire, progress, fee, nonce and rollback guards remain enforced.

Outer timeouts account for measured maintenance and fresh-process costs: `two-validator-replay` and `kal008-live-group-terminal`, 2400 seconds; `solo-runtime`, 240; `sync-lock-coherence`, 360; `sync-lock-processing-cancel`, 300; and `kal010-validator-cap-boundary-extras`, 1800. Internal writer, latch, converter, work and progress bounds remain unchanged.

### Historical focused validation

All 22 targeted CTest cases passed during the earlier focused POST validation, covering configuration, signed lifecycle, pending recovery, council membership/ballots, API bounds, governance regressions and signed singleton/array/branch-restoration controls. The complete repository suite was not run during that earlier phase.

The signed POST flow exercised PRE → public → POST A/B/A, immutable public option
selection, opt-out, stale phase/step rejection, fresh windows/ballots, exact fees
and cancellation refunds, native action effects, and deadline failure. It reached
height 436 with 415 maintenance blocks and 140 database reopen phases; maximum
serialized redo was 21,882 bytes. Blocks were replayed from the same parent.

Separate final-binary cohort checks used 100 escrow units and a 30-unit POST
reserve. CYCLE winner/cut/failed outcomes debited 70/100/100; interim STAGED
winner/cut/failed outcomes debited 35/100/100. Actual remaining balances and
validator/treasury/burn allocations matched exactly, with no redundant proposal
rereads added to bounded capture.

That earlier focused build matched 66 changed/generated files, including 16
protobuf outputs, against its tested ext4 copy. Aggregate SHA-256:
`cabcaa5caa32d0641723e2d82c60d13d6410259777092946665ae730e266caa1`.
Unchanged tracked files, documentation, scratch and external dependencies are
outside that comparison scope. That build's runtime libraries resolved without missing dependencies.

Historical WSL evidence is retained in `/tmp/kal-postgov-*.log`,
`/tmp/kal-postgov-source-final.{sha256,json}`, and
`/tmp/kal-postgov-runtime-final.ldd.txt`.
