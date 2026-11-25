# Client Governance Proposals and Voting

This guide explains how a client submits a governance proposal, discovers its
state, and votes on it through `TXNService` on port `50052`.

## Prerequisites

Before building either transaction, the client should:

1. Fetch the target `InstrumentContract` and inspect its `Governance`
   configuration.
2. Query the sender's latest nonce and use `nonce + 1`.
3. Select an accepted fee token and calculate a sufficient fee allowance.
4. Use the sender's typed public key and current timestamp in `BaseTXN`.
5. Pin the target chain ID and set the V1 signature domain and concrete
   transaction type as described in the
   [signed transaction context guide](signed_transaction_context_v1.md).

To propose, the sender must hold a positive balance in at least one contract
listed by `governance.allowed_proposal_instrument`. A restricted key must also
have proposal permission.

To vote, the wallet must have voting power in the instrument used by the
proposal's current phase:

- `PRE_GOVERNANCE` uses `governance.pre_governance.voting_instrument`.
- `REGULAR_GOVERNANCE` uses the regular `governance.voting_instrument` list.

Regular NFT/SBT voting power is the sum of the wallet's active item
`voting_weight` values. Pre-governance instead counts distinct eligible member
wallets, enforcing `pre_governance_contract_id` item scopes and compliance.
See the [council guide](client_pre_governance.md).

When KAL is the voting instrument, the validator adds the staking proxy's
stored vote-weight snapshot to the wallet's ordinary KAL voting balance. The
supplied six-month staking term starts at 103% of principal still locked in
that stake; its stake-backed weight declines when principal is **actually
paid back**, not merely when a payout date arrives. Returned KAL then counts
through the wallet's ordinary balance. Other voting instruments do not gain
KAL stake weight. The final staking deployment and economic replay remain
launch checks, so clients should read finalized state rather than forecast a
vote total solely from a payment schedule.

## Frozen regular-voting ratios

Protocol-12 governance settings require exactly one `voting_ratio` for each
canonical `voting_instrument`, with that instrument's `contract_id` and positive
`uint64` `numerator` and `denominator`. Missing, duplicate or unrelated entries
are rejected. The validator copies these ratios into each accepted ordinary
proposal; later ratio updates do not reweight that proposal.

For each instrument and choice, raw ballots are aggregated before conversion:
`floor(raw_total * numerator / (coin_denomination * denominator))`. NFT/SBT
conversion uses denomination 1. Supply uses the same frozen ratio and rounding.
Converted values and persisted aggregates are bounded to 512 bits. The contract
author must choose the intended common voting unit explicitly, including for
KAL and stable tokens. Granular voting retains its separate accepted parameters
and does not use these proposal ratios.

## Common transaction signing

For an ordinary **single-key** sender, `GovernanceProposal` and
`GovernanceVote` use this signing sequence. The signed context fields must be
present before signing. Signed
proposal submissions, votes, and cancellations use the ordinary user domain
and the same ten-minute timestamp window as other user transactions:

1. Populate the complete transaction with `base.signature` and `base.hash`
   unset.
2. Serialize the protobuf deterministically and sign those bytes.
3. Store the detached signature in `base.signature`.
4. Serialize again with the signature present and `base.hash` still unset.
5. Set `base.hash` to the 32-byte SHA3-256 digest of those bytes.

A base-key multisig sender leaves `base.signature` absent and puts its
signatures in `base.public_key.multi.signatures[]`. Follow the canonical
clearing rules in [Signed transaction context V1](signed_transaction_context_v1.md#signing-order).

Do not Base58-encode binary protobuf fields. Public keys, proposal IDs,
signatures, hashes, and wallet addresses remain raw bytes on the wire.

## Creating a proposal

The protocol-12 candidate limits signed ADAPTIVE and GRANULAR end timestamps
to 90 days after the accepting candidate's timestamp. A future requested start
does not extend this limit. STAGED, CYCLE and STAGGERED retain the contract
calendar. An original proposer may cancel an open proposal before its result
freezes; unused escrow returns to the recorded payer, retaining earned fees.
Administrators gain no cancellation right. See the
[availability implementation handoff](../security/REPORT_20261106_governance_availability_v12.md)
for the current verification status.

Submit a `kal_txn.GovernanceProposal` through:

```protobuf
rpc GovernProposal(GovernanceProposal) returns (google.protobuf.Empty);
```

The proposal message contains:

```protobuf
message GovernanceProposal {
    BaseTXN base = 1;
    string contract_id = 2;
    string title = 3;
    string synopsis = 4;
    string body = 5;
    repeated string options = 6;
    optional google.protobuf.Timestamp start_timestamp = 7;
    optional google.protobuf.Timestamp end_timestamp = 8;
    repeated GovernanceTXN governance_txn = 9;
    repeated GovernanceOptionTXNS governance_option_txns = 10;
    ProposalType proposal_type = 11;
}
```

`proposal_type` classifies the proposal as `PROPOSAL_TYPE_PROPOSED`,
`PROPOSAL_TYPE_GRANT`, `PROPOSAL_TYPE_RECIPROCAL`, or `PROPOSAL_TYPE_OTHER`.
The omitted/default `PROPOSAL_TYPE_NONE` is currently accepted; choose an
explicit value when the application needs a meaningful classification.

### Basic binary proposal

A binary proposal uses no `options`. Any approved actions belong in
`governance_txn`.

```text
proposal = GovernanceProposal {
    base: make_base(sender_key, nonce, fee_id, fee_amount)
    contract_id: TARGET_CONTRACT_ID
    title: "Example proposal"
    synopsis: "Short description shown in proposal lists"
    body: "Complete proposal rationale and execution details"
    governance_txn: [ACTION_1, ACTION_2]
}

sign_and_hash(proposal)
TXNService.GovernProposal(proposal)
proposal_id = proposal.base.hash
```

The proposal ID is the raw `base.hash`. Store both its raw bytes and a Base58
display form. Vote transactions must send the raw bytes.

### Proposals with options

Only use options when `governance.allow_multi` is true.

Each `GovernanceOptionTXNS` associates executable actions with an option:

```text
options: ["against", "option A", "option B"]

governance_option_txns: [
    {
        option_index: 1
        governance_txn: [ACTIONS_FOR_OPTION_A]
    },
    {
        option_index: 2
        governance_txn: [ACTIONS_FOR_OPTION_B]
    }
]
```

`options[0]` must be the exact case-sensitive string `against`; index `0` is
the no-action option. Later option labels must avoid the node's forbidden
words (including `yes`, `no`, `pass`, and `fail`). Action-bearing option
indexes must be unique, greater than zero, and less than `options_size`.
Do not combine top-level `governance_txn` with an option proposal.

### Governance actions

An executable action is embedded as:

```protobuf
message GovernanceTXN {
    TRANSACTION_TYPE txn_type = 1;
    bytes serialized_txn = 2;
    bytes txn_hash = 3;
}
```

`serialized_txn` contains the exact serialized action transaction.
`txn_type` must match that message, and `txn_hash` must match its verified
hash. Build these actions for the target contract's
`gov_<contract_id>` authority. Invalid, unauthorized, or mismatched embedded
transactions cause the proposal transaction to fail.
Embedded children must leave `base.fee_payer` absent and must not carry
interface fees. The voted child replay does not verify a sponsor signature.
An embedded `GovernanceProposal` (`PROPOSAL_TYPE`) is not allowed; submit a
new proposal as its own ordinary signed transaction.

Each executable child hash must be unique within the top-level action list
or within its own option branch. Different mutually exclusive option branches
may reuse a child hash.

### Proposal timing

- `GRANULAR` uses proposal-specific timestamps, percentages, and an immutable
  voter whitelist. See [Client Granular Governance Guide](client_granular_governance.md)
  for equal/instrument voting and the bounded typed `ProposalDetail` query.
- `ADAPTIVE` governance requires both `start_timestamp` and `end_timestamp`,
  with start earlier than end.
- Staged, cycle, and staggered governance derive timing from the contract.
- If the contract has pre-governance, the normal proposal transaction first
  enters `PRE_GOVERNANCE`; clients do not submit a separate council proposal.

## Discovering the proposal state

Call the API service's `ProposalLedger` RPC and inspect
`ProposalLedgerResponse.proposal_statuses`.

For each `ProposalStatus`:

- `proposal_id` is the raw ID used by `GovernanceVote`.
- `proposal.phase` is `PRE_GOVERNANCE` or `REGULAR_GOVERNANCE`.
- `proposal.yes`, `proposal.no`, and `proposal.options` contain current totals.
- `pre_governance` contains council configuration when enabled.
- `promotion_pending` indicates council approval is waiting to enter regular
  governance.

Clients must not assume that every active proposal is open to regular voters.
Use the explicit phase and timestamps.

## Voting on a proposal

Submit a `kal_txn.GovernanceVote` through:

```protobuf
rpc GovernVote(GovernanceVote) returns (google.protobuf.Empty);
```

```protobuf
message GovernanceVote {
    BaseTXN base = 1;
    string contract_id = 2;
    bytes proposal_id = 3;
    optional bool support = 4;
    optional uint32 support_option = 5;
}
```

`contract_id` must match the proposal's contract and `proposal_id` must be the
raw proposal hash.

### Binary vote

Use `support` and leave `support_option` unset:

```text
vote = GovernanceVote {
    base: make_base(voter_key, nonce, fee_id, fee_amount)
    contract_id: TARGET_CONTRACT_ID
    proposal_id: RAW_PROPOSAL_ID
    support: true
}

sign_and_hash(vote)
TXNService.GovernVote(vote)
```

Use `support: false` to oppose.

Pre-governance always requires this binary form. Council votes using
`support_option` are rejected.

### Option vote

For a regular proposal whose stored state has `options_set`, leave `support`
unset and set a valid zero-based option index:

```text
vote = GovernanceVote {
    base: make_base(voter_key, nonce, fee_id, fee_amount)
    contract_id: TARGET_CONTRACT_ID
    proposal_id: RAW_PROPOSAL_ID
    support_option: 2
}
```

The index must identify an option in the proposal. Do not send
`support_option` for a binary proposal.

### Changing a vote

Submit another `GovernanceVote` for the same proposal, phase, and stage. The
validator removes the wallet's current live voting power from its old choice
and adds its current voting power to the new choice.

Regular NFT/SBT and token voting power remain live while the proposal is open.
Transfers, mints, revokes, burns, balance changes, activation, and expiry can
change the recorded weight without requiring another vote. Bounded maintenance
reconciles these changes before freezing a result; the frozen conversion ratios
do not change. A closing barrier may temporarily pause ordinary transaction
execution. Admission to the mempool does not bypass that barrier.

A council vote does not carry into regular governance after promotion. The
wallet must vote again in the regular phase if it also has regular voting
power.

## Sponsored votes

`GovernanceVote` may use `BaseTXN.fee_payer`. The voter first signs the vote,
then the sponsor signs the voter-signed transaction and supplies the sponsor
nonce. See
[`../done/third_party_fee_payer_client_integration.md`](../done/third_party_fee_payer_client_integration.md)
for the exact signing order.

`GovernanceProposal` also accepts `BaseTXN.fee_payer` in the current version.
Use the same user-then-sponsor signing order and the sponsor's next nonce.

## Submission and confirmation

A gRPC `OK` response means the transaction passed initial verification and
entered the mempool. It does not mean the proposal or vote executed.

To confirm:

1. Save `base.hash` before submission.
2. Poll blocks and find the matching `TXNStatusFees.txn_hash`.
3. Require `TXNStatusFees.status` to be present and equal to `OK`; an absent
   optional field decodes to the enum default `OK` in proto3 but is not a
   success receipt. Verify the block's finality evidence as described in the
   [client API guide](client_api_reference.md#transaction-lifecycle-and-confirmation).
4. Re-query proposal state and verify the expected phase or tally.

Common failures include:

- `CONTRACT_HAS_NO_GOVERNANCE`
- `INVALID_PROPOSAL_ID`
- `PROPOSAL_NOT_IN_VOTING_PERIOD`
- `INVALID_WALLET_ADDRESS` when the wallet lacks proposal or voting power
- `INVALID_PARAMETERS` for the wrong binary/option vote shape
- fee, signature, nonce, compliance, or restricted-key failures

If a nonce fails, query it again and rebuild and re-sign the entire
transaction.
