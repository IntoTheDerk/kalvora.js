import { fromBinary, toBinary } from '@bufbuild/protobuf';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import { ComplianceTXNSchema } from '../../../proto/generated/txn_pb.js';
import { getPublicKeyBytes } from '../../shared/crypto/address-utils.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import {
  MAX_COMPLIANCE_LEVEL,
  buildComplianceTXN,
  createComplianceTXN,
  sendComplianceTXN,
  type ComplianceAssignmentInput,
  type ComplianceTXNInput
} from '../index.js';

const { alice, bob, charlie } = ED25519_TEST_KEYS;
const EXPIRY = new Date('2027-12-31T12:34:56.789Z');
const OPTIONS = {
  nonce: 21,
  feeAmountParts: '500',
  timestamp: new Date('2026-07-25T09:22:00.000Z')
};
const INPUT: ComplianceTXNInput = {
  contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  assignments: [
    { recipientAddress: bob.address, complianceLevel: 1, assign: true, expiry: EXPIRY },
    { recipientAddress: charlie.address, complianceLevel: 2, assign: false }
  ],
  publicKey: alice.publicKey
};

function withAssignment(override: Partial<Record<keyof ComplianceAssignmentInput, unknown>>): ComplianceTXNInput {
  return {
    ...INPUT,
    assignments: [{ ...INPUT.assignments[0], ...override } as unknown as ComplianceAssignmentInput]
  };
}

describe('ComplianceTXN', () => {
  it('maps assignments onto ComplianceAssign entries', async () => {
    const txn = await buildComplianceTXN(INPUT, { ...OPTIONS, memo: 'kyc batch 1', safeSend: true });

    expect(txn.$typeName).toBe('zera_txn.ComplianceTXN');
    expect(txn.contractId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.compliance).toHaveLength(2);

    const [first, second] = txn.compliance;
    expect(first?.$typeName).toBe('zera_txn.ComplianceAssign');
    expect(first?.recipientAddress).toEqual(bs58.decode(bob.address));
    expect(first?.complianceLevel).toBe(1);
    expect(first?.assignRevoke).toBe(true);
    expect(first?.expiry?.seconds).toBe(BigInt(Math.floor(EXPIRY.getTime() / 1000)));
    expect(first?.expiry?.nanos).toBe(789_000_000);

    expect(second?.recipientAddress).toEqual(bs58.decode(charlie.address));
    expect(second?.complianceLevel).toBe(2);
    expect(second?.assignRevoke).toBe(false);
    expect(second?.expiry).toBeUndefined();

    expect(txn.base?.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.base?.feeAmount).toBe('500');
    expect(txn.base?.nonce).toBe(21n);
    expect(txn.base?.memo).toBe('kyc batch 1');
    expect(txn.base?.safeSend).toBe(true);
    expect(txn.base?.publicKey?.single).toEqual(new Uint8Array(getPublicKeyBytes(alice.publicKey)));
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.hash).toBeUndefined();
  });

  it('accepts the uint32 bounds for complianceLevel', async () => {
    const txn = await buildComplianceTXN(
      {
        ...INPUT,
        assignments: [
          { recipientAddress: bob.address, complianceLevel: 0, assign: true },
          { recipientAddress: bob.address, complianceLevel: MAX_COMPLIANCE_LEVEL, assign: true }
        ]
      },
      OPTIONS
    );
    expect(txn.compliance.map(c => c.complianceLevel)).toEqual([0, 4294967295]);
    const decoded = fromBinary(ComplianceTXNSchema, toBinary(ComplianceTXNSchema, txn));
    expect(decoded.compliance[1]?.complianceLevel).toBe(4294967295);
  });

  it.each([
    [{ complianceLevel: -1 }, /assignments\[0\]\.complianceLevel must be an integer between 0 and 4294967295/],
    [{ complianceLevel: 4294967296 }, /complianceLevel must be an integer/],
    [{ complianceLevel: 1.5 }, /complianceLevel must be an integer/],
    [{ complianceLevel: '1' }, /complianceLevel must be an integer/],
    [{ assign: 'yes' }, /assignments\[0\]\.assign must be a boolean/],
    [{ recipientAddress: '' }, /assignments\[0\]\.recipientAddress must be a non-empty base58 address/],
    [{ recipientAddress: 'l0l0' }, /assignments\[0\]\.recipientAddress is not a valid base58 address/],
    [{ expiry: '2027-01-01' }, /assignments\[0\]\.expiry must be a valid Date/],
    [{ expiry: new Date('invalid') }, /assignments\[0\]\.expiry must be a valid Date/],
    [{ expiry: new Date('+010000-01-01T00:00:00Z') }, /expiry must be between/],
    [{ assign: false, expiry: EXPIRY }, /expiry is only allowed when assign is true/]
  ])('rejects invalid assignment %j', async (override, message) => {
    await expect(buildComplianceTXN(withAssignment(override), OPTIONS)).rejects.toThrow(message);
  });

  it('rejects empty, malformed, or duplicate assignment lists', async () => {
    await expect(buildComplianceTXN({ ...INPUT, assignments: [] }, OPTIONS)).rejects.toThrow(/non-empty array/);
    await expect(
      buildComplianceTXN({ ...INPUT, assignments: undefined } as unknown as ComplianceTXNInput, OPTIONS)
    ).rejects.toThrow(/non-empty array/);
    await expect(
      buildComplianceTXN({ ...INPUT, assignments: [null] } as unknown as ComplianceTXNInput, OPTIONS)
    ).rejects.toThrow(/assignments\[0\] must be an object/);
    await expect(
      buildComplianceTXN(
        {
          ...INPUT,
          assignments: [
            { recipientAddress: bob.address, complianceLevel: 1, assign: true },
            { recipientAddress: ` ${bob.address}`, complianceLevel: 1, assign: false }
          ]
        },
        OPTIONS
      )
    ).rejects.toThrow(/assignments\[1\] duplicates/);
  });

  it('rejects invalid contractId, publicKey, and input object', async () => {
    await expect(buildComplianceTXN({ ...INPUT, contractId: '' }, OPTIONS)).rejects.toThrow(/contractId must be a Kalvora mint ID/);
    await expect(buildComplianceTXN({ ...INPUT, publicKey: '' }, OPTIONS)).rejects.toThrow(/publicKey identifier is required/);
    await expect(buildComplianceTXN(null as unknown as ComplianceTXNInput, OPTIONS)).rejects.toThrow(/input object is required/);
  });

  it('signs via createComplianceTXN and round-trips through binary', async () => {
    const txn = await createComplianceTXN(INPUT, alice.privateKey, OPTIONS);

    expect(txn.base?.signature?.length).toBe(64);
    expect(txn.base?.hash?.length).toBe(32);

    const decoded = fromBinary(ComplianceTXNSchema, toBinary(ComplianceTXNSchema, txn));
    expect(decoded).toEqual(txn);
  });

  it('createComplianceTXN requires a private key', async () => {
    await expect(createComplianceTXN(INPUT, '', OPTIONS)).rejects.toThrow(/privateKey is required/);
  });

  it('sendComplianceTXN rejects unsigned transactions', async () => {
    const txn = await buildComplianceTXN(INPUT, OPTIONS);
    await expect(sendComplianceTXN(txn)).rejects.toThrow(/must be signed/);
  });
});
