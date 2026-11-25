# Governance proposals

Two builders submit a `GovernanceProposal`:

| Function | Use it for |
|---|---|
| `buildTextGovernanceProposalTXN` / `createTextGovernanceProposalTXN` | A text proposal with no executable transactions |
| `buildGovernanceProposalTXN` (`buildGovernanceProposal`) | A text proposal, a binary proposal that carries transactions, or a multi-option proposal |

`sendGovernanceProposalTXN` submits a signed proposal and returns the hex hash.
That hash means the node accepted it into the mempool. Confirm inclusion with
`waitForTransaction` or `KalvoraClient.submitAndWait`. On success,
`result.proposalIdentifier` is the network-assigned proposal id.

The signer must hold a positive balance of at least one contract in
`governance.allowedProposalInstrument`. Read that list from
`query.getContract(contractId)`.

## Text proposal

```typescript
import { createTextGovernanceProposalTXN, sendGovernanceProposalTXN } from 'kalvora.js';

const proposal = await createTextGovernanceProposalTXN(
  {
    contractId,
    title: 'Treasury report',
    synopsis: 'Publish the quarterly report.',
    body: 'The report is attached in the discussion thread.'
  },
  publicKey,
  privateKey
);
const hash = await sendGovernanceProposalTXN(proposal);
```

`title`, `synopsis`, and `body` are limited to 512, 2048, and 16384 UTF-8
bytes (`TEXT_PROPOSAL_LIMITS`).

## Proposal that executes a coin transfer

A binary proposal leaves `options` empty and puts the action in
`governanceTxn`. The inner transaction is not executed when the proposal is
submitted. The node only checks that it parses, that its hash matches, and
that `base.public_key.governance_auth` is the ASCII string `gov_` plus the
proposal contract id. Set that field before signing the inner transaction,
and do not put an interface fee on it.

```typescript
import { create, toBinary } from '@bufbuild/protobuf';
import {
  proto,
  buildCoinTXN,
  buildGovernanceProposalTXN,
  signCoinTXNWithKeys,
  signWithKey,
  sendGovernanceProposalTXN,
  KALVORA_NATIVE_TOKEN
} from 'kalvora.js';

const { contract } = await kalvora.query.getContract(contractId);
const governance = contract.governance;
if (!governance) throw new Error('contract has no governance');

const coin = await buildCoinTXN(
  [{ publicKey, amount: '0.000000001' }],
  [{ to: walletAddress, amount: '0.000000001' }],
  KALVORA_NATIVE_TOKEN,
  { baseFeeId: KALVORA_NATIVE_TOKEN },
  '',
  kalvora.grpcConfig
);
if (!coin.base) throw new Error('coin txn has no base');
coin.base.publicKey = create(proto.txn.PublicKeySchema, {
  governanceAuth: new TextEncoder().encode(`gov_${contractId}`)
});
const signedCoin = signCoinTXNWithKeys(coin, [{ publicKey, privateKey }]);
if (!signedCoin.base?.hash) throw new Error('coin txn has no hash');

const unsigned = await buildGovernanceProposalTXN({
  contractId,
  title: 'Send one part',
  synopsis: 'Move one part of KALV.',
  body: 'Passing this proposal sends 0.000000001 KALV.',
  publicKey,
  governanceTxn: [create(proto.txn.GovernanceTXNSchema, {
    txnType: proto.txn.TRANSACTION_TYPE.COIN_TYPE,
    serializedTxn: toBinary(proto.txn.CoinTXNSchema, signedCoin),
    txnHash: signedCoin.base.hash
  })],
  governance: {
    type: governance.type,
    allowMulti: governance.allowMulti,
    stageLengthCount: governance.stageLength.length,
    hasPreGovernance: governance.preGovernance !== undefined
  }
}, { grpcConfig: kalvora.grpcConfig });

const hash = await sendGovernanceProposalTXN(
  signWithKey(unsigned, privateKey, publicKey),
  kalvora.grpcConfig
);
```

Coin amounts on the inner transfer are whole tokens (`'0.000000001'` is one
part of a 9-decimal token). The outer proposal fee is in smallest units and
is calculated for you when `governance` is provided.

Adaptive governance (`GOVERNANCE_TYPE.ADAPTIVE`) also requires
`startTimestamp` and `endTimestamp`, with the start not after the end. Other
governance types must leave both unset.

## Multi-option proposals

Pass `options` and leave `governanceTxn` empty. Option 0 must be the exact
string `against` and must not carry transactions. Other options must not
contain any word in `FORBIDDEN_OPTION_WORDS` (matched case-insensitively as
a substring). Each executable option is a `governanceOptionTxns` entry whose
`optionIndex` is greater than 0 and unique:

```typescript
await buildGovernanceProposalTXN({
  contractId,
  title: 'Choose a recipient',
  synopsis: 'One recipient receives the transfer.',
  body: 'Vote for the wallet that should receive one part.',
  publicKey,
  options: ['against', 'treasury', 'grants'],
  governanceOptionTxns: [
    { optionIndex: 1, governanceTxn: [treasuryCoin] },
    { optionIndex: 2, governanceTxn: [grantsCoin] }
  ],
  governance: feeContext
});
```

`feeContext` is the same snapshot shown above. A contract with
`allowMulti: false` rejects any `options`.

## Fees and offline builds

The builder counts all effective PRE and POST councils and adds
`ceil(fee / divisor)` per council before the non-native multiplier. The
divisor is `stageLengthCount + 1`, or `2` for an empty regular-stage list.
Pass the contract's `preGovernanceStageCount`, `postGovernanceStageCount`,
and `allowProposalCouncils` in the governance snapshot. Proposal-specific
`additionalPreGovernance` and `additionalPostGovernance` arrays append to
the mandatory councils. Omit unused arrays. Each effective phase allows 32
councils. Signed ballots use the exact active zero-based index in
`preGovernanceStage` or `postGovernanceStage` with binary `support`.
Pass the current `getProposalDetail(...).firstPage` as the vote builder's
`proposalDetail` option to bind the ballot to its active phase and step.

Executable proposal branches retain their ordered, serialized child transactions.
The builder checks the governance authority and each child's hash. Child hashes
must be unique within a branch. Mutually exclusive options may share a child.
Children can carry votes aimed at different proposals, including distinct PRE
or POST steps. Each child's target contract evaluates that ballot at execution.

To build offline, pass both `nonce` and `feeAmountParts`. `feeAmountParts`
must already include the stage surcharge. The qualified-fee check is skipped
offline; online, `feeId` must be the native token or a token from
`getAuthorizedFeeTokens()`.

## Granular and regular voting

A GRANULAR proposal supplies `granular: { threshold, regularQuorum, voterWallets, votingInstrument? }`.
Thresholds are in basis points from 1 through 10,000. Supply the complete raw
addresses of 1–1,000 distinct voters and whole-second `startTimestamp` and
`endTimestamp` values. The end must be after both the start and acceptance,
within 90 days of acceptance. The offline builder uses its transaction time as
the estimate. Each listed wallet votes directly. A recorded zero-weight vote
still contributes to participation. Granular proposals use no councils.

For regular governance, configure one positive uint64 ratio per voting instrument.
Use `regularVotingUnits(aggregate, denomination, frozenRatio)` once per instrument
and choice. Use denomination one for NFTs and SBTs. Read the ratios frozen at
acceptance from the receipt.
