---
title: Transactions
group: Guides
---

# Transactions

For a standard user transaction, pass the selected registered wallet's Base58 address in the builder's `publicKey` field. The SDK encodes its complete raw address in `PublicKey.wallet_address`. Configure the client with an operator-supplied endpoint, trusted operator address and the chain ID derived from its trusted final genesis hash. [Getting started](./getting-started.md)

| Step     | Function          | Does                                                    |
|----------|-------------------|---------------------------------------------------------|
| build    | `build<Msg>(…)`   | Validates input, resolves nonce and fees, returns the **unsigned** protobuf message |
| create   | `create<Msg>(…)`  | Builds and signs with the wallet or signers supplied to the helper |
| send     | `send<Msg>(txn)`  | Submits a **signed** message, returns the hex hash      |

Use `build` and `signAndFinalize(txn, signer)` for standard transactions with local or external signers. Coin uses `signCoinTXN` and one authorization entry per signing slot.

## Catalog

| Message | Functions | Signer needs | Module docs |
|---------|-----------|--------------|-------------|
| `WalletRegistration` | `buildWalletRegistration` · `signAndFinalize` · `client.submitAndWait` | new wallet, or witnesses satisfying the new policy | [Getting started](./getting-started.md) |
| `CoinTXN` | `buildCoinTXN` (`buildCoinTransfer`) · `createCoinTXN` · `sendCoinTXN` | owns the inputs (or an allowance) | `src/coin-txn` |
| `MintTXN` | `buildMintTXN` · `createMintTXN` (`buildMint`, signed) · `sendMintTXN` | wallet with the contract's mint grant | `src/mint` |
| `InstrumentContract` | `buildContractTXN` (`buildInstrumentContract`) · `createContractTXN` · `sendContractTXN` | any wallet (creator) | [Contract IDs](./contract-ids.md) |
| `ContractUpdateTXN` | `buildContractUpdateTXN` · `createContractUpdateTXN` · `sendContractUpdateTXN` | wallet with the update grant | `src/contract` |
| `RevokeTXN` | `buildRevokeTXN` (`buildRevoke`) · `createRevokeTXN` · `sendRevokeTXN` | wallet with the revoke grant | `src/revoke` |
| `ComplianceTXN` | `buildComplianceTXN` · `createComplianceTXN` · `sendComplianceTXN` | wallet with the compliance grant | `src/compliance` |
| `ExpenseRatioTXN` | `buildExpenseRatioTXN` · `createExpenseRatioTXN` · `sendExpenseRatioTXN` | wallet with the expense ratio grant | `src/expense-ratio` |
| `AllowanceTXN` | `buildAllowanceTXN` · `createAllowanceTXN` · `sendAllowanceTXN` (+ `buildRevokeAllowanceTXN`) | the granting wallet | `src/allowance` |
| `DelegatedTXN` | `buildDelegatedTXN` · `createDelegatedTXN` · `sendDelegatedTXN` | the delegating wallet | `src/delegated-voting` |
| `ItemizedMintTXN` | `buildItemizedMintTXN` (`buildItemMint`) · `createItemizedMintTXN` · `sendItemizedMintTXN` | wallet with the mint grant | `src/items` |
| `NFTTXN` | `buildNFTTXN` (`buildNftTransfer`) · `createNFTTXN` · `sendNFTTXN` | item owner | `src/items` |
| `BurnSBTTXN` | `buildBurnSBTTXN` (`buildSbtBurn`) · `createBurnSBTTXN` · `sendBurnSBTTXN` | item owner | `src/items` |
| `GovernanceProposal` | `buildGovernanceProposalTXN` · `buildTextGovernanceProposalTXN` · `createTextGovernanceProposalTXN` · `sendGovernanceProposalTXN` | holder of an allowed proposal instrument | `src/proposal` |
| `GovernanceVote` | `buildVoteTXN` · `createVoteTXN` · `sendVoteTXN` | holder of a voting instrument | `src/vote` |
| `ProposalCancelTXN` | `buildProposalCancelTXN` · `createProposalCancelTXN` · `sendProposalCancelTXN` | the proposer | `src/proposal-cancel` |
| `SmartContractTXN` | `buildSmartContractTXN` · `createSmartContractTXN` · `sendSmartContractTXN` | any wallet (deployer) | `src/smart-contracts/deploy` |
| `SmartContractInstantiateTXN` | `buildSmartContractInstantiateTXN` · `create…` · `send…` | any wallet | `src/smart-contracts/instantiate` |
| `SmartContractExecuteTXN` | `buildSmartContractExecuteTXN` · `create…` · `send…` | depends on the contract | `src/smart-contracts/execute` |
| `ValidatorRegistration` | `buildValidatorRegistrationTXN` · `createValidatorRegistrationTXN` · `sendValidatorRegistrationTXN` | registered owner and separate registered operational wallet for assignment | `src/validator-ops` |
| `ValidatorHeartbeat` | `buildValidatorHeartbeatTXN` · `createValidatorHeartbeatTXN` · `sendValidatorHeartbeatTXN` | operational wallet signs, owner supplies nonce and pays fee | `src/validator-ops` |

Higher-level smart-contract workflows are namespaced: `staking`, `bootstrapping`,
`dex`, the Kalvora-side bridge functions (`lockKalvora`, `releaseKalvora`, …),
`solanaBridge`, and `guardianBridge`.

## Shared options (`StandardTXNOptions`)

Mint, revoke, compliance, expense ratio, allowance, delegated voting and validator operations share the following build options.

| Option | Default | Meaning |
|--------|---------|---------|
| `grpcConfig` | preset endpoint | Set your endpoint and trusted `transactionContext.chainId` |
| `nonce` | network nonce + 1 | Explicit replay-protection nonce (skips lookup) |
| `timestamp` | `new Date()` | `BaseTXN.timestamp` |
| `memo` | — | `BaseTXN.memo` |
| `feeId` | `KALVORA_NATIVE_TOKEN` | Base fee instrument |
| `feeAmountParts` | calculated | Authorized base fee cap in smallest units (skips fee lookup) |
| `overestimatePercent` | `5` | Headroom on the calculated fee (the network charges only the real fee) |
| `safeSend` | unset | `BaseTXN.safe_send` |
| `proofLayout` | inferred or resolved where possible | Selected Falcon variants, policy slots and sponsor for sizing signed bytes |
| `interfaceFeeId` / `interfaceFee` / `interfaceAddress` | — | Integrator fee (all three together; amount in whole tokens) |

Amounts in these builders are **smallest units** (`bigint`, safe integer, or
digit string). Convert with `toSmallestUnits(amount, contractId, { denomination })`
or `query.getDenomination(contractId)`.

## Examples

### Mint new supply

The examples use a pinned `client` and the application's `verifyFinalizedBlock` callback. Each signer controls its selected registered address. The minter holds the contract's mint grant.

```typescript
import { createMintTXN } from 'kalvora.js';

const txn = await createMintTXN(
  { contractId, amount: 5_000_000_000n, recipientAddress, publicKey: minter.walletAddress },
  minter,
  { grpcConfig: client.grpcConfig }
);
const minted = await client.submitAndWait(txn, { verifyFinalizedBlock });
if (!minted.success) throw new Error(minted.statusName);
```

### Grant and revoke a spending allowance

```typescript
import { createAllowanceTXN, createRevokeAllowanceTXN, usdToCurrencyEquivalent } from 'kalvora.js';

// Let spender move up to $250 worth of the token per month.
const grant = await createAllowanceTXN({
  publicKey: owner.walletAddress,
  contractId,
  walletAddress: spender.walletAddress,
  allowedCurrencyEquivalent: usdToCurrencyEquivalent('250'),
  periodMonths: 1,
  startTime: new Date()
}, owner, { grpcConfig: client.grpcConfig });
const granted = await client.submitAndWait(grant, { verifyFinalizedBlock });
if (!granted.success) throw new Error(granted.statusName);

// The spender then builds a CoinTXN with an input whose `allowanceAddress`
// is the owner's address (see src/allowance/README.md).

// When the owner wants to revoke the allowance, build with the next nonce.
const revoke = await createRevokeAllowanceTXN(
  { publicKey: owner.walletAddress, contractId, walletAddress: spender.walletAddress },
  owner,
  { grpcConfig: client.grpcConfig }
);
```

### Sponsor a wallet registration

An already registered single-key sponsor can pay for a new wallet with no balance. Include the sponsor in the fee quote so it covers both proofs and the additional signer. Owner and sponsor each use their next nonce.

```typescript
import { buildWalletRegistration, countersignTransaction, signAndFinalize } from 'kalvora.js';

const sponsorNonce = await client.query.getNextNonce(sponsor.walletAddress);
const registration = await buildWalletRegistration(newWallet, {
  grpcConfig: client.grpcConfig,
  nonce: 1n,
  proofLayout: {
    sponsor: { address: sponsor.walletAddress, nonce: sponsorNonce, variant: sponsor.variant }
  }
});
const ownerSigned = await signAndFinalize(registration, newWallet);
const sponsored = await countersignTransaction(ownerSigned, sponsor, sponsorNonce);
const registered = await client.submitAndWait(sponsored, { verifyFinalizedBlock });
if (!registered.success) throw new Error(registered.statusName);
```

### Assign KYC compliance

```typescript
import { createComplianceTXN } from 'kalvora.js';

const compliance = await createComplianceTXN({
  contractId,
  publicKey: officer.walletAddress,
  assignments: [
    { recipientAddress: alice, complianceLevel: 2, assign: true, expiry: new Date('2027-12-31') },
    { recipientAddress: bob, complianceLevel: 1, assign: false }
  ]
}, officer, { grpcConfig: client.grpcConfig });
```

### Build offline and sign using a wallet adapter

Obtain the hardware or offline signer's selected address, trusted chain ID, next nonce and fee cap before disconnecting. Use a timestamp inside the network's acceptance window when submitting.

```typescript
import { buildRevokeTXN, signAndFinalize } from 'kalvora.js';

const unsigned = await buildRevokeTXN(
  { contractId, recipientAddress, itemId: '42', publicKey: selectedRegisteredAddress },
  { grpcConfig: client.grpcConfig, nonce: nextNonce, feeAmountParts: approvedCap, timestamp }
);
const signed = await signAndFinalize(unsigned, hardwareSigner, client.grpcConfig.transactionContext);
```

## Governance proposals

`buildTextGovernanceProposalTXN` builds a proposal with no executable
transactions. `buildGovernanceProposalTXN` (`buildGovernanceProposal`) also
attaches transactions: a binary proposal sets `governanceTxn` and leaves
`options` empty; a multi-option proposal sets `options` (option 0 is
`against`) and `governanceOptionTxns`. The inner transaction's
`base.public_key.governance_auth` must be the ASCII bytes of `gov_` plus
the proposal contract id, and its `base.hash` must be copied into
`GovernanceTXN.txnHash`. Pass the contract's governance snapshot so the fee
covers every effective PRE and POST step. Council step indices start at zero. Regular votes omit the council indices. Granular proposals use an explicit start and end time, separate participation and approval thresholds, and a distinct voter list. The optional instrument selects weighted voting. Report execution after checking the committed group or child outcomes.

## Contract IDs

New instrument contracts take a canonical Base58 id. Pass `vanityNonce`
(not the transaction nonce) and `buildContractTXN` derives it. Derivation,
checksums, genesis ids, and the token versus NFT/SBT field rules are in
[Contract IDs](./contract-ids.md).

`parseUint256` parses item ids and other uint256 strings (`'0'` through
`2^256-1`).

## Confirming inclusion

`send*` acknowledges submission. To match the signed hash to a receipt, verify finality and inspect the execution result, submit the signed transaction through the pinned client.

```typescript
const result = await client.submitAndWait(signed, { verifyFinalizedBlock });
result.success;     // TXN_STATUS.OK?
result.statusName;  // e.g. 'INSUFFICIENT_AMOUNT'
result.baseFees;    // fee actually charged (smallest units)
```

If submission times out, look up the same hash and check the committed nonce. Within the acceptance window, retrying identical signed bytes preserves the hash. Creating another Falcon signature changes it.

## Serialization for wallet hand-off

```typescript
import { serializeTransaction, deserializeTransaction } from 'kalvora.js';

const envelope = serializeTransaction(unsigned);   // { type: 'kal_txn.MintTXN', data: base64, version: 1 }
const restored = deserializeTransaction(envelope);  // back to the protobuf message
```
