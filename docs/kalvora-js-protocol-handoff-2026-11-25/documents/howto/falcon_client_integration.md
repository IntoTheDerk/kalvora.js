# Falcon wallets and transactions for third-party clients

On Kalvora's fresh-genesis Falcon network, you can give out a wallet address and receive an ordinary payment as soon as you generate the key. Before that wallet can spend, its owner must sign a `WalletRegistration`. If registration succeeds in finalized block **H**, the wallet can authorize its first payment in **H+1**. A wallet that already holds funds can pay its registration fee. A registered single-key wallet can sponsor a new wallet with a zero balance.

This guide follows a new wallet through its first payment. The same signing rules apply to wallets, exchanges, custodians and contract clients. The wire contract is the protobuf in validator release `200028`, attestation protocol `31`. [Transaction and submission schema](../../kal_validator/proto/txn.proto) · [Query schema](../../kal_validator/proto/kal_api.proto)

**For an existing integration**, replace Ed25519/Ed448 key generation, `A_`/`B_` hash decorations and inline `PublicKey.single` or `PublicKey.multi` signing with the address and proof fields below. Opening balances come from the signed fresh-genesis allocations. Give customers their new Falcon deposit addresses and track registration independently of deposits. [Fresh-genesis allocations](falcon_genesis.md)

## 1. Generate the key and receiving address

Generate a keypair locally with **padded Falcon**. Either variant works with every wallet hash. Store the secret in your signer or protected key store. Back up the variant, selected wallet hash and network alongside the key so you can reproduce the receiving address. Only the public key is published.

| Protobuf variant | Raw public key | Raw secret key in the reference implementation | Detached padded signature |
| --- | ---: | ---: | ---: |
| `FALCON_512` (1) | 897 bytes | 1,281 bytes | 666 bytes |
| `FALCON_1024` (2) | 1,793 bytes | 2,305 bytes | 1,280 bytes |

The validator uses the padded routines in liboqs 0.16.0. Its public key starts with the native Falcon header byte `09` (512) or `0a` (1024). Preserve the entire canonical encoding, header included. A Falcon signature authenticates the transaction bytes. The wallet hash serves a separate purpose, deriving the address. [Reference key generation, signing and verification](../../kal_validator/crypto/falcon_wallet.cpp)

Choose **one** hash and set its enum explicitly at registration. The default client choice is `BLAKE3_256`. Compute `address = selected_hash(raw_public_key)`. Feed only the original public-key bytes to the hash. The printable variant name, enum, registry type byte and Base58 text are outside that input.

| Protobuf hash options, in enum order | IDs | Address bytes, in the same order |
| --- | --- | --- |
| `BLAKE3_256`, `BLAKE3_512`, `BLAKE3_1024`, `BLAKE3_2048`, `BLAKE3_4096`, `BLAKE3_9001` | 1–6 | 32, 64, 128, 256, 512, 1,126 |
| `SHA3_256`, `SHA3_512` | 7–8 | 32, 64 |
| `SHAKE256_1024`, `SHAKE256_2048`, `SHAKE256_4096` | 9–11 | 128, 256, 512 |

For `BLAKE3_9001`, obtain 1,126 output bytes and apply `last_byte &= 0x80`. Store and compare the **full** binary address, including its length. Display it using canonical Bitcoin-alphabet Base58, preserving leading zero bytes. Wallet display addresses have no checksum. Use raw bytes in binary protobuf and standard Base64 in protobuf JSON `bytes` fields. A client that offers several hashes for one Falcon key must track and register each derived address independently. Each has its own balance, nonce and permissions. [Hash implementation](../../kal_validator/headers/hashing.h) · [Accepted address encodings](../../kal_validator/headers/kal_wallet_address.h)

## 2. Connect to the intended chain

Obtain the network name, trusted block-zero hash, TLS hostname and service endpoints from the network operator. The usual ports are **50052** for `kal_txn.TXNService` submissions and **50053** for `kal_api.APIService` queries. Generate client bindings from the branch's `txn.proto`, `kal_api.proto` and the imported `validator.proto`. Use TLS with certificate and hostname verification. [Native gRPC transport](native_grpc_tls.md) · [Protobuf sources](../../kal_validator/proto)

Every ordinary wallet registration and payment signs three context fields inside `BaseTXN`.

| Field | Value |
| --- | --- |
| `signature_domain` | ASCII bytes of `KAL_USER_TXN_V1` |
| `chain_id` | Raw 32-byte SHA-256 digest derived from the selected network name and final block-zero hash. |
| `intended_type` | The enum for the exact concrete message. Registration uses `REGISTER_WALLET_TYPE` (25). Coin uses `COIN_TYPE` (1). |

For example, given `network_name` of `kal_main` or `kal_proto` and the operator's 64-character hex `genesis_pin`, this Python computes the signing chain ID.

```python
import hashlib

chain_id = hashlib.sha256(
    b"KAL_CHAIN_ID_V2|" + network_name.encode("ascii") + b"|" + bytes.fromhex(genesis_pin)
).digest()
```

Set a current protobuf `Timestamp`. Admission checks it against node time and replay checks it against block time, with a ten-minute window. [Chain identity](../../kal_validator/crypto/attestation_network.h) · [Complete type mapping](../../kal_validator/headers/transaction_signature_context.h)

Choose the fee instrument and cap before collecting signatures. `APIService.BaseFee` takes the transaction type, signer identity and optionally `additional_signer` for a sponsor. Its `byte_fee` and `key_fee` are pricing inputs in units of 10⁻¹⁸ USD. Use `GetTokenFeeInfo` for the fee instrument's rate and denomination. Budget for the fully signed size, witness count and applicable safe-send or asset-specific charges. Use `ContractFee` for contract fee terms. Set `base.fee_amount` to the authorized cap in the fee instrument's smallest units as a decimal string. [Fee quote RPC](../../kal_validator/grpc/api/base_fee.cpp) · [Conversion and rounding](../../kal_validator/block_process/fees.cpp)

## 3. Register the wallet

Call `APIService.GetSigningWallet` with the raw address in `SigningWalletRequest.wallet_address`. A successful response with the `identity` oneof unset means the address is unregistered. A `falcon` result returns the variant and raw public key. Use the wallet hash you recorded to rederive and compare the address. A `policy` result returns the multisig policy and `policy_hash`. An RPC error leaves registration status unknown. Read the committed nonce with `APIService.Nonce(wallet_address=address, encoded=false)`. A new wallet reads zero and signs its registration with nonce **1**. [Registry and nonce RPCs](../../kal_validator/grpc/api/nonce.cpp)

Build the concrete `kal_txn.WalletRegistration` with the following fields. A self-funded wallet needs a balance in the chosen fee instrument at its derived address. To fund it before registration, the sender uses an ordinary transfer with `safe_send` off, subject to the asset's rules.

| Field | Value for a single-key wallet |
| --- | --- |
| `falcon.variant`, `falcon.raw_public_key` | Selected Falcon variant and complete canonical public-key bytes |
| `wallet_hash` | Selected nonzero enum, including the explicit default `BLAKE3_256` |
| `base.public_key.wallet_address` | Derived raw address, including on self-funded registration |
| `base.nonce`, `base.timestamp` | Owner's next nonce and current timestamp |
| `base.fee_id`, `base.fee_amount` | Authorized fee instrument's contract ID and fee cap |
| `base.signature_domain`, `base.chain_id`, `base.intended_type` | Ordinary signing context from step 2 |

The following pseudocode shows exactly when each signer sees the message. `wire` means the binary protobuf serialization of the **concrete transaction**. Use generated bindings, preserve repeated-field order and clear optional fields to *absent*. Serializing a present empty optional field can change the signed bytes.

```text
clear reg.base.hash, reg.base.signature, reg.base.fee_payer
clear reg.base.public_key.witnesses
reg.base.signature = owner.sign_padded(wire(reg))

if a sponsor pays:
    reg.base.fee_payer.public_key.wallet_address = sponsor_address
    reg.base.fee_payer.nonce = sponsor_committed_nonce + 1
    reg.base.fee_payer.signature = sponsor.sign_padded(wire(reg))

reg.base.hash = SHA3_256(wire(reg))
submit kal_txn.TXNService/RegisterWallet(reg)
```

The validator verifies the new owner's signature with the public key inside the registration and independently derives the address. Sponsorship also requires a **different, already eligible single-key address**. The sponsor signs with its own signature field empty and the owner's completed proof present. A successful sponsored registration charges the sponsor and consumes one nonce on **each** wallet. A successful self-funded one charges and advances only the registering wallet. On ordinary base-signed operations such as minting or voting, use the same owner-first order with the registered sender's address and the concrete transaction type. [Owner and sponsor signing bytes](../../kal_validator/headers/registered_wallet.h) · [Transactions that accept a fee payer](../../kal_validator/headers/fee_payer.h)

## 4. Confirm registration and send the first payment

Keep the exact submitted bytes and `base.hash`. A gRPC `OK` with `google.protobuf.Empty` means the node queued the request for processing. To confirm settlement, inspect the finalized block through your trusted node or indexer. With the block height, call `APIService.Block` and find `block.transactions.txn_fees_and_status[]` with the matching raw `txn_hash`, a **present** `status = OK`, and the actual `base_fees`. For registration, check that `GetSigningWallet` now returns the expected key or policy. Indexers can read the signed transactions from `block.transactions.wallet_registrations[]` (field 30) and match each to its receipt by hash. Keep deposits that predate registration in the wallet's balance history. [Submission handler](../../kal_validator/headers/client_network_service.h) · [Block lookup](../../kal_validator/grpc/api/block.cpp) · [Receipt fields](../../kal_validator/proto/txn.proto)

For example, Alice's sponsored registration finalizes in block 120 at Alice nonce 1 and sponsor nonce 8. Alice can first sign a payment eligible for **block 121**, using nonce **2** if she has signed nothing else. The sponsor's next nonce is 9. Alice still needs the asset being sent and enough to cover her share of the payment fees.

For a simple `CoinTXN` paying Bob 7 kalvs (1 KAL = 1,000,000,000 kalvs), set `base.public_key.wallet_address` to Alice's raw address and set the timestamp, fee cap, fee ID, chain ID, user domain and `COIN_TYPE`. In this example both `coin.contract_id` and `base.fee_id` are the native KAL contract ID, `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao`. The debiting nonce and signature go in **`auth`**. The one-input construction below matches the validator's settlement test. [Worked transfer in the validator](../../kal_validator/test/falcon_wallet_settlement_test.cpp) · [Native KAL contract ID](../../kal_validator/headers/const.h)

```text
coin.auth.public_key[0].wallet_address = alice_address
coin.auth.nonce[0] = 2
coin.input_transfers[0] = {index: 0, amount: "7",
                           fee_percent: 100000000, contract_fee_percent: 100000000}
coin.output_transfers[0] = {wallet_address: bob_address, amount: "7"}

# All Coin input signers sign these same bytes.
# Start with base.signature absent. Keep base.fee_payer and base.hash absent.
clear coin.auth.signature and every coin.auth.public_key[i].witnesses
message = wire(coin)
coin.auth.signature[0] = alice.sign_padded(message)
coin.base.hash = SHA3_256(wire(coin))
submit kal_txn.TXNService/Coin(coin)
```

- **Ordinary receiving.** With `base.safe_send` omitted or false, Bob's address can receive before registration. Setting it to true on a supported transfer requires every destination to be registered in the finalized parent. Coin, mint and item mint check this condition. NFT transfer rejects the option. Existing asset and compliance rules still apply. [Coin outputs](../../kal_validator/block_process/custom/process_new_coin.cpp) · [Safe-send check](../../kal_validator/block_process/process_utils.cpp) · [NFT transfer](../../kal_validator/block_process/template/process_nft.cpp)
- **More than one input.** Keep `auth.public_key[]`, `auth.nonce[]` and `auth.signature[]` aligned by slot. Each single-key slot supplies its own padded signature over the common message. Coin fee sponsorship uses an additional signed input with amount `"0"` and the agreed fee shares. For an allowance spend, use the registered spender in the authorization slot and preserve the separate source addresses and nonces in `auth.allowance_address[]` and `auth.allowance_nonce[]`. [Coin verification](../../kal_validator/crypto/signatures.cpp) · [Input and fee processing](../../kal_validator/block_process/custom/process_new_coin.cpp)
- **Retry after a timeout.** Look up the original receipt, registration and committed nonce before building a replacement. Within the timestamp window you can resubmit identical signed bytes. Falcon signatures are randomized, so signing the same payment again can produce a different transaction hash. Coordinate pending nonces across all workers using the same sender or sponsor.
- **Rotate a wallet key.** A single-key registration permanently binds that address. While the old key can still authorize transactions, register the new address, move the funds, and update deposit instructions and any contract grants. Re-registering the original address is rejected.

### Send a signed request over gRPC

From the repository root, set `TXN_ENDPOINT` and `API_ENDPOINT` to the operator's TLS host and port for each service. The first command submits a registration your signer has already exported as protobuf JSON, including signatures and hash. The second queries its address. Set `ADDRESS_B64` to the standard Base64 encoding of your raw wallet address. For a private CA, supply `-cacert /path/to/root.pem` to both commands. [grpcurl usage](https://github.com/fullstorydev/grpcurl#usage)

```sh
grpcurl -import-path kal_validator/proto -proto txn.proto -d @ \
  "$TXN_ENDPOINT" kal_txn.TXNService/RegisterWallet < signed-registration.json

printf '{"walletAddress":"%s"}\n' "$ADDRESS_B64" |
  grpcurl -import-path kal_validator/proto -proto kal_api.proto -d @ \
    "$API_ENDPOINT" kal_api.APIService/GetSigningWallet
```

Once the registration has finalized, submit the signed `CoinTXN` JSON the same way using `kal_txn.TXNService/Coin`. An application using a generated gRPC stub can pass the signed protobuf object directly. Keep signing and transaction hashing on the binary protobuf representation in both cases.

## Multisig wallets

Register each member as a single-key Falcon wallet first. Any mix of 512 and 1024 is valid. Wait for those registrations to finalize. Define `WalletPolicy.members[]` in permanent slot order with a `class_id` and raw address per member. A pattern lists class thresholds. Every threshold in any **one** pattern must be met. Each pattern must require at least one signature and be satisfiable. The validator rejects two member addresses controlled by the same underlying key, including different hash choices for that key.

To derive the shared address, hash this descriptor once with the policy's selected wallet hash. Concatenate the fields in the order shown, encode every integer as unsigned 32-bit big-endian and preserve all list order. This encoding is independent of protobuf serialization.

```text
ASCII("KAL_WALLET_MULTISIG_V1") ‖ u32(1) ‖ u32(wallet_hash_id)
‖ u32(member_count) ‖ for each member: u32(class_id) ‖ u32(address_length) ‖ address
‖ u32(pattern_count) ‖ for each pattern: u32(threshold_count)
    ‖ for each threshold in that pattern: u32(class_id) ‖ u32(required)
```

Submit `WalletRegistration.policy` with the shared address as sender. Members sign the same owner message with all witnesses removed. Attach only participating members as `{slot, signature}` in `base.public_key.witnesses[]`, in strictly increasing zero-based slot order. Leave `base.signature` absent. A sponsor can then countersign the witnessed message. The policy consumes its own nonce. Members' personal nonces are separate. A policy registered in H can spend in H+1.

For a later base-signed transaction, send the policy address and fresh witnesses. For a Coin input, put them in `auth.public_key[i].witnesses[]` and supply an **empty** `auth.signature[i]` to preserve slot alignment. For example, in a two-of-two wallet, slots 0 and 1 both sign the same bytes. Changing the policy or its ordering derives a new address and requires a new registration. Limits include 64 members, 64 patterns and a 128 KiB descriptor. The entire transaction shares a 64-verification budget, including a sponsor. [Policy encoder and verifier](../../kal_validator/crypto/registered_wallet.cpp) · [Transaction-wide limits](../../kal_validator/headers/auth_resource_limits.h)

## Contract clients and validator integrations

- **Contract grants.** Put the ordinary wallet address in `restricted_keys[].public_key.wallet_address`. Grant individual actions with `mint`, `transfer`, `revoke`, `compliance`, `vote`, `propose`, `expense_ratio` or `update_contract`, and retain the applicable `key_weight`. A grant can be made before registration. To mint, the caller needs both an eligible signing wallet and a mint grant on that contract. The same wallet can act normally elsewhere. Governance and contract execution use the typed `governance_auth` and `smart_contract_auth` fields. An `r_` identity has no signing role on this chain. [Contract permissions, inheritance and recovery](restricted_key_inheritance_and_recovery.md)
- **Parent permissions.** Set `restricted_keys[].public_key.parent_contract` for the single parent. Each link must permit the action. A direct child entry for the same signer decides it locally, including an explicit denial. A child that inherits must retain a direct `update_contract` recovery grant. The limits are 50 entries per contract and 64 contract records on an inheritance path, counting the child. [Resolver and action rules](../../kal_validator/restricted/restricted_keys.cpp) · [Inheritance limits](restricted_key_inheritance_and_recovery.md)
- **Contracts and Wasm SDKs.** Ordinary contract creation uses the wallet creator's address and the `KALVORA_CONTRACT_ID_V2` derivation. For the postcard ABI, a grant identity is a varint kind then a length-prefixed string. Kinds 1, 2, 3 and 4 carry a Base58 wallet address, governance authority, smart-contract authority and parent contract ID respectively. The Wasm `verify_signature` host call takes a hex message, Base58 signature and Base58 registered single-key wallet address. Include the intended wallet address in application-signed messages when different hash aliases need separate authority. [Contract-ID derivation](contract_id_derivation.md) · [Postcard types](../../kal_validator/smart_contract/base64/sc_base64_types.h) · [Message verifier](../../kal_validator/crypto/signatures.cpp)
- **Validator integrations.** A validator uses separate registered single-key owner and operational wallets with distinct underlying keys. Either role may choose either Falcon size. Validator assignment uses owner and operator proofs. Heartbeats and signed node replies use the operational wallet. BLS continues to handle consensus attestations. The launch ceremony and seed pins are operator procedures. [Genesis ceremony](falcon_genesis.md) · [Seed pinning](bootstrap_seed_pinning.md)
- **Signed query responses.** For `ContractResponse` or `SmartContractEventsSearchResponse`, match `public_key.wallet_address` to the expected validator operator, resolve its registered Falcon key and verify the response with only its top-level `signature` cleared. A wallet registry lookup establishes the key binding. Use the validator assignment or trusted operator identity to establish who signed. [Contract response signer](../../kal_validator/grpc/api/contract.cpp) · [Event search signer](../../kal_validator/grpc/api/smart_contract_activity.cpp)

## Check an implementation against the public vectors

The fixture contains public keys and all 11 expected addresses for both variants, a self-funded registration, a sponsored registration and a signed two-member policy. Its chain ID, timestamp and fee instrument are test values. Use the bytes for offline comparison. On a real chain, build fresh messages with the operator's chain ID, current fees, timestamp and nonces. [Public vectors](../../tests/transactions/falcon_wallet_vectors.json) · [Reference verifier](../../kal_validator/test/falcon_wallet_test.cpp)

| First Falcon-512 fixture | Expected value |
| --- | --- |
| BLAKE3-256 address, hex | `b599e918eeb2ca44865f5d7ab696a790877a81004579a2d78d0048b303212c74` |
| Same address for display | `DDtuvqAtezkhfvGwDXhs4Km9nCERA7VX7HQtzaaoK2dR` |
| Same address in protobuf JSON | `{"walletAddress":"tZnpGO6yykSGX116tpankId6gQBFeaLXjQBIswMhLHQ="}` |
| Registration transaction hash, hex | `aae7cd25f797268f48ea70b0cece4d7efbc81152af6cec1f0f33d1992242bcd4` |

From the repository root, Python 3 and `protoc` can decode the fixture into readable protobuf text.

```sh
python3 -c 'import json, sys; v = json.load(open("tests/transactions/falcon_wallet_vectors.json")); sys.stdout.buffer.write(bytes.fromhex(v["single_wallets"][0]["signed_registration"]))' |
  protoc -I kal_validator/proto --decode=kal_txn.WalletRegistration kal_validator/proto/txn.proto
```

Verify the fixture's existing padded signature against the unsigned owner bytes. Then clear **only** `base.hash` on the fully signed fixture, serialize it and compute SHA3-256 to reproduce the hash above. For a newly generated signature, check verification and round-trip decoding. Byte equality is meaningful for the saved fixture, while new signatures may differ.
