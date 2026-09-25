# Query clients (`src/query`)

Typed, read-only access to Kalvora network state. Full guide:
[docs/guides/querying.md](../../docs/guides/querying.md).

| Client | Service | Create with |
|--------|---------|-------------|
| `KalvoraQueryClient` | `zera_api.APIService` — every client-facing read RPC | `createQueryClient(config)` or `kalvora.query` |
| `ValidatorQueryClient` | read-only `zera_validator.ValidatorService` subset | `createValidatorQueryClient(config)` or `kalvora.validator` |
| `GuardianQueryClient` | `zera_guardian.GuardianService` read RPCs | `createGuardianQueryClient(config)` or `kalvora.guardian` |

## RPC coverage

| RPC | Method |
|-----|--------|
| `Nonce` | `getNonce`, `getNextNonce` |
| `Balance` | `getBalance`, `getBalanceOrZero` |
| `TotalBalance` | `getAllBalances` (not implemented by every gateway) |
| `Items` | `getItems` |
| `Contract` | `getContract` |
| `Denomination` | `getDenomination` |
| `ContractFee` | `getContractFee` |
| `BaseFee` | `getBaseFee` |
| `GetTokenFeeInfo` | `getTokenFeeInfo` |
| `GetAllAuthorizedFees` | `getAuthorizedFeeTokens` |
| `Block` | `getBlock`, `hasBlock`, `getLatestBlockHeight`, `getTransactionResult`, `waitForTransaction` |
| `ProposalLedger` | `getProposalLedger` |
| `SmartContractEventsSearch` | `searchSmartContractEvents` |
| `Database` | `getDatabaseValue`, `getCurrencyEquivalent` (`CURRENCY_EQUIVALENTS`), `getContractSupply` (`CONTRACT_SUPPLY`) |
| Validator `Nonce`, `Balance` | `ValidatorQueryClient.getNonce`, `.getBalance` |
| Validator `GetCheckpointInfo`, `SyncValidatorList` | signed requests via a `KalvoraSigner` |
| Guardian `GetPayload`, `SearchPayload`, `GetPriceData`, `GetMintInfo` | `GuardianQueryClient` methods |

Not wrapped (not client-facing): `SmartContractActivityRequest` and
`SmartContractEvents` (validator → indexer push), `AuthenticateGuardian`
(guardian ↔ guardian), and the validator block/gossip/attestation streams.
Every client exposes `.raw` for direct protobuf access.

## Decoders

Pure functions usable on data from any source: `summarizeBlock`,
`listBlockTransactions`, `findTransactionResult`, `toTransactionResult`,
`decodeContractSupply`, `partsToWhole`, `formatScaled`, `parseUintString`,
`USD_SCALE`.

## Verified behaviour (live node, 2026-09)

- Unknown wallet/token balance → `NOT_FOUND`; wallet with no items →
  `NOT_FOUND` ("Invalid Wallet").
- `BaseFee` requires a valid public key.
- Validator signed requests: signature over the protobuf request with
  `signature` unset; timestamps must be close to the node clock.
- `CONTRACT_SUPPLY` is a binary protobuf record `{1: maxSupply, 2: currentSupply}`.

## Tests

`tests/` runs offline against ConnectRPC's in-memory router transport.
`tests/live.test.ts` performs read-only calls against a real node when
`KALVORA_LIVE_ENDPOINT` is set (`npm run test:live`).
