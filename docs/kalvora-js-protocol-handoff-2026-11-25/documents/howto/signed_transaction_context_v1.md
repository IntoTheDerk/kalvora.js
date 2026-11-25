# Signed transaction context V1: client migration guide

This guide is for developers who build or sign KAL transactions. It describes
the clean-genesis signature cutover for O21. A transaction signature now commits
to **which KAL chain** and **which concrete transaction type** the signer
intended. Validators and every launch signer must use the same V1 schema and
rules from height one. At block zero the two wallet registrations, founding
validator assignment and initial heartbeat use manifest-bound genesis domains.

The network rollout is complete only when the validator, generated protobuf
types, `kalvora.js`, the C++ `sc-client`, `dev-client`, validator-owned signers,
and any other launch wallet or offline signer have been updated and tested
together. This document states the required wire/signing contract; deployment
readiness is tracked by the audit, not implied by the presence of this guide.

## What to put in `BaseTXN`

Regenerate client protobuf code from the launch version of
`kal_validator/proto/txn.proto`. Its `BaseTXN` adds:

```proto
bytes signature_domain = 16;
bytes chain_id = 17;
TRANSACTION_TYPE intended_type = 18;
```

Field 14 remains reserved and its old `sc_fee_address` encoding is rejected;
field 15 remains `fee_payer`. Supply all three new
fields **before producing any signature**:

| Field | Ordinary signed transaction | Validator-signed internal result |
| --- | --- | --- |
| `signature_domain` | UTF-8 bytes of the exact ASCII string `KAL_USER_TXN_V1` | UTF-8 bytes of `KAL_PROPOSAL_RESULT_V1` |
| `chain_id` | Exactly 32 raw bytes of the target chain identity | Same target chain identity |
| `intended_type` | Enum value for the concrete protobuf message being signed | `PROPOSAL_RESULT_TYPE = 14` |

These are protobuf **bytes**, not a hex or Base58 string on the wire. They are
included in the serialized typed message that is signed and hashed. Do not let
an RPC method name, gossip envelope, `TXNWrapper.txn_type`, or caller-supplied
enum override the concrete message type. A generic signing API should infer the
type from its typed builder and reject a conflicting `intended_type`.

`signature_domain` is a fixed protocol label, not a configurable app name. A
missing value, another spelling, an unknown future version, a chain ID of the
wrong length, a foreign chain ID, or the wrong type must fail validation.

These fields protect different boundaries. `chain_id` binds the approval to
the intended chain. `intended_type` stops the same protobuf bytes from being
reinterpreted as another transaction operation. `signature_domain` separates
ordinary wallet approvals from validator-generated results and gives a future
incompatible signing format a distinct label. It is not a replacement for
checking the chain ID or transaction type.

### How the signer obtains the chain ID

Pin the network name and published final block-zero hash in trusted client configuration. Decode the 64-character hex hash to 32 raw bytes. The wire ID is

```text
SHA-256(ASCII("KAL_CHAIN_ID_V2|") || ASCII(network_name) || ASCII("|") || raw_final_genesis_hash)
```

Place the raw 32-byte result in `BaseTXN.chain_id`. The network name is `kal_main` or `kal_proto`. A different genesis on the same named network produces a different ID. Proto forks that inherit the same block zero share a wire ID and can accept the same signed transaction when their other state permits. Before the final genesis hash exists, the owner and operator sign their wallet registrations under `KAL_GENESIS_WALLET_V1`. They sign the founding validator assignment under `KAL_GENESIS_VALIDATOR_V1`, and the operator signs the initial heartbeat under that same domain. All four transactions use the unsigned manifest's ID. [Genesis signing ceremony](falcon_genesis.md) · [Chain selection](chain_selection_and_ids.md)

### Concrete type mapping

Use the numeric enum from the generated protobuf definitions. The spelling
`UKNOWN_TYPE = 0` in the schema is intentional here; zero is never a valid
signed intent.

| Concrete protobuf message | `intended_type` |
| --- | --- |
| `CoinTXN` | `COIN_TYPE = 1` |
| `MintTXN` | `MINT_TYPE = 2` |
| `ItemizedMintTXN` | `ITEM_MINT_TYPE = 3` |
| `InstrumentContract` | `CONTRACT_TXN_TYPE = 4` |
| `GovernanceVote` | `VOTE_TYPE = 5` |
| `GovernanceProposal` | `PROPOSAL_TYPE = 6` |
| `SmartContractTXN` | `SMART_CONTRACT_TYPE = 7` |
| `SmartContractExecuteTXN` | `SMART_CONTRACT_EXECUTE_TYPE = 8` |
| `ExpenseRatioTXN` | `EXPENSE_RATIO_TYPE = 9` |
| `NFTTXN` | `NFT_TYPE = 10` |
| `ContractUpdateTXN` | `UPDATE_CONTRACT_TYPE = 11` |
| `ValidatorRegistration` | `VALIDATOR_REGISTRATION_TYPE = 12` |
| `ValidatorHeartbeat` | `VALIDATOR_HEARTBEAT_TYPE = 13` |
| `ProposalResult` (internal only) | `PROPOSAL_RESULT_TYPE = 14` |
| `DelegatedTXN` | `DELEGATED_VOTING_TYPE = 15` |
| `RevokeTXN` | `REVOKE_TYPE = 16` |
| `ComplianceTXN` | `COMPLIANCE_TYPE = 19` |
| `BurnSBTTXN` | `SBT_BURN_TYPE = 20` |
| `RequiredVersion` (governance-only unsigned child; no public signer) | `REQUIRED_VERSION = 21` |
| `SmartContractInstantiateTXN` | `SMART_CONTRACT_INSTANTIATE_TYPE = 22` |
| `AllowanceTXN` | `ALLOWANCE_TYPE = 23` |
| `ProposalCancelTXN` | `PROPOSAL_CANCEL_TYPE = 24` |
| `WalletRegistration` | `REGISTER_WALLET_TYPE = 25` |

Enum values 17 and 18 are reserved retired transaction types. They must not be
used as signed intent values.

## Signing order

Build the **complete concrete protobuf message**, including timestamp, nonce,
fees, authorizations, and the three context fields. Freeze everything that
the user is asked to approve before collecting signatures. Serialize protobuf
bytes using the generated codec for that concrete type; do not sign JSON, a
wrapper, a displayed string, or a manually concatenated prefix. The V1 context
is carried inside `BaseTXN`, so no second external signature envelope is added.

For an ordinary single-key transaction:

1. Set `base.signature_domain`, `base.chain_id`, and `base.intended_type`.
2. Leave `base.hash`, `base.signature`, and `base.fee_payer` absent. Serialize
   the typed transaction. Sign those exact bytes with the sender's Falcon-512 or
   Falcon-1024 private key and store the detached signature in `base.signature`.
3. With `base.hash` still absent, serialize the now-signed transaction. Set
   `base.hash` to the **raw 32-byte SHA3-256** digest of that serialization.
   The validator's legacy helper name `sha256_hash` still implements SHA3-256.
4. Do not mutate any signed field. A changed timestamp, nonce, fee, domain,
   chain ID, or intended type requires fresh signatures and a fresh hash.

Identify each ordinary signer with its registered `PublicKey.wallet_address`. The verifier resolves the public key or policy from the parent block's wallet registry. At wallet registration it verifies the new key directly against the derived address. For a registered multisig, the owner message clears `base.public_key.witnesses` and each participating member signs the same bytes. Return the signatures as indexed witnesses on the policy address. [Multisig wallets](multisig_wallets.md)

### Coin inputs and governance children

For a `CoinTXN`, populate every transfer, address, authorization nonce, fee share and context field before collecting signatures. Leave `base.signature` empty. To construct the common signing message, clear `base.hash`, `base.fee_payer`, all `auth.signature` entries and each authorization identity's witnesses. Each single-key input places its signature in the matching `auth.signature` slot. A policy input uses an empty signature slot and puts its indexed member witnesses on its address. Compute the final hash after attaching the signatures. Coin fee sharing uses its input authorizations. [Coin signing and verification](../../kal_validator/crypto/signatures.cpp)

A governance child that debits an ordinary wallet also needs that wallet's authorization. Governance execution checks the designated governance authority and validates ordinary inputs against their own wallet addresses. [Governance debit checks](../../kal_validator/crypto/signatures.cpp)

### Sponsored transactions

Only transaction types allowed by the current `fee_payer` policy may use a
third-party sponsor. The sender sets V1 context and signs the typed transaction
**without** `base.fee_payer`. Then add the registered sponsor wallet address and sponsor nonce
to `base.fee_payer`, leaving its signature empty. The sponsor signs the
user-signed typed transaction with `base.hash` and only
`base.fee_payer.signature` cleared; the user signature and the sponsor's address
and nonce remain present. Store that sponsor signature, then compute the final
post-signature `base.hash`. The sponsor must use a registered single-key Falcon wallet
and cannot be the sender. The V1 fields must be present before **both**
signatures. See [third-party fee payer integration](../done/third_party_fee_payer_client_integration.md)
for the fee and nonce behavior.

### Validator registration, heartbeat, and proposal result

Validator-owned registration and heartbeat signers also set V1 context before
signing. The owner and operator sign the same typed validator assignment with `base.hash`, `base.signature`, owner witnesses, `base.fee_payer` and `generated_signature` cleared. Set the owner's `base.signature` and the operator's `generated_signature`, then hash the signed transaction. A heartbeat uses its concrete
`ValidatorHeartbeat` type and the ordinary user domain.

`ProposalResult` is a validator-generated, validator-signed internal message.
It uses `KAL_PROPOSAL_RESULT_V1` and `PROPOSAL_RESULT_TYPE = 14`; public clients
do not submit or invent results. Its separate domain does not exempt it from
chain or concrete-type matching. The approved proposal's other unsigned
children retain their own governance authorization and reconstruction checks;
they do not acquire a fake wallet signature or a user timestamp expiry.

## What a rejection means

A context mismatch is an invalid signature intent and must be rejected at
public ingress and again when validators replay a candidate block. It must not
reserve a nonce, charge a fee, add a pending transaction, or mutate state. A
retyped transaction can retain syntactically plausible protobuf and hash
bytes; the validator compares `intended_type` to the **concrete parsed type**
before economic processing. Do not treat a transport `OK` as execution or
finality; look up the transaction hash in a certified block and check its
`TXNStatusFees` receipt as described in the [client API guide](client_api_reference.md).

Signed proposals, votes, and cancellations are ordinary user transactions for
the signed timestamp rule. A signed transaction must be within the configured
10-minute past **and** future window at admission and first block inclusion.
If it ages out before inclusion, rebuild it with a current timestamp and
valid nonce, then sign and hash again. Unsigned transactions produced after a
governance vote are handled by network authority, not that user timestamp
window.

## Required rollout and interoperability checks

1. Regenerate protobuf clients and update the central `kalvora.js` finalizer,
   its Coin helpers (`src/sign/finalize.ts`), the C++ `sc-client` signer
   (`smart_contract_client/smart_contract_client/util/signatures.cpp`), and
   `dev-client`'s direct KAL proposal/vote/cancel signer
   (`zera-client.ts`, `signCurrentTransaction`). Update validator-owned registration,
   heartbeat, and result signers. Inventory hardware, offline, mobile, and
   other launch signers separately; do not assume a Zera signer is a KAL signer.
   The validator Docker build regenerates its ignored `.pb.h`/`.pb.cc` files
   from `txn.proto`; a local CMake build must regenerate those files before
   compiling against the new `BaseTXN` fields.
2. Keep the selected chain ID pinned in client configuration. Refuse to sign
   until it is known. Show the chain and concrete transaction type to the
   user at approval time, and check that the protobuf fields match.
3. Compare byte-for-byte vectors across C++, JavaScript, and any other launch
   language: serialized signable bytes, raw 32-byte chain ID, exact domain,
   numeric type, detached signatures, post-signature hash, and parse/serialize
   round trip. Include Falcon-512, Falcon-1024, registered single-key and policy wallets,
   Coin single/multiple inputs and multisig, sponsor, registration with
   operational co-signature, heartbeat, and internal `ProposalResult`.
4. Positive cases must accept and finalize on the intended chain, including
   after restart. Negative cases must reject missing or empty context, wrong
   domain/version, 31- or 33-byte chain IDs, a different 32-byte chain ID,
   `UKNOWN_TYPE`, and a different concrete type. Reparse signed Allowance
   bytes as `RevokeTXN` and signed Vote bytes as `ProposalCancelTXN`; both must
   fail despite any shared protobuf fields. Submit identical signed Coin bytes
   to two independently initialized prototype chains with matched balances,
   nonce, and timestamp: only the intended chain may accept them. Check zero
   fee, nonce, pending-row, and state change on rejected paths at ingress and
   candidate-block replay.
5. Deploy the validator and all enabled launch signers as one incompatible
   clean-genesis version. A validator-only cutover rejects existing clients;
   an old validator accepts signatures without this protection. Do not add a
   fallback to old signatures.

Use this minimum fixture catalog when exchanging actual byte vectors between
teams. For each row, publish the pinned chain ID, the complete typed protobuf
bytes before signing, canonical signable bytes, signature(s), final serialized
bytes, and raw `base.hash`. A prose example without these bytes is not an
interoperability vector.

| Fixture | Submit to | Expected outcome |
| --- | --- | --- |
| V1-Coin: signed `CoinTXN` with chain A ID, `COIN_TYPE`, user domain | Chain A | Accept when normal balance, nonce, fee, and time checks pass |
| Same exact V1-Coin bytes | Independent chain B with matching account state | Reject chain mismatch before fee or nonce change |
| V1-Allowance: signed `AllowanceTXN` with `ALLOWANCE_TYPE` | Chain A as `AllowanceTXN` | Accept when normal authorization checks pass |
| Same signed V1-Allowance payload parsed as `RevokeTXN` | Chain A as `RevokeTXN` | Reject type mismatch |
| V1-Vote: signed `GovernanceVote` with `VOTE_TYPE` | Chain A as `GovernanceVote` | Accept when voting rules pass |
| Same signed V1-Vote payload parsed as `ProposalCancelTXN` | Chain A as `ProposalCancelTXN` | Reject type mismatch |
| V1-Sponsor: valid user then sponsor signatures | Chain A | Accept when sponsor policy, fee, and nonces pass |
| V1-Sponsor with modified context after user signature | Chain A | Reject signature or context; no fee or nonce change |
| V1-Legacy: valid old-format signature lacking tags 16–18 | Chain A | Reject at ingress and block replay |
| V1-Result: validator-signed `ProposalResult` with result domain and type 14 | Chain A reconstructed internal result path | Accept only with valid proposer signature and reconstruction |

The deferred smart-contract SDK host output-buffer ABI change is separate
from this transaction-signature cutover. It does not alter these signing
requirements.
