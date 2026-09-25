import { toBinary } from '@bufbuild/protobuf';

import { ProposalCancelTXNSchema } from '../../../proto/generated/txn_pb.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import {
  buildProposalCancelTXN,
  createProposalCancelTXN
} from '../transaction.js';

const PROPOSAL_ID = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const OPTIONS = {
  nonce: 7,
  feeAmountParts: '100',
  timestamp: new Date('2026-07-25T09:22:00.000Z')
};

describe('ProposalCancelTXN', () => {
  it('builds an unsigned Kalvora proposal cancellation transaction', async () => {
    const txn = await buildProposalCancelTXN(
      'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      PROPOSAL_ID,
      ED25519_TEST_KEYS.alice.publicKey,
      OPTIONS
    );

    expect(txn.$typeName).toBe('zera_txn.ProposalCancelTXN');
    expect(txn.contractId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.proposalId).toEqual(Uint8Array.from(Buffer.from(PROPOSAL_ID, 'hex')));
    expect(txn.base?.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.base?.feeAmount).toBe('100');
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.hash).toBeUndefined();
    expect(toBinary(ProposalCancelTXNSchema, txn).length).toBeGreaterThan(0);
  });

  it('builds and signs a proposal cancellation transaction', async () => {
    const txn = await createProposalCancelTXN(
      'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      PROPOSAL_ID,
      ED25519_TEST_KEYS.alice.publicKey,
      ED25519_TEST_KEYS.alice.privateKey,
      OPTIONS
    );

    expect(txn.base?.signature).toBeInstanceOf(Uint8Array);
    expect(txn.base?.hash).toBeInstanceOf(Uint8Array);
  });
});
