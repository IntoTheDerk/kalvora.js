# Client API Reference

This guide describes every gRPC endpoint a client application can use to talk
to a Kalvora validator: how to connect, how to query chain state, how to build
and submit transactions, and how to interpret errors.

For fresh-genesis wallet registration, signing fields and the difference between a submission acknowledgement and a finalized receipt, use the [third-party Falcon integration guide](falcon_client_integration.md). The Ed key examples below describe the earlier network.

Companion guides:

- [`network_interaction_changes_2026-10-27.md`](network_interaction_changes_2026-10-27.md) -
  clean-genesis changes and deployment handoff for client teams.
- [`signed_transaction_context_v1.md`](signed_transaction_context_v1.md) -
  required chain, domain, and concrete-type signing fields.
- [`client_keys_and_wallets.md`](client_keys_and_wallets.md) - key generation,
  wallet derivation, and transaction signing.
- [`contract_id_derivation.md`](contract_id_derivation.md) - canonical
  contract IDs.
- [`restricted_key_inheritance_and_recovery.md`](restricted_key_inheritance_and_recovery.md) -
  parent permission paths and mandatory child recovery authority.
- [`multisig_wallets.md`](multisig_wallets.md) - multisignature policies.
- [`client_pre_governance.md`](client_pre_governance.md) - council review,
  PREGOV authorization, and proposal promotion into public governance.
- [`client_governance_proposals_and_voting.md`](client_governance_proposals_and_voting.md) -
  creating proposals, selecting vote forms, and confirming results.
- [`sdk_feature_requirements.md`](sdk_feature_requirements.md) - what an SDK
  must implement for coin, mint, NFT, SBT, governance, and query helpers.
- [`../done/third_party_fee_payer_client_integration.md`](../done/third_party_fee_payer_client_integration.md) -
  sponsored (fee payer) transactions.
- [`../done/smart_contract_allowance_client_integration.md`](../done/smart_contract_allowance_client_integration.md) -
  smart-contract outflow allowances.

## Services and ports

A validator exposes three gRPC servers. Clients use two of them.

| Service        | Proto file       | Default port | Purpose                          |
| -------------- | ---------------- | ------------ | -------------------------------- |
| `TXNService`   | `txn.proto`      | 50052        | Submit signed transactions       |
| `APIService`   | `kal_api.proto` | 50053        | Query balances, blocks, and fees |
| `ValidatorService` | `validator.proto` | 50051   | Validator-to-validator P2P only  |

Do not build ordinary clients against `ValidatorService` (port 50051). It is
the peer-to-peer protocol, but its methods have different access checks:

| Method | Current request checks |
| ------ | ---------------------- |
| `Gossip` | IP rate limiting at ingress; registered validator key and valid gossip signature before payload processing. |
| `SyncBlockchain` | Valid request signature, or an operator-whitelisted IP; the signer need not be a registered validator. |
| `IndexerVoting` | IP rate limiting; no request signature. Stored key/record and encoded response each capped at 3.5 MiB. Missing or malformed proposals return `CANCELLED`, unavailable reads return `UNAVAILABLE`, and oversized queries return `RESOURCE_EXHAUSTED`; errors leave an empty response. |
| `Balance` | No request signature, peer whitelist, or method-level rate limit. |

Do not assume that connecting to the P2P port proves validator identity or
that every method applies the same whitelist. Restrict access to that port
according to the validator deployment's network policy.

The API port is set by `api_port` in the validator config. A validator with
`api_port` set to `0` does not run `APIService` at all, so confirm the
operator has enabled it.

Production native gRPC connections require TLS with trust and peer identity
validation. Plaintext is available only in explicit local mode. Configure clients
for the operator's certificate issuer and expected server identity; see
[native gRPC TLS](native_grpc_tls.md).

## Generating client stubs

The proto files live in `kal_validator/proto/`:

- `txn.proto` - transaction messages and `TXNService`.
- `kal_api.proto` - query messages and `APIService` (imports `txn.proto` and
  `validator.proto`).
- `validator.proto` - block and header messages (needed as an import).

Example stub generation:

```bash
# Python
python -m grpc_tools.protoc -I kal_validator/proto \
    --python_out=. --grpc_python_out=. \
    txn.proto kal_api.proto validator.proto

# Node / TypeScript, Go, Java, C++ etc. work the same way with protoc
# and the matching grpc plugin.
```

## Conventions used by every endpoint

### Addresses and the `encoded` flag

Wallet addresses are raw binary in protobuf `bytes` fields. Query endpoints
that take a `wallet_address` also have a `bool encoded` field:

- `encoded = false` - `wallet_address` contains the raw binary address bytes.
- `encoded = true` - `wallet_address` contains the Base58 text of the address
  (as displayed by wallets); the validator decodes it for you.

Transaction messages (`TXNService`) never accept Base58 text. Recipient and
wallet fields there are always raw bytes.

### Contract IDs

Contract IDs are canonical Base58 strings with an embedded checksum (see
`contract_id_derivation.md`). Endpoints that take a `contract_id` validate it
strictly and return `INVALID_ARGUMENT` for malformed IDs. Always pass the full
canonical string.

### Amounts, denominations, and rates

- All token amounts are decimal **strings** of the smallest unit ("parts"),
  never floats. A token's parts-per-whole-coin is its denomination
  (`CoinDenomination.amount`, also returned by the `Denomination` and
  `Balance` endpoints).
- USD-equivalent rates use fixed-point strings where
  `1000000000000000000` (10^18) equals `$1.00`.

### Nonces

Every wallet has a monotonically increasing nonce. The `Nonce` endpoint
returns the **last used** nonce (`0` when the wallet has never transacted).
A new transaction must set `base.nonce` to `last used + 1`. Reusing or
skipping nonces causes the transaction to be rejected.

### Rate limiting

The API server rate-limits per client IP: sustained 5 requests per second
with a burst allowance of 100. Three bulk endpoints consume more than one
token per call:

| Endpoint                   | Cost | Effective rate per IP        |
| -------------------------- | ---- | ---------------------------- |
| `ProposalLedger`           | 20   | burst 5, then 0.25/sec       |
| `SmartContractEventsSearch`| 10   | burst 10, then 0.5/sec       |
| `GetAllAuthorizedFees`     | 20   | burst 5, then 0.25/sec       |

When the limit is exceeded the call fails with `RESOURCE_EXHAUSTED`
("Rate limit exceeded"). Back off and retry.

---

## APIService (port 50053) - queries

### Balance

```proto
rpc Balance(BalanceRequest) returns (BalanceResponse);
```

Request: `wallet_address` (bytes), `contract_id` (string), `encoded` (bool).

Response: `balance` (parts, string), `denomination` (parts per coin, string),
`rate` (USD-equivalent, 10^18 = $1.00; `"0"` if no rate is published).

Errors: `INVALID_ARGUMENT` for a malformed contract ID, `NOT_FOUND` when the
contract does not exist or the wallet holds no balance for it.

### TotalBalance

```proto
rpc TotalBalance(TotalBalanceRequest) returns (TotalBalanceResponse);
```

Returns one `BalanceResponse` per token the wallet holds. Request takes
`wallet_address` and `encoded` only.

### Nonce

```proto
rpc Nonce(NonceRequest) returns (NonceResponse);
```

Returns the wallet's last used nonce (`0` for a fresh wallet). Use
`nonce + 1` for the next transaction.

### Items

```proto
rpc Items(ItemRequest) returns (ItemResponse);
```

Lists NFT / SBT items owned by a wallet. Each `Item` has `contract_id` and
`item_id`.

### Denomination

```proto
rpc Denomination(DenominationRequest) returns (DenominationResponse);
```

Returns the parts-per-coin denomination string for a contract.

### Contract

```proto
rpc Contract(ContractRequest) returns (ContractResponse);
```

Returns the full `InstrumentContract` for a contract ID, plus a validator
timestamp, public key, and signature over the response so the answer can be
authenticated.

### ContractFee

```proto
rpc ContractFee(ContractFeeRequest) returns (ContractFeeResponse);
```

Returns the contract's fee model: `contract_fee_type` (`FIXED`,
`CUR_EQUIVALENT`, `PERCENTAGE`, or `NONE`), the list of instruments accepted
for fee payment (`allowed_fee_instrument`), and the `fee` value.

### BaseFee

```proto
rpc BaseFee(BaseFeeRequest) returns (BaseFeeResponse);
```

Returns current network base-fee components for a transaction type (and
optionally a public key, since key type affects cost): `key_fee`, `byte_fee`,
and `new_wallet_fee`. All are USD-equivalent fixed-point strings
(10^18 = $1.00). Use these to compute `base.fee_amount` before submitting.
For this estimation API, multi-key requests are limited to 64 signer entries
and 64 hash tokens, and single-key descriptors to 256 bytes; larger policies
must be estimated locally.

### GetTokenFeeInfo

```proto
rpc GetTokenFeeInfo(TokenFeeInfoRequest) returns (TokenFeeInfoResponse);
```

Bulk fee/authorization info for a list of contract IDs. Each `TokenFeeInfo`
includes the token's rate, whether it is authorized for base-fee payment, its
denomination, contract fees, and its allowed/used fee totals.

### GetAllAuthorizedFees

```proto
rpc GetAllAuthorizedFees(google.protobuf.Empty) returns (GetAllAuthorizedFeesResponse);
```

Lists every contract authorized to pay base fees with its allowed and used
totals. Weighted endpoint (cost 20) - cache the result.

### Block

```proto
rpc Block(BlockRequest) returns (BlockResponse);
```

Fetch a full block by `block_height` (uint64) **or** `block_hash` (string;
set `encoded = true` if you pass Base58 text). The returned
`kal_validator.Block` contains all transactions and their `TXNStatusFees`
entries. The response checks the block's stored structure and body signature,
but does not itself prove a finality certificate. Clients confirming a
submitted transaction must also verify finality evidence (see "Transaction
lifecycle" below). The current `kalvora.js` `waitForTransaction` and
`submitAndWait` helpers return after finding the transaction in a block; their
`ConfirmedTransaction` type name does not establish finality.

### Database

```proto
rpc Database(DatabaseRequest) returns (DatabaseResponse);
```

Low-level single-key lookup into a named column family. `type` selects the
database (`CONTRACTS`, `HASH_INDEX`, `CONTRACT_SUPPLY`, `SMART_CONTRACTS`,
`VALIDATORS`, `BLOCKS`, `HEADERS`, `TRANSACTIONS`, `CONTRACT_ITEMS`,
`VALIDATOR_UNBONDING`, `PROPOSAL_LEDGER`, `PROPOSALS`,
`CURRENCY_EQUIVALENTS`, `EXPENSE_RATIO`, `ATTESTATION`,
`CONFIRMED_BLOCKS`), `key` is the raw database key.

Useful keys:

- `HASH_INDEX` with a raw block hash **or** a decimal block-height string
  returns the internal block key.
- `CONTRACTS` with a contract ID returns the contract in protobuf text
  format.
- `CURRENCY_EQUIVALENTS` with a contract ID returns its rate.

`Database` is a diagnostic lookup of this validator's local raw rows. Every
successful response sets `diagnostic_unverified = true`; the returned `value`
keeps its prior byte format (or protobuf text for contracts). Raw block,
header, hash-index, attestation and confirmation-marker rows do not prove a
canonical or finalized block. Use the typed `Block` RPC for checked block
structure, and independently verify finality before treating a result as a
certified receipt. Older generated clients can ignore the additive
`diagnostic_unverified` field, so they must not rely on raw `Database` rows
alone for payment confirmation.

For ordinary raw selectors, `NOT_FOUND` means no non-empty value was returned:
the row may be absent or stored as empty. For `CURRENCY_EQUIVALENTS`, a valid
but ineligible fee asset also returns `NOT_FOUND`; an invalid contract ID
returns `INVALID_ARGUMENT`. A database read error, temporary reorg read or
unavailable fee-policy state returns `UNAVAILABLE`, which must not be treated
as absence. A stored contract row that cannot be decoded or whose ID does not
match its key returns `DATA_LOSS`. For `SMART_CONTRACTS`, code-record fallback
occurs only when the state row is absent; a state read error returns
`UNAVAILABLE` even if the code row exists.

The stored key and value together must fit within 3.5 MiB, and the complete
encoded response must also fit within 3.5 MiB. This includes protobuf-text
expansion for `CONTRACTS`. Oversized reads return `RESOURCE_EXHAUSTED` with an
empty response. This method has no pagination for larger records. The typed
`Contract` lookup applies the same stored key/value read budget.

For `SMART_CONTRACTS` code records on the clean-genesis chain, use explicit
`master:<name>` or `instance:<name>:<decimal-instance>` keys. For example,
`master:Example_1` and `instance:Example:1` select different records. The
instance number must be the canonical decimal spelling of a `uint32`; raw
contract names no longer address code records. Other diagnostic keys remain
raw. The same selectors work in the Wasm `db_get_data` read host function.

### ProposalLedger

```proto
rpc ProposalLedger(ProposalLedgerRequest) returns (ProposalLedgerResponse);
```

Governance data. `type` selects the query:

- `ALL_PROPOSALS` / `ALL_LEDGERS` - bulk dumps.
- `PROPOSAL_BY_ID` / `LEDGER_BY_ID` - single record; put the ID in `key`.

The response retains the parallel key/value string arrays for backward
compatibility. `proposal_statuses` additionally returns typed active proposal
records, including proposal phase, pre-governance timing/tallies, council
configuration, and promotion-pending state.

Responses are capped at 3.5 MB; oversized bulk results are truncated, so
prefer the by-ID queries where possible. Weighted endpoint (cost 20).

### SmartContractActivityRequest

```proto
rpc SmartContractActivityRequest(ActivityRequest) returns (google.protobuf.Empty);
```

Subscribe (or unsubscribe) a host:port callback for events emitted by a
smart-contract instance. This endpoint is restricted:

- `public_key` must contain only a single Ed25519 or Ed448 key, at most
  256 bytes including wallet decorations. Supported `A_`, `B_`, `r_A_`, and
  `r_B_` forms remain valid. Multisig, governance, smart-contract, mixed-field,
  and oversized authorities are rejected before wallet derivation. Invalid keys
  or derived wallets return `INVALID_ARGUMENT` before whitelist lookup. This
  API bound does not change transaction wallet derivation.
- The caller's wallet (derived from `public_key`) must be present in the
  validator's activity whitelist file - coordinate with the node operator.
- The request must be signed (`signature`) and carry a `nonce` strictly
  greater than the last one used by that wallet.

Fields: `smart_contract_id`, `instance`, `level` (confirmation level:
`PROCESSED`, `FINALIZED`, or `CONFIRMED`), `host`, `port`, and
`subscribe` (true to add, false to remove).

Subscription registration is implemented, but outbound callback delivery is
currently disabled. Registration does not cause the validator to connect to
your `host:port`. Use event-search queries for the supported read path.

### SmartContractEvents

```proto
rpc SmartContractEvents(SmartContractEventsResponse) returns (google.protobuf.Empty);
```

This is the declared callback interface for subscriber servers; outbound
delivery is currently disabled. Each event carries the contract name,
instance, function, gas usage, emitted `event_data`, block height/hash,
transaction hash, and a validator signature so you can authenticate it.

### SmartContractEventsSearch

```proto
rpc SmartContractEventsSearch(SmartContractEventsSearchRequest) returns (SmartContractEventsSearchResponse);
```

Polling alternative to subscriptions. Pass `smart_contract_id` and
`search_start`; matching events are sorted oldest first, including timestamp
nanoseconds. Set `page_size` from 1 to 256 to opt into stable paging; send the
returned `next_page_cursor` with the **same** contract ID, start timestamp and
page size for the next request. An empty cursor means the search is complete.
The cursor binds to one version of that contract's event index, including the
block that last updated it. `FAILED_PRECONDITION` means the index changed;
restart the search from the original start timestamp and deduplicate events.
`INVALID_ARGUMENT` means the cursor or page request is malformed. A zero
`page_size` keeps the legacy all-or-error behavior: more than 256 matches
return an empty `RESOURCE_EXHAUSTED` response rather than a partial history.
Provisional index, body and response size limits can also return
`RESOURCE_EXHAUSTED`. Missing or inconsistent stored event bodies fail the
whole request.

For every paged response, verify the validator signature, then recompute and
compare its signed `request_digest` against the **exact request sent**. It is
SHA-256 of ASCII `KAL_EVENT_SEARCH_REQUEST_V1`, followed in order by an
eight-byte big-endian byte length and UTF-8 contract ID, the signed timestamp
seconds represented as big-endian 64-bit two's complement, nanoseconds as an
unsigned big-endian 64-bit value, page size as an unsigned big-endian 64-bit
value, and an eight-byte big-endian byte length plus the raw request cursor.
This check catches a changed cursor or query in transit; a signature alone
does not establish which request produced the page. Clients that do not
implement this check should use the legacy form until their SDK is updated.
Events are pruned after roughly 3 days, so this is for near-real-time
consumption, not history. Successful responses are validator-signed. Weighted
endpoint (cost 10).

---

## TXNService (port 50052) - transaction submission

All submission RPCs take a fully signed transaction message and return
`google.protobuf.Empty`. A successful (OK) response means the transaction
passed initial verification and entered the mempool - **not** that it
executed. Final status appears in the block that includes it (see
"Transaction lifecycle").

| RPC                        | Message                       | Purpose                                    |
| -------------------------- | ----------------------------- | ------------------------------------------ |
| `Coin`                     | `CoinTXN`                     | Token transfer (multi-input/multi-output)  |
| `Mint`                     | `MintTXN`                     | Mint tokens to a recipient                 |
| `ItemMint`                 | `ItemizedMintTXN`             | Mint an NFT/SBT item                       |
| `Contract`                 | `InstrumentContract`          | Create a new token/NFT/SBT contract        |
| `ContractUpdate`           | `ContractUpdateTXN`           | Update an existing contract                |
| `GovernProposal`           | `GovernanceProposal`          | Submit a governance proposal               |
| `GovernVote`               | `GovernanceVote`              | Vote on a proposal                         |
| `ProposalCancel`           | `ProposalCancelTXN`           | Cancel your own proposal                   |
| `SmartContract`            | `SmartContractTXN`            | Publish smart-contract code                |
| `SmartContractInstantiate` | `SmartContractInstantiateTXN` | Create a contract instance                 |
| `SmartContractExecute`     | `SmartContractExecuteTXN`     | Call a function on an instance             |
| `ExpenseRatio`             | `ExpenseRatioTXN`             | Trigger expense-ratio collection           |
| `NFT`                      | `NFTTXN`                      | Transfer an NFT                            |
| `BurnSBT`                  | `BurnSBTTXN`                  | Burn a soul-bound token                    |
| `DelegatedVoting`          | `DelegatedTXN`                | Delegate voting power and fees             |
| `Revoke`                   | `RevokeTXN`                   | Revoke a token/item (restricted keys)      |
| `Compliance`               | `ComplianceTXN`               | Assign/revoke KYC compliance levels        |
| `Allowance`                | `AllowanceTXN`                | Authorize another wallet to spend          |

Quash and time-delayed transactions were removed for clean genesis. Their old
wire fields are reserved and must not be submitted.

### Building the common `BaseTXN`

Every transaction embeds a `BaseTXN`:

- `public_key` - your typed public key (see keys guide).
- `timestamp` - current time.
- `nonce` - last used nonce + 1 (query the `Nonce` endpoint).
- `fee_amount` / `fee_id` - base fee amount and the contract ID of the token
  paying it. For `CoinTXN`, `base.fee_amount` caps the **total** base fee for
  the transaction, in parts of `base.fee_id`; every ordinary input signer
  signs that same cap. Compute the amount from the `BaseFee` endpoint (key fee +
  byte fee x serialized size + new-wallet fee where applicable), converted
  into parts of the fee token using its rate and denomination from
  `GetTokenFeeInfo`.
- `signature` and `hash` - filled in during signing (below).
- `signature_domain`, `chain_id`, and `intended_type` - signed V1 context.
  Pin the target chain ID and set the concrete transaction type before signing;
  see the [signed transaction context guide](signed_transaction_context_v1.md).
- Optional: `memo`, `safe_send`, interface-fee fields, and `fee_payer` for
  sponsored transaction types in the [fee-payer integration guide](../done/third_party_fee_payer_client_integration.md).

If `interface_fee_id` names a token that requires KYC, every actual interface
fee payer and the interface fee recipient must satisfy that token's compliance
rule. Check both sides before signing, including the sponsor when one pays.

### Signing and hashing

Set the V1 context fields before collecting any signatures. The exact domain,
chain identity, type mapping, and special Coin, multisig, and sponsor rules are
in the [signed transaction context guide](signed_transaction_context_v1.md).

For an ordinary **single-key** sender on a type other than `CoinTXN`:

1. Populate the whole transaction, leaving `base.signature` and `base.hash`
   unset.
2. Serialize and sign those exact bytes with your wallet key; store the
   result in `base.signature`.
3. Serialize again (signature now present, hash still unset) and set
   `base.hash` to the 32-byte SHA3-256 digest of that serialization.

`CoinTXN` is multi-party: signatures live in `auth.signature` (parallel to
`auth.public_key` and `auth.nonce`), and every signer signs the transaction
serialized with `base.hash`, `base.fee_payer`, and **all** signatures
cleared. See the keys guide and multisig guide for the full rules.
For a base-key multisig sender on a non-Coin type, leave `base.signature`
absent and place signatures in `base.public_key.multi.signatures[]` over the
canonical copy described in the
[signed transaction context guide](signed_transaction_context_v1.md#signing-order).

### CoinTXN in brief

The transfer transaction moves one token (`contract_id`) from one or more
inputs to one or more outputs:

- `auth` - one `public_key` + `signature` + `nonce` slot per sending wallet.
- `input_transfers[i]` - `index` into the auth arrays, `amount` to draw from
  that wallet, and `fee_percent` (100 000 000 = 100%) - each input's share of
  the base fee (and optionally `contract_fee_percent`).
- `output_transfers` - recipient `wallet_address` (raw bytes), `amount`, and
  optional `memo`.
- Total input amounts must equal total output amounts.

For ordinary multi-input transfers, each input signs the entire transaction,
including the base-fee cap, any contract-fee cap, and all fee percentages.
The validator floors each earlier base-fee share
(`total fee * fee_percent / 100000000`); the last input with a nonzero
`fee_percent` pays the remainder. Contract-fee shares follow the same rule
using `contract_fee_percent`. Show each payer the computed debit before
signing. `contract_fee_amount` separately caps the total contract fee in
`contract_fee_id`.

### Transaction lifecycle and confirmation

1. Submit via `TXNService`. gRPC `OK` means accepted into the mempool and
   gossiped to other validators. A rejection (bad signature, bad nonce,
   malformed fields) fails the RPC immediately.
2. The transaction is included in a block. Its result is the
   `TXNStatusFees` entry in that block whose `txn_hash` matches your
   `base.hash`: first require that the optional `status` field is **present**,
   then read its `TXN_STATUS` value (`OK` on success; other
   values such as `INSUFFICIENT_AMOUNT`, `INVALID_AUTH_KEY`,
   `EXCEEDED_MAX_SUPPLY`, `OUT_OF_GAS` explain failures), and the fee fields
   record what was actually charged. An absent `status` must not be treated as
   success: proto3 otherwise exposes its default `OK` value. A transaction can be included
   in a block with a failing status - fees are still charged.
3. Find the matching hash and `TXNStatusFees` entry in a checked `Block`
   response, then independently verify that block's finality certificate
   against the correct chain and validator committee before marking the
   transaction confirmed. The current `Block` RPC does not supply that proof;
   a `Block` or `Balance` response from one validator alone is not finality
   evidence. After finality, query state such as
   `Balance` when the application needs the resulting balance.

### Timing and replay protection

- Every user-signed transaction, including governance proposal submissions,
  votes, cancellations, and delegations, must have a signed `BaseTXN.timestamp`
  within 10 minutes before or after the receiving validator's local time.
  Validators also check that same window against the signed block timestamp
  when the transaction is first included. Keep client clocks synced; an RPC
  `OK` only means the transaction entered the queue, not that it was included.
  If inclusion does not happen before the window closes, rebuild the complete
  transaction with a current timestamp and nonce, then sign and hash it again.
  Changing only the timestamp invalidates its signature and hash. Internal
  unsigned transactions created by an approved governance vote are exempt.
- The nonce prevents replay. If a submission fails with a nonce error,
  re-query the `Nonce` endpoint and rebuild - never blind-increment past a
  gap.

---

## Error handling summary

| gRPC status          | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `OK`                 | Query succeeded / transaction accepted into mempool            |
| `INVALID_ARGUMENT`   | Malformed contract ID or request field                         |
| `NOT_FOUND`          | Unknown contract, wallet, key, or block                        |
| `RESOURCE_EXHAUSTED` | Per-IP rate limit exceeded - back off and retry                |
| `PERMISSION_DENIED`  | Activity subscription: not whitelisted, bad signature or nonce |

Execution-level failures are **not** gRPC errors: they surface as non-`OK`
`TXN_STATUS` values in the block's `TXNStatusFees` entry for your
transaction hash.

## Client checklist

- Generate stubs from `txn.proto`, `kal_api.proto`, and `validator.proto`.
- Point transaction submission at port 50052 and queries at port 50053.
- Use raw bytes for addresses in transactions; use `encoded = true` only on
  query endpoints when passing Base58 text.
- Treat all amounts as decimal strings of smallest parts.
- Query `Nonce` and use last-used + 1 for every transaction.
- Compute fees from `BaseFee` / `GetTokenFeeInfo` before signing.
- Follow the sign-then-hash order exactly; SHA3-256, not SHA-2.
- Confirm transactions by finding their `TXNStatusFees` entry in a block,
  requiring `status` presence, and verifying finality, not by the submission
  RPC succeeding.
- Respect the rate limits, especially on the weighted bulk endpoints.
