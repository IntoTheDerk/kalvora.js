# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). While the version is `0.0.x`, any
release may change APIs; pin an exact version.

## [0.0.1-alpha.1] — Unreleased (alpha pre-release)

Documentation cleanup, a rewritten README, and a few SDK-only renames. Key
derivation and every derived address are byte-identical to 0.0.1-alpha.0.

Earlier builds (`0.1.0` and `0.0.1-alpha.0`) are withdrawn from npm and
replaced by this release.

### Changed

- **Breaking:** the Solana bridge lock options (`LockSplOptions`,
  `LockSolOptions`, `LockToken2022Options` and the token-type routed lock)
  take `kalvoraAddress`, and `BurnWrappedOptions` takes `kalvoraRecipient`.
  The value is Borsh-encoded positionally, so the instruction bytes are
  unchanged (pinned by golden tests).
- **Breaking:** `releaseKalvora`, `mintSol`, `createSol` and their `*AndSend`
  variants name their first parameter `toKalvoraAddress` (positional; only the
  name and the "is required" error message change).
- **Breaking:** the root type export for the Kalvora-bound guardian payload is
  `KalvoraGuardianPayload`, and `guardianBridge` exports
  `KalvoraGuardianPayload`, `KalvoraGuardianContractPayload`,
  `KalvoraGuardianMintPayload`, `KalvoraGuardianReleasePayload` and
  `KalvoraGuardianRefundPayload` in place of the generated message names. The
  generated bindings are still available under `proto.guardian`.
- **Breaking:** the Kalvora-side bridge namespace inside the bridge use-case
  module is `kalvora`.
- The README quick start now creates a standard Kalvora address (base58 of the
  raw public key, no `hashTypes`) instead of a legacy hashed address.
- Documentation: the README is rewritten; guides, module READMEs, TSDoc and
  examples describe wire values through named constants; the migration guide
  for the SDK this project was derived from is removed.

### Added

- Wallet protocol constants, exported from the package root and pinned by
  tests: `KALVORA_INJECTED_PROVIDER_KEY`, `KALVORA_PROVIDER_FLAG`,
  `KALVORA_PROVIDER_METHODS`, `KALVORA_DEEP_LINK_SCHEME`,
  `KALVORA_DEFAULT_DEEP_LINK` and `KALVORA_DEEP_LINK_PARAMS`. The adapter and
  signers use them; their values are unchanged.
- `LEGACY_TXN_TYPE_PREFIX`, the pre-rename transaction package prefix that
  serialized envelopes may still carry.
- Guardian protocol names: `NETWORK_TYPE_KALVORA` (equal to the guardian
  enum's Kalvora value, `0`) and `GUARDIAN_KALVORA_PAYLOAD_CASE`.
- `BRIDGE_FUNCTIONS`: the bridge proxy contract's function names, used by the
  Kalvora-side bridge builders.

## [0.0.1-alpha.0] — withdrawn (alpha pre-release)

Renumbered kalvora.js as an **alpha**, made Ed25519 HD derivation standard
SLIP-0010, and switched the SDK to the official Kalvora protos (`txn.proto`,
`validator.proto`, `kal_api.proto`).

The version went *down* from 0.1.0 on purpose: 0.1.0 was an earlier
pre-release, published before the key derivation and wire protocol were
settled, and has been withdrawn; everything it added is part of the `0.0.x`
line. The `0.0.x` line carries no compatibility promise between releases.

### Changed

- **Breaking (keys): Ed25519 HD derivation is now standard
  [SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md).**
  It previously used the Ed448-style scheme — master key `"Kalvora seed"` and
  a child step over little-endian `index || key` — which was described as
  SLIP-0010 but was not. It now uses the `"ed25519 seed"`
  master key and `0x00 || key || ser32BE(index)`, so every SLIP-0010 wallet
  derives the same Ed25519 key from the same seed and path. **The same
  mnemonic now gives a different Ed25519 address**: the BIP-39 test
  mnemonic's first address changes from
  `Hb6KH2BhgcjCYnc3JwDU1VNfbLds2yfMDMVwZGUWSunE` to
  `35q7SEc9HVV7Gd9oVKCnZjPMxpLrH9DftTcBUyHahTZP`. No Kalvora wallet had
  shipped on the old scheme, so there is no legacy option.
- **Breaking:** an Ed25519 derivation path with an unhardened segment now
  throws, since SLIP-0010 defines only hardened Ed25519 children. Every path
  the SDK builds itself is already fully hardened.
- **Ed448 derivation is unchanged.** SLIP-0010 does not define Ed448 and no
  other standard does, so Ed448 keeps Kalvora's scheme byte for byte, now
  pinned by reference vectors. See
  [docs/guides/hd-derivation.md](./docs/guides/hd-derivation.md).

- **Breaking:** protobuf packages moved to the official `kal_txn`,
  `kal_api`, `kal_validator` packages. Every generated `$typeName` /
  `typeName` changes accordingly (e.g. `kal_txn.CoinTXN`), as do
  `SerializedTransaction.type`, `SMART_SWAP_TRANSACTION_TYPE`
  (`kal_txn.SmartContractExecuteTXN`) and `KalvoraRpcError.service`. The
  guardian service keeps its own proto package (the guardian proto was not
  re-issued).
- **Breaking (wire):** fully qualified gRPC paths are now
  `/kal_api.APIService/*`, `/kal_txn.TXNService/*`,
  `/kal_validator.ValidatorService/*`. The default transport still sends the
  Envoy aliases `/api/*`, `/txn/*`, `/validator/*`, `/guardian/*`
  (unchanged); only callers passing their own `transport` send the fully
  qualified path. Nodes and their Envoy routes must serve the `kal_*`
  services.
- **Breaking:** the API proto file is now `proto/kal_api.proto` and its
  bindings `proto/generated/kal_api_pb.js` (was `api.proto` / `api_pb.js`);
  `dist/proto/` ships `kal_api.proto` and now also `guardian.proto`.
- Proto sources are committed byte-identical to the official release (CRLF
  line endings, no repo-local options; `proto/.gitattributes` disables
  line-ending conversion). `proto:sync` / `proto:check` accept the official
  flat release or a kalvora-indexer checkout, no longer normalise trailing
  newlines, and treat `guardian.proto` as optional.
- `deserializeTransaction` and `getSchemaForTypeName` accept type names with
  the pre-rename transaction package prefix (message bytes are unchanged by
  the rename); the Smart Swap facade accepts such an envelope for
  `SmartContractExecuteTXN` and reports it as `kal_txn`.
- **Breaking:** native token symbol is `KALV` everywhere. `KALVORA_SYMBOL`
  (and therefore `wallet.symbol` on created wallets) changes from `KAL` to
  `KALV`, matching `KALVORA_NETWORKS.protonet.nativeSymbol`;
  `TransactionFormatter.formatAmount` defaults to `KALV`, and the internal
  `formatAmount` helper labels the native token `KALV` instead of slicing the
  contract ID. The `KAL`+Base58 contract-ID prefix is unchanged.
- **Breaking (default endpoint):** the default gRPC-Web origin is now
  `https://kal-proto.visiondynamics.ch` (Envoy, port 443), replacing
  `kal-protonet.visiondynamics.ch`, in `createClient`, `PROTONET_GRPC_CONFIG`,
  `KALVORA_PROTONET_ENDPOINT`, the `protonet` network preset, examples and
  docs. Callers passing an explicit `host`/`endpoint` are unaffected.

### Added

- `kalvora.js/wallet`: the wallet surface on its own (mnemonics, HD
  derivation, key pairs, address encoding), depending only on
  `@noble/curves`, `@noble/hashes`, `bip39`, and `bs58`, with no network or
  protobuf code. ESM-only; the same exports remain on the main entry.
- `deriveHDPrivateKey(seed, path?, keyType?)`: the 32-byte key at a path and
  nothing else, zeroing every intermediate node. Defaults to Ed25519 at
  `m/44'/5258'/0'/0'/0'`.
- `docs/guides/hd-derivation.md`: the byte-level derivation spec for both key
  types, with reference vectors; the SLIP-0010 Ed25519 test vector 1 and the
  Kalvora vectors are checked in `hd-derivation-vectors.test.ts`.

- `TextGovernanceProposalInput.proposalType` (`ProposalType`, field 11).
  Defaults to `ProposalType.NONE`, which is not encoded, so existing proposals
  are byte-identical; the v1 golden vector is unchanged.
- `ProposalLedgerView.statuses` (`ProposalStatusView[]`) from
  `ProposalLedgerResponse.proposal_statuses`, with the pre-governance phase,
  outcome, window dates, fees, `promotionPending` and the contract's
  `PreGovernance` policy.
- `TransactionResult.proposalIdentifier` (`TXNStatusFees.proposal_identifier`).
- `CheckpointInfo.fileHash`, `publicKey` and `signature` (returned as
  received; not verified by the SDK).
- Exports: `ProposalType`, `PROPOSAL_PHASE`, `PRE_GOVERNANCE_OUTCOME`,
  `ProposalStatusView`, `normalizeTransactionTypeName`.
- New protocol fields are available through the raw bindings (`proto.*`):
  `NFT.parameters/expiry/valid_from`, `Voter.phase`, `Proposal` fields 19–25,
  `ProposalResult.pre_governance`.

### Removed

- **Breaking:** `ValidatorInfoInput.stakedContractIds`. `Validator` field 5
  (`staked_contract_ids`) is reserved because staking is KALV-only; passing the
  option now throws instead of being silently dropped.
- **Breaking:** `StakeMultipliers` message (`proto.validator`).
- **Breaking:** the governance auth message is now `KalGovernanceAuth`;
  `ProcessLedger.cycle_contract_ids` changed from `bytes` to `string`
  (canonical Base58 contract IDs). Neither was used by the typed API.
