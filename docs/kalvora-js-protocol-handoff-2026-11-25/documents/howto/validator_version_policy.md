# Validator version policy at clean genesis

Updated 2026-11-24. This is for validator operators and developers who build
validator registration or governance tooling. The network now reads validator
eligibility from a **committed** `REQUIRED_VERSION` policy row. The first
clean-genesis block seeds that row with the build's `VERSION` constant before
the validator archive is built. For the current local clean-genesis candidate,
the block header and validator registration version is `200030`, and the signed
attestation protocol version is `33`. Read these values from the exact release you deploy.
Every participating validator must use the same proposer schedule from genesis.
V12 (`200009`) selects proposers using the preceding block hash. V13 uses
the public network ID and target height with the finalized validator weights.
V14 (`200011`) retains that schedule and accepts wallet-signed creation of
the launch contracts. V13 (`200010`) validators would reject those deploys.
V15 (`200012`) adds one gas per started eight bytes to the existing instruction
charge for Wasm `memory.copy`, `memory.fill` and `memory.init`. The interpreter
charges against the executing call's budget before modifying guest memory.
V16 (`200013`) checks token-admin inheritance after applying every successful
change already accepted at that point in the candidate. A validator that
discards a local trial reconstructs the same relationships as a peer replaying
the block. V17 (`200014`) charges calibrated compute gas for nine smart-contract
utility imports. Contracts with tight gas allowances can exhaust them under
this schedule. V18 (`200015`) charges 2,048 compute gas plus 2.5 gas per
deployed Wasm byte, rounded up, when a module needs preparation under the
protocol's reuse rules. V19 (`200016`) adds bounded compliance-grant storage.
V20 (`200017`, protocol `20`) was the earlier isolated no-preparation-gas
comparison build. V21 (`200018`, protocol `21`) added delegated vote group
totals so a same-root recast does not reread every represented wallet. V22
(`200019`, protocol `22`) was its no-preparation-gas comparison build.
V23 (`200020`, protocol `23`) also omitted voting activation and expiry jobs
for timed items without voting weight. V24 (`200021`, protocol `24`) was its
no-preparation-gas comparison build. V25 (`200022`, protocol `25`) skips full
proposal-body reads for council siblings in another voting phase by checking
the recorded availability projection first.
V26 (`200023`, protocol `26`) was its isolated no-preparation-gas comparison
build. V27 (`200024`, protocol `27`) also avoids
queuing council membership work for a KYC authority with no consumers. The
assignment and expiry records remain. V28 (`200025`, protocol `28`) is its
isolated no-preparation-gas comparison build. The V29 candidate
(`200026`, protocol `29`) adds a contract-ordered nonempty cohort index so
historical closing skips empty STAGED/CYCLE ledgers. V30 (`200027`, protocol
`30`) is its isolated no-preparation-gas comparison build. V29 and V30 cannot
vote together or alongside V21 through V28. V31 (`200028`, protocol `31`)
keeps the cohort index and introduces registered Falcon wallets and signed
genesis. V32 (`200029`, protocol `32`) is its isolated no-preparation-gas
comparison build. V33 (`200030`) commits the initial validator assignment and
heartbeat in signed genesis. Every later block requires ordinary finality starting
at height one. V34 (`200031`) is its isolated no-preparation-gas comparison build.
V33 requires a fresh format-2 genesis and separate data directory. Retain the
matching V31 binary to access an existing V31 chain.
Use that build and a fresh data directory for the first validator. Joining
validators use the same genesis and fee rules regardless of physical cache size.

## What the row means

- The first version in the ordered list is the governance-selected checkpoint
  target. Later distinct versions are compatibility allowances. Every entry
  must be positive, the list cannot be empty or contain duplicates, and its
  encoded policy cannot exceed 64 KiB.
- Committee archive eligibility requires both policy membership and an exact
  match to the running validator build's `VERSION`. The current build excludes earlier and
  future registrations even when governance lists them in this row.
- A missing, unreadable, oversized, or malformed committed row is a startup
  or candidate-processing error. Validators must not invent a local default
  while replaying existing chain state.
- `RequiredVersion` is an unsigned governance-produced child operation. Wallets
  and public transaction builders should not submit it as an ordinary signed
  user transaction. Changing the policy requires the network's authorized
  governance path and a coordinated validator rollout.

## Operator checks

1. Start a brand-new chain from the intended clean-genesis build. Check that
   its committed version policy was seeded and that the first archive includes
   the intended version. A joining validator must sync the same committed row.
2. Before introducing a new validator binary, confirm its header and vote
   protocol compatibility with the chain. Merely adding its number to
   `REQUIRED_VERSION` does not make it eligible to join the current committee. Plan a
   coordinated protocol transition and verify enough validators run the exact
   chain version throughout it.
3. After restart or synchronization, treat a missing or corrupt policy row as
   a ledger/state problem to investigate. Do not edit a local RocksDB row or
   reset the version policy by hand; that would make this validator disagree
   with the network.

Implementation anchors: `kal_validator/headers/required_version_policy.h`,
`kal_validator/attestation/consensus_bootstrap.cpp`,
`kal_validator/proposer/validator_balances.cpp`, and
`kal_validator/util/validator_config.cpp`. The broader launch procedure is in
[Kalvora clean genesis](kalvora_clean_genesis.md).

The [protocol specification](../attestation-v2/protocol.md) defines the proposer
schedule and the parent-bound signatures that peers verify. The earlier
[protocol-12 security release](validator_consensus_v12_security.md) records
an earlier version boundary.
