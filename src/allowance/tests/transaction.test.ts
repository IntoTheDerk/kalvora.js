import { fromBinary, toBinary } from '@bufbuild/protobuf';
import bs58 from 'bs58';

import { AllowanceTXNSchema } from '../../../proto/generated/txn_pb.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import {
  buildAllowanceTXN,
  buildRevokeAllowanceTXN,
  createAllowanceTXN,
  createRevokeAllowanceTXN,
  currencyEquivalentToUsd,
  sendAllowanceTXN,
  usdToCurrencyEquivalent,
  type AllowanceInput
} from '../index.js';

const { alice, bob } = ED25519_TEST_KEYS;
const OPTIONS = {
  nonce: 7,
  feeAmountParts: '100',
  timestamp: new Date('2026-07-25T09:22:00.000Z')
};
const START = new Date('2026-08-01T00:00:00.500Z');

function baseInput(overrides: Partial<AllowanceInput> = {}): AllowanceInput {
  return {
    publicKey: alice.publicKey,
    contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    walletAddress: bob.address,
    allowedAmount: '5000',
    startTime: START,
    ...overrides
  };
}

describe('usdToCurrencyEquivalent / currencyEquivalentToUsd', () => {
  it('converts USD decimal strings exactly', () => {
    expect(usdToCurrencyEquivalent('12.50')).toBe('12500000000000000000');
    expect(usdToCurrencyEquivalent('1')).toBe('1000000000000000000');
    expect(usdToCurrencyEquivalent('0.000000000000000001')).toBe('1');
    expect(usdToCurrencyEquivalent('0.1')).toBe('100000000000000000');
    expect(usdToCurrencyEquivalent('123456789.123456789123456789')).toBe('123456789123456789123456789');
  });

  it('rejects malformed or over-precise input', () => {
    expect(() => usdToCurrencyEquivalent('-1')).toThrow(/non-negative decimal/);
    expect(() => usdToCurrencyEquivalent('1e3')).toThrow(/non-negative decimal/);
    expect(() => usdToCurrencyEquivalent('$5')).toThrow(/non-negative decimal/);
    expect(() => usdToCurrencyEquivalent('0.0000000000000000001')).toThrow(/at most 18/);
    expect(() => usdToCurrencyEquivalent(12.5 as unknown as string)).toThrow(/decimal string/);
  });

  it('converts back to USD', () => {
    expect(currencyEquivalentToUsd('12500000000000000000')).toBe('12.50');
    expect(currencyEquivalentToUsd(10n ** 18n)).toBe('1.00');
    expect(currencyEquivalentToUsd('1')).toBe('0.000000000000000001');
  });
});

describe('buildAllowanceTXN', () => {
  it('maps an amount-capped, monthly allowance', async () => {
    const txn = await buildAllowanceTXN(baseInput({ periodMonths: 1 }), OPTIONS);

    expect(txn.$typeName).toBe('zera_txn.AllowanceTXN');
    expect(txn.contractId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(bs58.encode(txn.walletAddress)).toBe(bob.address);
    expect(txn.allowedAmount).toBe('5000');
    expect(txn.allowedCurrencyEquivalent).toBeUndefined();
    expect(txn.periodMonths).toBe(1);
    expect(txn.periodSeconds).toBeUndefined();
    expect(txn.authorize).toBe(true);
    expect(txn.startTime?.seconds).toBe(BigInt(Math.floor(START.getTime() / 1000)));
    expect(txn.startTime?.nanos).toBe(500_000_000);
    expect(txn.base?.nonce).toBe(7n);
    expect(txn.base?.feeAmount).toBe('100');
    expect(txn.base?.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.hash).toBeUndefined();
  });

  it('maps a currency-equivalent cap with a seconds period', async () => {
    const txn = await buildAllowanceTXN(baseInput({
      allowedAmount: undefined,
      allowedCurrencyEquivalent: usdToCurrencyEquivalent('250.00'),
      periodSeconds: 86_400
    }), OPTIONS);

    expect(txn.allowedCurrencyEquivalent).toBe('250000000000000000000');
    expect(txn.allowedAmount).toBeUndefined();
    expect(txn.periodSeconds).toBe(86_400);
    expect(txn.periodMonths).toBeUndefined();
  });

  it('accepts bigint amounts and canonicalises them', async () => {
    const txn = await buildAllowanceTXN(baseInput({ allowedAmount: 42n }), OPTIONS);
    expect(txn.allowedAmount).toBe('42');
  });

  it('round-trips through binary encoding', async () => {
    const txn = await buildAllowanceTXN(baseInput({ periodSeconds: 60 }), OPTIONS);
    const decoded = fromBinary(AllowanceTXNSchema, toBinary(AllowanceTXNSchema, txn));
    expect(decoded.allowedAmount).toBe('5000');
    expect(decoded.periodSeconds).toBe(60);
    expect(decoded.periodMonths).toBeUndefined();
    expect(decoded.walletAddress).toEqual(txn.walletAddress);
    expect(decoded.startTime?.seconds).toBe(txn.startTime?.seconds);
    expect(decoded.authorize).toBe(true);
  });

  describe('validation', () => {
    it.each<[string, Partial<AllowanceInput>, RegExp]>([
      ['both cap kinds', { allowedCurrencyEquivalent: '1' }, /only one of allowedAmount or allowedCurrencyEquivalent/],
      ['no cap when authorizing', { allowedAmount: undefined }, /requires exactly one of allowedAmount/],
      ['both period kinds', { periodMonths: 1, periodSeconds: 60 }, /only one of periodMonths or periodSeconds/],
      ['zero period', { periodSeconds: 0 }, /periodSeconds must be a positive integer/],
      ['fractional period', { periodMonths: 1.5 }, /periodMonths must be a positive integer/],
      ['uint32 overflow period', { periodSeconds: 2 ** 32 }, /periodSeconds must be a positive integer/],
      ['missing startTime', { startTime: undefined }, /startTime is required/],
      ['invalid startTime', { startTime: new Date('nope') }, /startTime must be a valid Date/],
      ['zero amount', { allowedAmount: '0' }, /allowedAmount must be greater than zero/],
      ['decimal amount', { allowedAmount: '1.5' }, /allowedAmount must be a non-negative integer/],
      ['negative currency', { allowedAmount: undefined, allowedCurrencyEquivalent: '-5' }, /allowedCurrencyEquivalent must be/],
      ['bad contract', { contractId: 'bad id!' }, /contractId must be a Kalvora mint ID/],
      ['bad address', { walletAddress: '0OIl' }, /walletAddress is not a valid base58 address/],
      ['empty address', { walletAddress: '' }, /walletAddress must be a non-empty/],
      ['self allowance', { walletAddress: alice.address }, /cannot grant an allowance to itself/],
      ['non-boolean authorize', { authorize: 'yes' as unknown as boolean }, /authorize must be a boolean/]
    ])('rejects %s', async (_label, overrides, pattern) => {
      await expect(buildAllowanceTXN(baseInput(overrides), OPTIONS)).rejects.toThrow(pattern);
    });

    it('rejects a missing public key', async () => {
      await expect(buildAllowanceTXN(baseInput({ publicKey: '' }), OPTIONS)).rejects.toThrow(/publicKey identifier is required/);
    });
  });
});

describe('de-authorization', () => {
  it('buildAllowanceTXN with authorize:false needs no cap and defaults startTime to the base timestamp', async () => {
    const txn = await buildAllowanceTXN({
      publicKey: alice.publicKey,
      contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      walletAddress: bob.address,
      authorize: false
    }, OPTIONS);

    expect(txn.authorize).toBe(false);
    expect(txn.allowedAmount).toBeUndefined();
    expect(txn.allowedCurrencyEquivalent).toBeUndefined();
    expect(txn.startTime?.seconds).toBe(txn.base?.timestamp?.seconds);
  });

  it('buildRevokeAllowanceTXN produces authorize=false and survives binary round-trip', async () => {
    const txn = await buildRevokeAllowanceTXN({
      publicKey: alice.publicKey,
      contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      walletAddress: bob.address
    }, OPTIONS);
    const decoded = fromBinary(AllowanceTXNSchema, toBinary(AllowanceTXNSchema, txn));
    expect(decoded.authorize).toBe(false);
    expect(decoded.allowedAmount).toBeUndefined();
  });

  it('still rejects both cap kinds when de-authorizing', async () => {
    await expect(buildAllowanceTXN(baseInput({ authorize: false, allowedCurrencyEquivalent: '1' }), OPTIONS))
      .rejects.toThrow(/only one of allowedAmount/);
  });

  it('createRevokeAllowanceTXN signs the revocation', async () => {
    const txn = await createRevokeAllowanceTXN({
      publicKey: alice.publicKey,
      contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      walletAddress: bob.address
    }, alice.privateKey, OPTIONS);
    expect(txn.authorize).toBe(false);
    expect(txn.base?.signature).toBeInstanceOf(Uint8Array);
    expect(txn.base?.hash).toBeInstanceOf(Uint8Array);
  });
});

describe('createAllowanceTXN / sendAllowanceTXN', () => {
  it('signs and hashes the transaction deterministically', async () => {
    const a = await createAllowanceTXN(baseInput(), alice.privateKey, OPTIONS);
    const b = await createAllowanceTXN(baseInput(), alice.privateKey, OPTIONS);

    expect(a.base?.signature).toBeInstanceOf(Uint8Array);
    expect(a.base?.signature?.length).toBeGreaterThan(0);
    expect(a.base?.hash).toBeInstanceOf(Uint8Array);
    expect(a.base?.hash?.length).toBe(32);
    expect(a.base?.hash).toEqual(b.base?.hash);

    const decoded = fromBinary(AllowanceTXNSchema, toBinary(AllowanceTXNSchema, a));
    expect(decoded.base?.signature).toEqual(a.base?.signature);
    expect(decoded.base?.hash).toEqual(a.base?.hash);
  });

  it('requires a private key', async () => {
    await expect(createAllowanceTXN(baseInput(), '', OPTIONS)).rejects.toThrow(/privateKey is required/);
  });

  it('refuses to submit an unsigned transaction', async () => {
    const txn = await buildAllowanceTXN(baseInput(), OPTIONS);
    await expect(sendAllowanceTXN(txn)).rejects.toThrow(/must be signed/);
  });
});
