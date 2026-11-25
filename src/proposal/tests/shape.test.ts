import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { ProposalDetailResponseSchema } from '../../../proto/generated/kal_api_pb.js';
import { GOVERNANCE_TYPE, GovernanceSchema, GovernanceTXNSchema, GovernanceVoteSchema, TRANSACTION_TYPE } from '../../../proto/generated/txn_pb.js';
import { PROPOSAL_PHASE } from '../../../proto/generated/validator_pb.js';
import { GENESIS_CONTRACT_IDS } from '../../protocol/contract-id.js';
import { createTransactionHash } from '../../shared/crypto/signature-utils.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import { buildVoteTXN } from '../../vote/transaction.js';
import { buildGovernanceProposalTXN } from '../governance.js';
import { applyProposalStageFee, assertGovernanceProposalShape, regularVotingUnits, validateGovernanceSettings } from '../shape.js';

describe('governance proposal shape', () => {
  it('requires against as option 0 and rejects mixed execution', () => {
    expect(() => assertGovernanceProposalShape({ options: ['yes'] })).toThrow(/against/);
    expect(() => assertGovernanceProposalShape({
      options: ['against', 'raise the fee'],
      governanceTxn: [{} as never]
    })).toThrow(/cannot set both/);
    expect(() => assertGovernanceProposalShape({
      options: ['against', 'do nothing']
    })).toThrow(/forbidden word/);
    expect(() => assertGovernanceProposalShape({
      options: ['against', 'option A'],
      allowMulti: false
    })).toThrow(/does not allow multi-option/);
    assertGovernanceProposalShape({
      options: ['against', 'option A'],
      allowMulti: true,
      governanceOptionTxns: []
    });
  });

  it('adds the pre-governance stage surcharge', () => {
    expect(applyProposalStageFee('100', 0, false)).toBe('100');
    expect(applyProposalStageFee('100', 1, true)).toBe('150');
    expect(applyProposalStageFee('5', 0, true)).toBe('8');
    expect(applyProposalStageFee('5', 0, 3)).toBe('14');
  });

  it('preserves ordered vote actions and their signed choice and council step inside each proposal branch', async () => {
    const contractId = GENESIS_CONTRACT_IDS.KALV;
    const makeAction = (stage: 'preGovernanceStage' | 'postGovernanceStage', support: boolean) => {
      const vote = create(GovernanceVoteSchema, {
        contractId: GENESIS_CONTRACT_IDS.PREGOV, proposalId: new Uint8Array(32),
        base: { intendedType: TRANSACTION_TYPE.VOTE_TYPE, publicKey: { governanceAuth: new TextEncoder().encode(`gov_${contractId}`) } },
        support, [stage]: 0
      });
      const txnHash = createTransactionHash(toBinary(GovernanceVoteSchema, vote));
      vote.base!.hash = txnHash;
      return create(GovernanceTXNSchema, { txnType: TRANSACTION_TYPE.VOTE_TYPE, txnHash, serializedTxn: toBinary(GovernanceVoteSchema, vote) });
    };
    const pre = makeAction('preGovernanceStage', false);
    const post = makeAction('postGovernanceStage', true);
    const input = { contractId, publicKey: ED25519_TEST_KEYS.alice.address, title: 'Votes', synopsis: 'Review', body: 'Vote on two proposals',
      options: ['against', 'both', 'first'], governanceOptionTxns: [
        { optionIndex: 1, governanceTxn: [pre, post] }, { optionIndex: 2, governanceTxn: [pre] }
      ] };
    const options = { nonce: 1, feeAmountParts: '100' };
    const proposal = await buildGovernanceProposalTXN(input, options);
    expect(proposal.governanceOptionTxns[0]?.governanceTxn.map(action => action.serializedTxn)).toEqual([pre.serializedTxn, post.serializedTxn]);
    await expect(buildGovernanceProposalTXN({ ...input, governanceOptionTxns: [{ optionIndex: 1, governanceTxn: [pre, pre] }] }, options)).rejects.toThrow(/Duplicate/);
    pre.txnHash = new Uint8Array(32);
    await expect(buildGovernanceProposalTXN(input, options)).rejects.toThrow(/hash mismatch/);
  });

  it('preserves granular wallet widths and validates thresholds, uniqueness and time bounds', async () => {
    const start = new Date('2026-11-25T00:00:00Z');
    const input = {
      contractId: GENESIS_CONTRACT_IDS.KALV, publicKey: ED25519_TEST_KEYS.alice.address,
      title: 'Vote', synopsis: 'Survey', body: 'Poll the electorate.',
      startTimestamp: start, endTimestamp: new Date(start.getTime() + 86400000),
      governance: { type: GOVERNANCE_TYPE.GRANULAR, stageLengthCount: 0, allowMulti: true },
      granular: { threshold: 10000, regularQuorum: 1, voterWallets: [new Uint8Array(1126), new Uint8Array(64)] }
    };
    const options = { nonce: 1, feeAmountParts: '1', timestamp: start };
    expect((await buildGovernanceProposalTXN(input, options)).granular?.voterWallets.map(v => v.length)).toEqual([1126, 64]);
    await expect(buildGovernanceProposalTXN({ ...input, endTimestamp: new Date(start.getTime() + 90 * 86400000 + 1000) }, options)).rejects.toThrow(/90 days/);
    await expect(buildGovernanceProposalTXN({ ...input, granular: { ...input.granular, threshold: 0 } }, options)).rejects.toThrow(/threshold/);
    await expect(buildGovernanceProposalTXN({ ...input, granular: { ...input.granular,
      voterWallets: [new Uint8Array(32), new Uint8Array(32)] } }, options)).rejects.toThrow(/distinct/);
    await expect(buildGovernanceProposalTXN({ ...input, additionalPostGovernance: [] }, options)).rejects.toThrow(/council/i);
  });

  it('requires one positive ratio per voting instrument and floors the aggregate once', () => {
    const contractId = GENESIS_CONTRACT_IDS.KALV;
    const ratio = { contractId, numerator: 5n, denominator: 3n };
    const config = create(GovernanceSchema, { votingInstrument: [contractId], votingRatio: [ratio] });
    validateGovernanceSettings(config);
    expect(regularVotingUnits(199n, 100n, ratio)).toBe(3n);
    config.votingRatio[0]!.denominator = 0n;
    expect(() => validateGovernanceSettings(config)).toThrow(/positive/);
    config.votingRatio.length = 0;
    expect(() => validateGovernanceSettings(config)).toThrow(/requires one ratio/);
  });

  it('signs index zero for PRE and POST while preserving binary false and regular option zero', async () => {
    const id = '00'.repeat(32);
    const contractId = GENESIS_CONTRACT_IDS.KALV;
    const base = { nonce: 1, feeAmountParts: '100' };
    for (const [phase, field] of [[PROPOSAL_PHASE.PRE_GOVERNANCE, 'preGovernanceStage'], [PROPOSAL_PHASE.POST_GOVERNANCE, 'postGovernanceStage']] as const) {
      const proposalDetail = create(ProposalDetailResponseSchema, { contractId, proposalId: new Uint8Array(32), phase, [field]: 0 });
      const vote = await buildVoteTXN(contractId, id, ED25519_TEST_KEYS.alice.address, { ...base, proposalDetail, support: false });
      const decoded = fromBinary(GovernanceVoteSchema, toBinary(GovernanceVoteSchema, vote));
      expect(decoded[field]).toBe(0);
      expect(decoded.support).toBe(false);
      await expect(buildVoteTXN(contractId, id, ED25519_TEST_KEYS.alice.address, { ...base, proposalDetail, [field]: 1, support: false })).rejects.toThrow(/stale/);
    }
    const vote = await buildVoteTXN(contractId, id, ED25519_TEST_KEYS.alice.address, { ...base, supportOption: 0 });
    expect(vote.supportOption).toBe(0);
    expect(vote.preGovernanceStage).toBeUndefined();
    expect(vote.postGovernanceStage).toBeUndefined();
  });

  it('builds an offline proposal with against as option 0', async () => {
    const txn = await buildGovernanceProposalTXN({
      contractId: GENESIS_CONTRACT_IDS.PREGOV,
      title: 'Title',
      synopsis: 'Synopsis',
      body: 'Body',
      publicKey: ED25519_TEST_KEYS.alice.publicKey,
      options: ['against', 'option A'],
      governance: {
        type: GOVERNANCE_TYPE.STAGED,
        allowMulti: true,
        stageLengthCount: 1,
        hasPreGovernance: false
      }
    }, {
      nonce: 1,
      feeAmountParts: '1000',
      timestamp: new Date('2026-07-25T09:22:00.000Z')
    });
    expect(txn.options).toEqual(['against', 'option A']);
    expect(txn.governanceTxn).toEqual([]);
    expect(txn.base?.feeAmount).toBe('1000');
    expect(txn.base?.signature).toBeUndefined();
  });

  it('rejects adaptive proposals without a window', async () => {
    await expect(buildGovernanceProposalTXN({
      contractId: GENESIS_CONTRACT_IDS.KALV,
      title: 'Title',
      synopsis: 'Synopsis',
      body: 'Body',
      publicKey: ED25519_TEST_KEYS.alice.publicKey,
      governance: {
        type: GOVERNANCE_TYPE.ADAPTIVE,
        allowMulti: false,
        stageLengthCount: 0,
        hasPreGovernance: true
      }
    }, { nonce: 1, feeAmountParts: '10' })).rejects.toThrow(/startTimestamp/);
  });
});
