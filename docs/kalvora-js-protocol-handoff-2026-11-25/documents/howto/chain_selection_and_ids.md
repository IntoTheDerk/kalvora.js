# Selecting the main or proto chain

The clean-genesis validator uses one explicit network choice in
`validator.conf`:

```text
chain:main
```

or

```text
chain:proto
```

The entry is required exactly once, including in local mode. The older
`protonet:` setting is optional; if it remains in a config file, it must agree
with `chain` (`false` for main, `true` for proto). A conflicting or unknown
value prevents startup. The selected readable network name is durably stored
with genesis as `KAL_NETWORK_ID_V1` and checked again on restart and after
seed sync. A regular restart cannot silently switch a committed main database
to proto or the reverse.

Existing data created before this marker was introduced fails startup rather
than receiving an automatic backfill. The selected launch path is a brand-new
clean genesis. Keep any older data only as a separate archive or use an
explicitly reviewed migration procedure if one is later designed.

## IDs sent on the wire

The network name is `kal_main` for `chain:main` and `kal_proto` for `chain:proto`. From height one, ordinary transactions and network-bound consensus statements use this 32-byte ID.

```text
SHA-256(ASCII("KAL_CHAIN_ID_V2|") || ASCII(network_name) || ASCII("|") || raw_final_genesis_hash)
```

Decode the pinned 64-character block-zero hash into 32 bytes before hashing. Put the raw 32-byte SHA-256 result in `BaseTXN.chain_id`. A wallet can compute the ID offline from the published network name and `CONSENSUS_GENESIS_HASH`. Changing either input produces a different chain identity. Block zero uses manifest-bound domains for wallet registration, validator assignment and the initial heartbeat. [Genesis ceremony](falcon_genesis.md)

A validator joining a fresh proto chain installs the published signed genesis
artifact and verifies its configured hash. That block initializes the founder
committee on every node. The joining validator verifies ordinary certificates
from height one. If `CONSENSUS_BOOTSTRAP_OWNER` is set, use the founding
owner's Base58 wallet address.

## Forking main state for testing

An explicit proto fork of certified main state at height one or later uses a **separate `DATA_DIR`**,
`chain:proto`, and an explicit 64-hex-character `PROTONET_NETWORK_ID` seed.
The fork startup derives its trusted anchor from the imported tip, performs
its local bootstrap, and atomically changes the committed network marker to
`kal_proto`. A restart of that fork retains its marker. Do not point a proto
validator at an in-use main data directory or treat a config edit alone as a
fork procedure. The [attestation setup guide](../attestation-v2/keys-and-registration.md)
describes the persisted namespace record and bootstrap requirements.

A validator joining an already running **imported fork** needs a trusted copy
of that fork's completed `DATA_DIR/config/attestation/protonet-network.state`
with private owner-only permissions and the matching verified post-bootstrap
state. The record preserves the source anchor and local namespace.

The imported main-to-proto fork bootstrap block is a trusted **local**
transition and has no ordinary finality certificate. A second validator
cannot fetch that block with the normal certified block-sync route. It needs
an operator-controlled, verified post-bootstrap state import before it joins
the fork, or a future protocol change that gives this transition a verifiable
remote proof. The current code does not provide that remote proof.

The seed and anchor isolate the fork's local BLS keys, signing journals and consensus storage. Two proto forks inheriting the same block zero share a public transaction chain ID. A signed transaction may execute on both when its nonce, funds and other checks pass. Two fresh proto launches with different block-zero hashes have different wire IDs. A main-to-proto import also changes the network name used to calculate the ID.

Each process binds its signing context to the committed genesis hash after checking the launch artifact. The genesis contract-ID domain `KALVORA_MAINNET_V1` continues to identify native contract derivation. [Network implementation](../../kal_validator/crypto/attestation_network.h)

## Rollout check

Update every validator's config file before starting the new binary. Update
all transaction signers to use the exact raw wire ID for their selected
network, alongside `signature_domain` and `intended_type` from the
[signed transaction guide](signed_transaction_context_v1.md). Validate a
main-to-proto signature rejection and a same-network signed transaction on
independent validators before accepting public traffic.
