import { fromBinary, toBinary } from '@bufbuild/protobuf';
import bs58 from 'bs58';

import { DelegatedTXNSchema } from '../../../proto/generated/txn_pb.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import {
  DELEGATE_PRIORITY_MAX,
  DELEGATE_PRIORITY_MIN,
  buildDelegatedTXN,
  createDelegatedTXN,
  sendDelegatedTXN,
  type DelegatedInput
} from '../index.js';

const { alice, bob, charlie } = ED25519_TEST_KEYS;
const OPTIONS = {
  nonce: 3,
  feeAmountParts: '250',
  timestamp: new Date('2026-07-25T09:22:00.000Z')
};

function baseInput(overrides: Partial<DelegatedInput> = {}): DelegatedInput {
  return {
    publicKey: alice.publicKey,
    delegateVotes: [
      {
        address: bob.address,
        contracts: [
          { contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 1 },
          { contractId: 'GOV111112', priority: 0 }
        ]
      },
      { address: charlie.address, contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 2 }] }
    ],
    delegateFees: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', authAmount: '1000000' }],
    ...overrides
  };
}

describe('buildDelegatedTXN', () => {
  it('maps delegates, contracts, priorities and fees', async () => {
    const txn = await buildDelegatedTXN(baseInput(), OPTIONS);

    expect(txn.$typeName).toBe('zera_txn.DelegatedTXN');
    expect(txn.delegateVotes).toHaveLength(2);
    const [first, second] = txn.delegateVotes;
    expect(first?.$typeName).toBe('zera_txn.DelegateVote');
    expect(bs58.encode(first?.address ?? new Uint8Array())).toBe(bob.address);
    expect(first?.contracts.map(c => [c.$typeName, c.contractId, c.priority])).toEqual([
      ['zera_txn.DelegateContract', 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', 1],
      ['zera_txn.DelegateContract', 'GOV111112', 0]
    ]);
    expect(bs58.encode(second?.address ?? new Uint8Array())).toBe(charlie.address);
    expect(txn.delegateFees).toHaveLength(1);
    expect(txn.delegateFees[0]?.$typeName).toBe('zera_txn.DelegateFees');
    expect(txn.delegateFees[0]?.authAmount).toBe('1000000');
    expect(txn.base?.nonce).toBe(3n);
    expect(txn.base?.feeAmount).toBe('250');
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.hash).toBeUndefined();
  });

  it('allows omitting delegateFees and accepts int32 bounds', async () => {
    const txn = await buildDelegatedTXN({
      publicKey: alice.publicKey,
      delegateVotes: [{
        address: bob.address,
        contracts: [
          { contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: DELEGATE_PRIORITY_MAX },
          { contractId: 'GOV111112', priority: DELEGATE_PRIORITY_MIN }
        ]
      }]
    }, OPTIONS);
    expect(txn.delegateFees).toEqual([]);
    expect(txn.delegateVotes[0]?.contracts[1]?.priority).toBe(DELEGATE_PRIORITY_MIN);
  });

  it('round-trips through binary encoding', async () => {
    const txn = await buildDelegatedTXN(baseInput(), OPTIONS);
    const decoded = fromBinary(DelegatedTXNSchema, toBinary(DelegatedTXNSchema, txn));
    expect(decoded.delegateVotes.map(v => bs58.encode(v.address))).toEqual([bob.address, charlie.address]);
    expect(decoded.delegateVotes[0]?.contracts.map(c => c.priority)).toEqual([1, 0]);
    expect(decoded.delegateFees[0]?.contractId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(decoded.delegateFees[0]?.authAmount).toBe('1000000');
  });

  describe('validation', () => {
    it.each<[string, Partial<DelegatedInput>, RegExp]>([
      ['empty delegateVotes', { delegateVotes: [] }, /delegateVotes must be a non-empty array/],
      ['missing delegateVotes', { delegateVotes: undefined as unknown as [] }, /delegateVotes must be a non-empty array/],
      ['empty contracts', { delegateVotes: [{ address: bob.address, contracts: [] }] }, /delegateVotes\[0\]\.contracts must be a non-empty/],
      ['duplicate contract within a delegate', {
        delegateVotes: [{
          address: bob.address,
          contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 1 }, { contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 2 }]
        }]
      }, /listed more than once for the same delegate/],
      ['duplicate delegate', {
        delegateVotes: [
          { address: bob.address, contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 1 }] },
          { address: bob.address, contracts: [{ contractId: 'GOV111112', priority: 1 }] }
        ]
      }, /duplicates an earlier delegate/],
      ['self delegation', {
        delegateVotes: [{ address: alice.address, contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 1 }] }]
      }, /cannot delegate to itself/],
      ['invalid address', {
        delegateVotes: [{ address: '0OIl', contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 1 }] }]
      }, /delegateVotes\[0\]\.address is not a valid base58/],
      ['invalid contract id', {
        delegateVotes: [{ address: bob.address, contracts: [{ contractId: 'bad id!', priority: 1 }] }]
      }, /contracts\[0\]\.contractId must be a Kalvora mint ID/],
      ['priority above int32', {
        delegateVotes: [{ address: bob.address, contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: DELEGATE_PRIORITY_MAX + 1 }] }]
      }, /priority must be an integer between/],
      ['priority below int32', {
        delegateVotes: [{ address: bob.address, contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: DELEGATE_PRIORITY_MIN - 1 }] }]
      }, /priority must be an integer between/],
      ['fractional priority', {
        delegateVotes: [{ address: bob.address, contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 1.5 }] }]
      }, /priority must be an integer between/],
      ['duplicate fee contract', {
        delegateFees: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', authAmount: '1' }, { contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', authAmount: '2' }]
      }, /delegateFees\[1\]\.contractId "KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao" is listed more than once/],
      ['zero fee authAmount', { delegateFees: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', authAmount: '0' }] }, /authAmount must be greater than zero/],
      ['decimal fee authAmount', { delegateFees: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', authAmount: '0.5' }] }, /authAmount must be a non-negative integer/],
      ['non-array delegateFees', { delegateFees: {} as unknown as [] }, /delegateFees must be an array/]
    ])('rejects %s', async (_label, overrides, pattern) => {
      await expect(buildDelegatedTXN(baseInput(overrides), OPTIONS)).rejects.toThrow(pattern);
    });
  });
});

describe('createDelegatedTXN / sendDelegatedTXN', () => {
  it('signs and hashes the transaction', async () => {
    const txn = await createDelegatedTXN(baseInput(), alice.privateKey, OPTIONS);
    expect(txn.base?.signature).toBeInstanceOf(Uint8Array);
    expect(txn.base?.signature?.length).toBeGreaterThan(0);
    expect(txn.base?.hash).toBeInstanceOf(Uint8Array);
    expect(txn.base?.hash?.length).toBeGreaterThan(0);

    const decoded = fromBinary(DelegatedTXNSchema, toBinary(DelegatedTXNSchema, txn));
    expect(decoded.base?.signature).toEqual(txn.base?.signature);
    expect(decoded.base?.hash).toEqual(txn.base?.hash);
  });

  it('requires a private key', async () => {
    await expect(createDelegatedTXN(baseInput(), '', OPTIONS)).rejects.toThrow(/privateKey is required/);
  });

  it('refuses to submit an unsigned transaction', async () => {
    const txn = await buildDelegatedTXN(baseInput(), OPTIONS);
    await expect(sendDelegatedTXN(txn)).rejects.toThrow(/must be signed/);
  });
});
