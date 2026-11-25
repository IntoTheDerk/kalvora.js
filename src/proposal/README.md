# Governance proposals

Use `createTextGovernanceProposalTXN` for a reviewed text proposal, and
`buildGovernanceProposalTXN` for a proposal with executable actions, ballot
options, councils, or granular rules. The following examples share a registered
Falcon proposer and a client pinned to the deployment's final block-zero hash.

```typescript
import {
  createKalvoraClient, FalconWallet, pinNetwork,
  createTextGovernanceProposalTXN, buildGovernanceProposalTXN,
  finalizeTransactionHash, signAndFinalize, proto, KALVORA_NATIVE_TOKEN
} from 'kalvora.js';
import { create, toBinary } from '@bufbuild/protobuf';

const wallet = FalconWallet.restore(protectedWalletBackup);
const network = pinNetwork('protonet', 'kal_proto', trustedBlockZeroHashHex);
const kalvora = createKalvoraClient({
  network, grpc: { endpoint: validatorEndpoint, trustedOperatorAddress }
});

const registration = await kalvora.query.getSigningWallet(wallet.walletAddress);
if (registration?.identity.case !== 'falcon') throw new Error('Proposer registration is required');

const { contract } = await kalvora.query.getContract(contractId);
const settings = contract.governance;
if (!settings) throw new Error('Contract has no governance');
const feeContext = {
  type: settings.type,
  allowMulti: settings.allowMulti,
  stageLengthCount: settings.stageLength.length,
  preGovernanceStageCount: settings.preGovernance ? 1 : settings.preGovernanceStages.length,
  postGovernanceStageCount: settings.postGovernanceStages.length,
  allowProposalCouncils: settings.allowProposalCouncils
};
```

The proposer must qualify under the contract's allowed proposal instruments.
Use the full selected wallet address for transactions and the published pin for
the intended deployment. The examples below assume staged governance.

## Text proposal

Obtain a current, reviewed `ProposalConstructionContext` from your Kalvora
indexer integration for the same protonet, contract, wallet and eligible
proposal instruments. The text builder checks its schema, policy version,
governance type and validity window. Pass that snapshot as
`reviewedConstructionContext`. Text proposals support staged, cycle and
staggered governance. The title, synopsis and body limits are 512, 2,048 and
16,384 UTF-8 bytes.

```typescript
const proposal = await createTextGovernanceProposalTXN(
  {
    contractId, title: 'Treasury report', synopsis: 'Publish the quarterly report.',
    body: 'The report is attached in the discussion thread.'
  },
  wallet.walletAddress, wallet,
  {
    constructionContext: reviewedConstructionContext,
    grpcConfig: kalvora.grpcConfig,
    proposalStages: {
      stageLengthCount: feeContext.stageLengthCount,
      councilStepCount: feeContext.preGovernanceStageCount + feeContext.postGovernanceStageCount
    }
  }
);
const receipt = await kalvora.submitAndWait(proposal, { verifyFinalizedBlock });
if (!receipt.success) throw new Error(receipt.statusName);
```

Supply your application's `verifyFinalizedBlock` callback for the pinned chain
and committee or trusted finalized block source. `receipt.proposalIdentifier`
is the numeric identifier assigned at acceptance. Use the proposal transaction
hash for `getProposalDetail` and votes. Acceptance of the outer proposal starts
its lifecycle. Execution of its children requires a subsequent committed outcome.

## Proposal with a governance vote action

This binary proposal asks the governing contract to vote YES in the target
proposal's current PRE council. Use a governing authority eligible for that
ballot, the authority's expected child nonce, and an adequate fee cap in parts.
The target must still accept that council step when the child executes.

```typescript
const target = await kalvora.query.getProposalDetail(targetProposalHashHex);
const detail = target?.firstPage;
if (!detail || detail.phase !== proto.validator.PROPOSAL_PHASE.PRE_GOVERNANCE ||
    detail.promotionPending || detail.preGovernanceStage === undefined) {
  throw new Error('Target has no active PRE council step');
}

const vote = create(proto.txn.GovernanceVoteSchema, {
  contractId: detail.contractId,
  proposalId: detail.proposalId,
  support: true,
  preGovernanceStage: detail.preGovernanceStage,
  base: {
    publicKey: { governanceAuth: new TextEncoder().encode(`gov_${contractId}`) },
    chainId: wallet.chainId,
    signatureDomain: new TextEncoder().encode('KAL_USER_TXN_V1'),
    intendedType: proto.txn.TRANSACTION_TYPE.VOTE_TYPE,
    nonce: childNonce, feeId: KALVORA_NATIVE_TOKEN, feeAmount: childFeeCapParts
  }
});
finalizeTransactionHash(vote, kalvora.grpcConfig.transactionContext);
if (!vote.base?.hash) throw new Error('Missing child hash');
const action = create(proto.txn.GovernanceTXNSchema, {
  txnType: proto.txn.TRANSACTION_TYPE.VOTE_TYPE,
  txnHash: vote.base.hash,
  serializedTxn: toBinary(proto.txn.GovernanceVoteSchema, vote)
});

const unsigned = await buildGovernanceProposalTXN({
  contractId,
  publicKey: wallet.walletAddress,
  title: 'Cast the council vote',
  synopsis: 'Support the target proposal in its current review.',
  body: 'If approved, this proposal submits the attached YES ballot.',
  governance: feeContext, governanceTxn: [action]
}, { grpcConfig: kalvora.grpcConfig, proofLayout: { owner: wallet.variant } });
const signed = await signAndFinalize(unsigned, wallet, kalvora.grpcConfig.transactionContext);
const result = await kalvora.submitAndWait(signed, { verifyFinalizedBlock });
if (!result.success) throw new Error(result.statusName);
```

The child identifies its internal authority with the exact bytes of
`gov_<outer contract ID>`. It carries no wallet proof, sponsor, or interface
fee. Its wrapper stores the exact child bytes and the SHA3-256 digest computed
with only the child hash cleared. The registered proposer signs the outer
proposal. The builder checks the authority and hashes and rejects duplicate
child hashes within the same branch. For ordered actions, supply the wrappers
in execution order.

## Multi-option proposals and councils

For an alternative ballot, use the same `action` in an option branch. This
example requires the contract's `allowMulti` setting. The option at index zero
must be the exact string `against` and carries no actions. Other labels must
avoid the substrings in `FORBIDDEN_OPTION_WORDS`. Each action-bearing option
index must be positive and unique.

```typescript
const alternative = await buildGovernanceProposalTXN({
  contractId, publicKey: wallet.walletAddress,
  title: 'Choose a council response', synopsis: 'Choose whether to cast the ballot.',
  body: 'The second option submits the attached vote.',
  governance: feeContext, options: ['against', 'cast the ballot'],
  governanceOptionTxns: [{ optionIndex: 1, governanceTxn: [action] }]
}, { grpcConfig: kalvora.grpcConfig, proofLayout: { owner: wallet.variant } });
```

Sign and submit the selected alternative with the same pinned client. A
multi-option proposal leaves its top-level `governanceTxn` empty. Separate
option branches can reuse the same child hash.

The contract may configure a singleton PRE council or an ordered PRE list, and
an independent POST list. When `allowProposalCouncils` is true, append nonempty
`additionalPreGovernance` and/or `additionalPostGovernance` stage arrays to
the proposal. Each phase permits at most 32 mandatory and additional stages
combined. Omit an array when adding no stages. The builder adds
`ceil(base / divisor)` per effective council before applying the non-native
multiplier. The divisor is `stageLengthCount + 1`, or 2 for no regular stages.
For an offline build, pass the next `nonce` and an explicit `feeAmountParts`
that covers the full signed size and applicable charges.

Read the frozen active step from `getProposalDetail`. An array PRE vote sets
`preGovernanceStage`, and a POST vote sets `postGovernanceStage`, including
index zero. A singleton PRE without appended PRE stages also accepts an omitted
index. Council votes use binary `support`. Regular votes omit both council
indices. Pass the detail's `firstPage` as `proposalDetail` to `buildVoteTXN`
or `createVoteTXN` to select and validate the active step.

## Granular and regular voting

A GRANULAR proposal supplies `granular: { threshold, regularQuorum, voterWallets, votingInstrument? }`.
Thresholds are in basis points from 1 through 10,000. Supply the complete raw
addresses of 1–1,000 distinct voters and whole-second `startTimestamp` and
`endTimestamp` values. The end must be after both the start and acceptance and
within 90 days of acceptance. The offline builder uses its transaction time as
the estimate. Each listed wallet votes directly. A recorded zero-weight vote
contributes to participation. Granular proposals use no councils. Adaptive
proposals also supply explicit start and end times with the start before the end.

For regular governance, configure one positive uint64 ratio per voting instrument.
Use `regularVotingUnits(aggregate, denomination, frozenRatio)` once per instrument
and choice. Use denomination one for NFTs and SBTs. Read the ratios frozen at
acceptance from the receipt.
