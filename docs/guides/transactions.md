---
title: Transactions
group: Guides
---

# Transactions

Every Kalvora transaction type has a module with three functions:

| Step     | Function          | Does                                                    |
|----------|-------------------|---------------------------------------------------------|
| build    | `build<Msg>(…)`   | Validates input, resolves nonce and fees, returns the **unsigned** protobuf message |
| create   | `create<Msg>(…)`  | `build` + sign with a private key                       |
| send     | `send<Msg>(txn)`  | Submits a **signed** message, returns the hex hash      |

Use `build` + `signAndFinalize(txn, signer)` when keys live elsewhere
(browser wallets, hardware wallets, MPC, cold storage).

## Catalog

| Message | Functions | Signer needs | Module docs |
|---------|-----------|--------------|-------------|
| `CoinTXN` | `buildCoinTXN` · `createCoinTXN` · `sendCoinTXN` | owns the inputs (or an allowance) | `src/coin-txn` |
| `MintTXN` | `buildMintTXN` · `createMintTXN` · `sendMintTXN` | restricted key with `mint` | `src/mint` |
| `InstrumentContract` | `buildContractTXN` · `createContractTXN` · `sendContractTXN` | any wallet (creator) | `src/contract` |
| `ContractUpdateTXN` | `buildContractUpdateTXN` · `createContractUpdateTXN` · `sendContractUpdateTXN` | restricted key with `update_contract` | `src/contract` |
| `RevokeTXN` | `buildRevokeTXN` · `createRevokeTXN` · `sendRevokeTXN` | restricted key with `revoke` | `src/revoke` |
| `QuashTXN` | `buildQuashTXN` · `createQuashTXN` · `sendQuashTXN` | restricted key with `quash` | `src/quash` |
| `ComplianceTXN` | `buildComplianceTXN` · `createComplianceTXN` · `sendComplianceTXN` | restricted key with `compliance` | `src/compliance` |
| `ExpenseRatioTXN` | `buildExpenseRatioTXN` · `createExpenseRatioTXN` · `sendExpenseRatioTXN` | restricted key with `expense_ratio` | `src/expense-ratio` |
| `AllowanceTXN` | `buildAllowanceTXN` · `createAllowanceTXN` · `sendAllowanceTXN` (+ `buildRevokeAllowanceTXN`) | the granting wallet | `src/allowance` |
| `DelegatedTXN` | `buildDelegatedTXN` · `createDelegatedTXN` · `sendDelegatedTXN` | the delegating wallet | `src/delegated-voting` |
| `ItemizedMintTXN` | `buildItemizedMintTXN` · `createItemizedMintTXN` · `sendItemizedMintTXN` | restricted key with `mint` | `src/items` |
| `NFTTXN` | `buildNFTTXN` · `createNFTTXN` · `sendNFTTXN` | item owner | `src/items` |
| `BurnSBTTXN` | `buildBurnSBTTXN` · `createBurnSBTTXN` · `sendBurnSBTTXN` | item owner | `src/items` |
| `GovernanceProposal` | `buildTextGovernanceProposalTXN` · `createTextGovernanceProposalTXN` · `sendGovernanceProposalTXN` | holder of an allowed proposal instrument | `src/proposal` |
| `GovernanceVote` | `buildVoteTXN` · `createVoteTXN` · `sendVoteTXN` | holder of a voting instrument | `src/vote` |
| `ProposalCancelTXN` | `buildProposalCancelTXN` · `createProposalCancelTXN` · `sendProposalCancelTXN` | the proposer | `src/proposal-cancel` |
| `SmartContractTXN` | `buildSmartContractTXN` · `createSmartContractTXN` · `sendSmartContractTXN` | any wallet (deployer) | `src/smart-contracts/deploy` |
| `SmartContractInstantiateTXN` | `buildSmartContractInstantiateTXN` · `create…` · `send…` | any wallet | `src/smart-contracts/instantiate` |
| `SmartContractExecuteTXN` | `buildSmartContractExecuteTXN` · `create…` · `send…` | depends on the contract | `src/smart-contracts/execute` |
| `ValidatorRegistration` | `buildValidatorRegistrationTXN` · `createValidatorRegistrationTXN` · `sendValidatorRegistrationTXN` | validator operator + generated node key | `src/validator-ops` |
| `ValidatorHeartbeat` | `buildValidatorHeartbeatTXN` · `createValidatorHeartbeatTXN` · `sendValidatorHeartbeatTXN` | validator operator | `src/validator-ops` |

Higher-level smart-contract workflows are namespaced: `staking`, `bootstrapping`,
`dex`, the Kalvora-side bridge functions (`lockKalvora`, `releaseKalvora`, …),
`solanaBridge`, and `guardianBridge`.

## Shared options (`StandardTXNOptions`)

The single-input builders (mint, revoke, quash, compliance, expense ratio,
allowance, delegated voting, validator ops) take one input object plus
`StandardTXNOptions`:

| Option | Default | Meaning |
|--------|---------|---------|
| `grpcConfig` | protonet | Endpoint for nonce and fee lookups |
| `nonce` | network nonce + 1 | Explicit replay-protection nonce (skips lookup) |
| `timestamp` | `new Date()` | `BaseTXN.timestamp` |
| `memo` | — | `BaseTXN.memo` |
| `feeId` | `KALVORA_NATIVE_TOKEN` | Base fee instrument |
| `feeAmountParts` | calculated | Exact base fee in smallest units (skips fee lookup) |
| `overestimatePercent` | `5` | Headroom on the calculated fee (the network charges only the real fee) |
| `safeSend` | unset | `BaseTXN.safe_send` |
| `interfaceFeeId` / `interfaceFee` / `interfaceAddress` | — | Integrator fee (all three together; amount in whole tokens) |

Amounts in these builders are **smallest units** (`bigint`, safe integer, or
digit string). Convert with `toSmallestUnits(amount, contractId, { denomination })`
or `query.getDenomination(contractId)`.

## Examples

### Mint new supply

```typescript
import { createMintTXN, sendMintTXN } from 'kalvora.js';

const txn = await createMintTXN(
  { contractId, amount: 5_000_000_000n, recipientAddress, publicKey: minter.publicKey },
  minter.privateKey,
  { grpcConfig }
);
const hash = await sendMintTXN(txn, grpcConfig);
```

### Grant and revoke a spending allowance

```typescript
import { createAllowanceTXN, createRevokeAllowanceTXN, usdToCurrencyEquivalent } from 'kalvora.js';

// Let `spender` move up to $250 worth of the token per month.
const grant = await createAllowanceTXN({
  publicKey: owner.publicKey,
  contractId,
  walletAddress: spender.address,
  allowedCurrencyEquivalent: usdToCurrencyEquivalent('250'),
  periodMonths: 1,
  startTime: new Date()
}, owner.privateKey);

// The spender then builds a CoinTXN with an input whose `allowanceAddress`
// is the owner's address (see src/allowance/README.md).

const revoke = await createRevokeAllowanceTXN(
  { publicKey: owner.publicKey, contractId, walletAddress: spender.address },
  owner.privateKey
);
```

### Quash a pending time-delayed transaction

```typescript
const quash = await createQuashTXN({ contractId, txnHash: pendingHash, publicKey: admin.publicKey }, admin.privateKey);
```

### Assign KYC compliance

```typescript
const compliance = await createComplianceTXN({
  contractId,
  publicKey: officer.publicKey,
  assignments: [
    { recipientAddress: alice, complianceLevel: 2, assign: true, expiry: new Date('2027-12-31') },
    { recipientAddress: bob, complianceLevel: 1, assign: false }
  ]
}, officer.privateKey);
```

### Build offline, sign on a hardware wallet

```typescript
const unsigned = await buildRevokeTXN(
  { contractId, recipientAddress, itemId: 'badge-42', publicKey: hw.publicKey },
  { nonce: 17n, feeAmountParts: '2000000', timestamp: new Date('2026-10-01T00:00:00Z') }
);
const signed = await signAndFinalize(unsigned, hardwareSigner); // KalvoraSigner
await sendRevokeTXN(signed, grpcConfig);
```

## Confirming inclusion

`send*` returns once a node accepts the transaction. To wait for the block
and read the processing status:

```typescript
const result = await kalvora.submitAndWait(signed);
result.success;     // TXN_STATUS.OK?
result.statusName;  // e.g. 'INSUFFICIENT_AMOUNT'
result.baseFees;    // fee actually charged (smallest units)
```

## Serialization for wallet hand-off

```typescript
import { serializeTransaction, deserializeTransaction } from 'kalvora.js';

const envelope = serializeTransaction(unsigned);   // { type: 'zera_txn.MintTXN', data: base64, version: 1 }
const restored = deserializeTransaction(envelope);  // back to the protobuf message
```
