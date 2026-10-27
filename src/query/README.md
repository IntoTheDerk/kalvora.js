# Query clients (`src/query`)

Typed, read-only access to Kalvora network state. Full guide:
[docs/guides/querying.md](../../docs/guides/querying.md).

| Client | Service | Create with |
|--------|---------|-------------|
| `KalvoraQueryClient` | `kal_api.APIService` — every client-facing read RPC | `createQueryClient(config)` or `kalvora.query` |
| `ValidatorQueryClient` | read-only `kal_validator.ValidatorService` subset | `createValidatorQueryClient(config)` or `kalvora.validator` |
| `GuardianQueryClient` | guardian `GuardianService` read RPCs (bridge payloads, prices, mint info) | `createGuardianQueryClient(config)` or `kalvora.guardian` |

## RPC coverage

| RPC | Method |
|-----|--------|
| `Nonce` | `getNonce`, `getNextNonce` |
| `Balance` | `getBalance`, `getBalanceOrZero` |
| `TotalBalance` | `getAllBalances` (not implemented by every gateway) |
| `Items` | `getItems` |
| `Database` `CONTRACT_ITEMS` | `getContractItem` |
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
| Validator `SyncValidatorList` | signed request via a `KalvoraSigner` |
| Validator `GetCheckpointInfo` | deprecated; clean-genesis nodes return `PERMISSION_DENIED` |
| Guardian `GetPayload`, `SearchPayload`, `GetPriceData`, `GetMintInfo` | `GuardianQueryClient` methods |

Not wrapped (not client-facing): `SmartContractActivityRequest`,
`AuthenticateGuardian` (guardian ↔ guardian), and the validator
block/gossip/attestation streams. `SmartContractEvents` is a validator push
to a server you register; this SDK does not listen, and
`acceptSmartContractEvent` verifies a response you already have.
Every client exposes `.raw` for direct protobuf access.

## Decoders

Pure functions usable on data from any source: `summarizeBlock`,
`listBlockTransactions`, `findTransactionResult`, `toTransactionResult`,
`decodeContractSupply` (`circulation` aliases `currentSupply`), `partsToWhole`,
`formatScaled`, `parseUintString`, `USD_SCALE`. Pushed smart-contract events
are checked with `acceptSmartContractEvent` and
`verifySmartContractEventSignature`. `nextSmartContractEventSearchStart`
advances a timestamp filter; it is not a cursor or a guarantee of complete
paging. `searchSmartContractEvents` uses legacy all-or-error mode, limited to
256 matches. Authenticated cursor paging is available through `.raw` and
requires verification of the response signature and exact request digest.
`itemContractDatabaseKey` builds the
`CONTRACT_ITEMS` key.

Database reads are uncertified diagnostics, including values returned by the
typed supply and currency-equivalent helpers. Public checkpoint metadata and
downloads are disabled at clean genesis; recovery uses verified local snapshots
and controlled operator access.

Processing receipts require an explicitly present `TXNStatusFees.status`.
`toTransactionResult` rejects rows without it; `findTransactionResult`,
`summarizeBlock`, and transaction polling ignore such incomplete rows. An RPC
acceptance or a processing receipt alone does not establish finality: verify
the block's finality evidence before treating the transaction as confirmed.

## Verified behaviour (live node, 2026-09)

- Unknown wallet/token balance → `NOT_FOUND`; wallet with no items →
  `NOT_FOUND` ("Invalid Wallet").
- `BaseFee` requires a valid public key.
- Validator signed requests: signature over the protobuf request with
  `signature` unset; timestamps must be close to the node clock.
- `CONTRACT_SUPPLY` is a binary protobuf record `{1: maxSupply, 2: circulation}`.
  `decodeContractSupply` returns that second field as both `currentSupply`
  and `circulation`.
- `getAuthorizedFeeTokens` caches a successful response for 60 seconds.

## Tests

`tests/` runs offline against ConnectRPC's in-memory router transport.
`tests/live.test.ts` performs read-only calls against a real node when
`KALVORA_LIVE_ENDPOINT` is set (`npm run test:live`).
