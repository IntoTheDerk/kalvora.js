import { describe, expect, it } from 'vitest';

import { GOVERNANCE_TYPE } from '../../../proto/generated/txn_pb.js';
import { GENESIS_CONTRACT_IDS } from '../../protocol/contract-id.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import { buildGovernanceProposalTXN } from '../governance.js';
import { applyProposalStageFee, assertGovernanceProposalShape } from '../shape.js';

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
