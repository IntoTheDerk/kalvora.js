import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { SmartContractAllowanceSchema } from '../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../shared/network/constants.js';
import { buildSmartContractAllowances, type SmartContractAllowanceInput } from '../allowances.js';

describe('smart-contract outflow allowances', () => {
  it('leaves omitted and empty lists with zero caller-wallet spending permission', () => {
    expect(buildSmartContractAllowances(undefined)).toEqual([]);
    expect(buildSmartContractAllowances([])).toEqual([]);
  });

  it.each(['0', '123', ((1n << 256n) - 1n).toString(), 'unlimited'])(
    'encodes the signed token budget %s using allowed_amount only', allowedAmount => {
      const [allowance] = buildSmartContractAllowances([{ contractId: KALVORA_NATIVE_TOKEN, allowedAmount }]);
      expect(allowance).toBeDefined();
      const bytes = toBinary(SmartContractAllowanceSchema, allowance!);
      const decoded = fromBinary(SmartContractAllowanceSchema, bytes);
      expect(decoded.contractId).toBe(KALVORA_NATIVE_TOKEN);
      expect(decoded.allowedAmount).toBe(allowedAmount);
      expect('unlimited' in decoded).toBe(false);
    }
  );

  it.each([undefined, '', '-1', '1.5', '1e9', 'Unlimited', 'UNLIMITED', ' unlimited', 'unlimited ',
    (1n << 256n).toString(), true, 123])('rejects invalid budget %s', allowedAmount => {
    expect(() => buildSmartContractAllowances([
      { contractId: KALVORA_NATIVE_TOKEN, allowedAmount } as SmartContractAllowanceInput
    ])).toThrow(/allowedAmount/u);
  });

  it.each([true, false])('rejects retired unlimited boolean %s', unlimited => {
    expect(() => buildSmartContractAllowances([
      { contractId: KALVORA_NATIVE_TOKEN, allowedAmount: '1', unlimited } as SmartContractAllowanceInput
    ])).toThrow(/unlimited is retired/u);
  });

  it('rejects invalid token IDs and duplicate token entries', () => {
    expect(() => buildSmartContractAllowances([{ contractId: 'KAL', allowedAmount: '1' }]))
      .toThrow(/contractId/u);
    expect(() => buildSmartContractAllowances([
      { contractId: KALVORA_NATIVE_TOKEN, allowedAmount: '1' },
      { contractId: KALVORA_NATIVE_TOKEN, allowedAmount: 'unlimited' }
    ])).toThrow(/must be unique/u);
  });

  it('rejects malformed lists and entries', () => {
    expect(() => buildSmartContractAllowances({} as SmartContractAllowanceInput[])).toThrow(/array/u);
    expect(() => buildSmartContractAllowances([null as unknown as SmartContractAllowanceInput])).toThrow(/object/u);
  });
});
