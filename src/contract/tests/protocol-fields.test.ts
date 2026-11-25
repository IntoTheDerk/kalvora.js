import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { GovernanceSchema, GOVERNANCE_TYPE, RestrictedKeySchema } from '../../../proto/generated/txn_pb.js';
import { convertPercentToThreshold, validateCurrentContractFields } from '../shared/utils.js';

describe('clean-genesis contract fields', () => {
  it('rejects the retired quash threshold instead of silently dropping it', () => {
    expect(() => validateCurrentContractFields({ quashThreshold: 3 } as Parameters<typeof validateCurrentContractFields>[0]))
      .toThrow('quashThreshold is retired');
  });

  it.each([
    ['timeDelay', 0n],
    ['global', false],
    ['quash', false]
  ])('rejects retired restricted-key field %s even at its default value', (field, value) => {
    const key = { ...create(RestrictedKeySchema), [field]: value };
    expect(() => validateCurrentContractFields({ restrictedKeys: [key] }))
      .toThrow(`restrictedKeys.${field} is retired`);
  });

  it('accepts the current permission fields', () => {
    expect(() => validateCurrentContractFields({
      restrictedKeys: [create(RestrictedKeySchema, { publicKey: { walletAddress: new Uint8Array(128) }, updateContract: true, mint: true })]
    })).not.toThrow();
  });

  it('requires one parent and a local recovery authority when inheriting', () => {
    const parent = create(RestrictedKeySchema, { publicKey: { parentContract: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' }, updateContract: true });
    const recovery = create(RestrictedKeySchema, { publicKey: { walletAddress: new Uint8Array(64) }, updateContract: true });
    expect(() => validateCurrentContractFields({ restrictedKeys: [parent] })).toThrow('direct update_contract');
    expect(() => validateCurrentContractFields({ restrictedKeys: [parent, parent, recovery] })).toThrow('one parent');
    expect(() => validateCurrentContractFields({ restrictedKeys: [parent, recovery] })).not.toThrow();
  });

  it('rejects governance removal while consensus disables it', () => {
    expect(() => validateCurrentContractFields({
      governance: create(GovernanceSchema, { type: GOVERNANCE_TYPE.REMOVE })
    })).toThrow('Governance REMOVE is disabled');
  });
});

describe('governance participation threshold', () => {
  it.each([[0, 0], [0.25, 25], [20.5, 2050], [100, 10000]])('converts %s percent to %s basis points', (percent, expected) => {
    expect(convertPercentToThreshold(percent)).toBe(expected);
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid percentage %s', percent => {
    expect(() => convertPercentToThreshold(percent)).toThrow('Percent must be between 0 and 100');
  });
});
