import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { TokenFeeInfoSchema } from '../../../../proto/generated/kal_api_pb.js';
import { CoinTXNSchema, CONTRACT_FEE_TYPE, SmartContractExecuteTXNSchema } from '../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../network/constants.js';
import type { TokenInfo } from '../../utils/token-info.js';
import { UniversalFeeCalculator } from '../universal-fee-calculator.js';

const SOURCE = KALVORA_NATIVE_TOKEN;
const PAYMENT = 'PREDNmAbR9Juj233WUQ6kqFGf28oe5kVAK5Y3mhGfE6cVBF95';

interface QuoteOptions {
  type?: CONTRACT_FEE_TYPE;
  allowed?: string[];
  amount?: string;
  fraction?: string;
  payment?: string;
  sourceRate?: string;
  paymentRate?: string;
  sourceDenomination?: string;
  paymentDenomination?: string;
  overestimatePercent?: number;
}

async function quote(options: QuoteOptions = {}): Promise<string | undefined> {
  const payment = options.payment ?? SOURCE;
  const txn = create(CoinTXNSchema, {
    base: { feeAmount: '1', feeId: SOURCE },
    contractId: SOURCE,
    outputTransfers: [{ amount: options.amount ?? '1' }]
  });
  const tokens = new Map<string, TokenInfo>([
    [SOURCE, create(TokenFeeInfoSchema, {
      contractId: SOURCE,
      denomination: options.sourceDenomination ?? '1000000000',
      rate: options.sourceRate ?? '1000000000000000000',
      authorized: true,
      contractFees: {
        contractFeeType: options.type ?? CONTRACT_FEE_TYPE.PERCENTAGE,
        fee: options.fraction ?? '10000000000000000',
        allowedFeeInstrument: options.allowed ?? [SOURCE, PAYMENT]
      }
    })],
    [PAYMENT, create(TokenFeeInfoSchema, {
      contractId: PAYMENT,
      denomination: options.paymentDenomination ?? '1000000000',
      rate: options.paymentRate ?? '1000000000000000000',
      authorized: true
    })]
  ]);
  await UniversalFeeCalculator.calculateFee({
    protoObject: txn,
    tokenInfoMap: tokens,
    baseFeeId: SOURCE,
    baseFeeParts: '1',
    contractFeeId: payment,
    overestimatePercent: options.overestimatePercent ?? 0
  });
  return txn.contractFeeAmount;
}

describe('Coin percentage contract fee quotes', () => {
  it('charges at least one payment-token part for a positive fractional fee', async () => {
    expect(await quote()).toBe('1');
    expect(await quote({ payment: PAYMENT, sourceRate: '1', paymentRate: '1000000000000000000' })).toBe('1');
  });

  it('converts the full fractional source fee before rounding to payment parts', async () => {
    expect(await quote({
      payment: PAYMENT,
      fraction: '500000000000000000',
      sourceRate: '100000000000000000000',
      paymentRate: '1000000000000000000'
    })).toBe('50');
  });

  it('uses the exact denominations and rates in a single widened quotient', async () => {
    expect(await quote({
      amount: '2',
      payment: PAYMENT,
      fraction: '750000000000000000',
      sourceRate: '3000000000000000000',
      paymentRate: '2000000000000000000',
      sourceDenomination: '3',
      paymentDenomination: '7'
    })).toBe('5');
  });

  it('does not require a price when the percentage is paid in the transferred token', async () => {
    expect(await quote({ amount: '1000', sourceRate: '' })).toBe('10');
    expect(await quote({ amount: '1000', sourceRate: '0' })).toBe('10');
  });

  it('keeps uint256-sized amounts exact and emits decimal parts', async () => {
    const amount = (1n << 256n) - 1n;
    expect(await quote({ amount: amount.toString(), fraction: '10000000000000000' }))
      .toBe((amount / 100n).toString());
    const expected = (amount / 100n) * 105n / 100n;
    expect(await quote({ amount: amount.toString(), fraction: '10000000000000000', overestimatePercent: 5 }))
      .toBe(expected.toString());
  });

  it('does not add a floor to a zero transfer or zero fraction', async () => {
    expect(await quote({ amount: '0' })).toBe('0');
    expect(await quote({ fraction: '0' })).toBe('0');
  });

  it('quotes each small transaction separately when a transfer is split', async () => {
    expect(BigInt((await quote({ amount: '1' }))!) * 2n).toBe(2n);
    expect(await quote({ amount: '2' })).toBe('1');
  });

  it('rejects a missing cross-token price and fees outside uint256', async () => {
    await expect(quote({ payment: PAYMENT, paymentRate: '0' })).rejects.toThrow('payment exchange rate must be greater than zero');
    await expect(quote({ amount: ((1n << 256n) - 1n).toString(), fraction: '2000000000000000000' }))
      .rejects.toThrow('Percentage contract fee must fit in uint256');
    await expect(quote({ amount: ((1n << 256n) - 1n).toString(), fraction: '1000000000000000000', overestimatePercent: 5 }))
      .rejects.toThrow('Percentage contract fee cap must fit in uint256');
  });
});

describe('Coin fixed and currency-equivalent contract fees', () => {
  it('denominates a fixed fee in the first allowed asset with exact integer conversion', async () => {
    const rules = { type: CONTRACT_FEE_TYPE.FIXED, allowed: [PAYMENT, SOURCE], fraction: '20',
      sourceRate: '2', sourceDenomination: '3', paymentRate: '5', paymentDenomination: '7' };
    expect(await quote(rules)).toBe('21');
    expect(await quote({ ...rules, payment: PAYMENT, paymentRate: '' })).toBe('20');
    expect(await quote({ ...rules, allowed: ['ANY', SOURCE, PAYMENT], payment: PAYMENT })).toBe('18');
  });

  it('rejects disallowed payments and a positive fee that converts below one part', async () => {
    await expect(quote({ type: CONTRACT_FEE_TYPE.FIXED, allowed: [SOURCE], payment: PAYMENT })).rejects.toThrow('not allowed');
    await expect(quote({ type: CONTRACT_FEE_TYPE.CUR_EQUIVALENT, fraction: '1' })).rejects.toThrow('cannot be paid');
    expect(await quote({ type: CONTRACT_FEE_TYPE.CUR_EQUIVALENT, fraction: '0', sourceRate: '' })).toBe('0');
  });
});

it('rounds gas to the next fee-token part and adds it exactly to a large signed cap', async () => {
  const cap = 10n ** 64n;
  const token = create(TokenFeeInfoSchema, { contractId: PAYMENT, denomination: '7', rate: '2000000000000000000', authorized: true });
  const txn = create(SmartContractExecuteTXNSchema, { base: { feeId: PAYMENT } });
  await UniversalFeeCalculator.calculateFee({
    protoObject: txn, tokenInfoMap: new Map([[PAYMENT, token]]), baseFeeId: PAYMENT, baseFeeParts: cap.toString(),
    gasFeeInUsd: 0.4, nonNativeMultiplier: 3
  });
  expect(txn.base?.feeAmount).toBe((cap + 5n).toString());
});
