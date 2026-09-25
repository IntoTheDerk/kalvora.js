/**
 * Standard transaction pipeline tests (`src/shared/tx/standard.ts`).
 *
 * Builds are fully offline (explicit `nonce` + `feeAmountParts`). The global
 * ConnectRPC mock is lifted so signed submission can be exercised against an
 * in-memory router transport.
 */
import { create, toBinary } from '@bufbuild/protobuf';
import { createRouterTransport, type ServiceImpl } from '@connectrpc/connect';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import { QuashTXNSchema, TXNService, type QuashTXN } from '../../../../proto/generated/txn_pb.js';
import { signWithKey } from '../../../sign/finalize.js';
import { ED25519_TEST_KEYS } from '../../../test-utils/keys.test.js';
import { getPublicKeyBytes } from '../../crypto/address-utils.js';
import { KALVORA_MINT_ID_ERROR, KALVORA_NATIVE_TOKEN } from '../../network/constants.js';
import { bytesToHex } from '../../utils/byte-utils.js';
import {
  buildStandardTransaction,
  parseAddress,
  parseHash32,
  parsePartsAmount,
  parseUint64,
  requireContractId,
  resolveNonce,
  submitStandardTransaction,
  toTimestampInit,
  type StandardTXNOptions
} from '../standard.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const { alice, bob } = ED25519_TEST_KEYS;
const HASH_HEX = 'ab'.repeat(32);
const TIMESTAMP = new Date('2026-07-25T09:22:00.123Z');
const OFFLINE: StandardTXNOptions = { nonce: 42, feeAmountParts: '500', timestamp: TIMESTAMP };
const U64_MAX = 0xFFFF_FFFF_FFFF_FFFFn;

function buildQuash(options: StandardTXNOptions = OFFLINE, publicKeyId: string = alice.publicKey): Promise<QuashTXN> {
  return buildStandardTransaction({
    operation: 'buildQuashTXN',
    schema: QuashTXNSchema,
    publicKeyId,
    contractId: KALVORA_NATIVE_TOKEN,
    fields: { contractId: KALVORA_NATIVE_TOKEN, txnHash: parseHash32(HASH_HEX, 'txnHash') },
    options
  });
}

// ----------------------------------------------------------------------------
// parse helpers
// ----------------------------------------------------------------------------

describe('requireContractId', () => {
  it.each([KALVORA_NATIVE_TOKEN, 'USDX0001', 'a', 'solana:EPjF.x-y/z+1', '$sol-USDC'])('accepts %s', value => {
    expect(requireContractId(value)).toBe(value);
  });

  it.each([
    ['', 'empty'],
    [' KALX', 'leading space'],
    ['KALX ', 'trailing space'],
    ['bad id', 'inner space'],
    ['-leading', 'leading dash'],
    ['A'.repeat(1000), 'oversized'],
    [42, 'number'],
    [undefined, 'undefined'],
    [null, 'null']
  ])('rejects %j (%s) with a field-specific message', value => {
    expect(() => requireContractId(value)).toThrow(`contractId must be ${KALVORA_MINT_ID_ERROR}`);
    expect(() => requireContractId(value, 'feeId')).toThrow(/^feeId must be /u);
  });
});

describe('parseAddress', () => {
  it('decodes base58 addresses (trimming whitespace)', () => {
    expect(parseAddress(bob.address)).toEqual(bs58.decode(bob.address));
    expect(parseAddress(`  ${bob.address} `)).toEqual(bs58.decode(bob.address));
    expect(parseAddress(bob.address)).toBeInstanceOf(Uint8Array);
  });

  it.each(['', '   ', undefined, 7, null])('rejects empty / non-string %j', value => {
    expect(() => parseAddress(value, 'recipient')).toThrow('recipient must be a non-empty base58 address');
  });

  it('rejects non-base58 characters', () => {
    expect(() => parseAddress('0OIl')).toThrow(/^address is not a valid base58 address: /u);
  });
});

describe('parseHash32', () => {
  it('parses 64 hex chars with or without 0x, any case', () => {
    const expected = new Uint8Array(32).fill(0xab);
    expect(parseHash32(HASH_HEX)).toEqual(expected);
    expect(parseHash32(`0x${HASH_HEX}`)).toEqual(expected);
    expect(parseHash32(HASH_HEX.toUpperCase())).toEqual(expected);
    const mixed = `00ff${'1A'.repeat(30)}`;
    const bytes = parseHash32(mixed);
    expect(bytes.length).toBe(32);
    expect(bytes[0]).toBe(0x00);
    expect(bytes[1]).toBe(0xff);
    expect(bytes[2]).toBe(0x1a);
  });

  it.each([
    ['', 'empty'],
    ['ab'.repeat(31), '31 bytes'],
    ['ab'.repeat(33), '33 bytes'],
    [`0X${HASH_HEX}`, 'upper-case 0X prefix'],
    [`${'ab'.repeat(31)}zz`, 'non-hex'],
    [` ${HASH_HEX}`, 'whitespace'],
    [new Uint8Array(32), 'bytes'],
    [undefined, 'undefined']
  ])('rejects %j (%s)', value => {
    expect(() => parseHash32(value, 'txnHash')).toThrow('txnHash must be a 32-byte hex string');
  });
});

describe('parsePartsAmount', () => {
  it.each([
    [1n, '1'],
    [12345678901234567890123n, '12345678901234567890123'],
    [42, '42'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'],
    ['7', '7'],
    [' 99 ', '99'],
    ['0007', '7'],
    ['340282366920938463463374607431768211456', '340282366920938463463374607431768211456']
  ])('canonicalises %s → %s', (input, expected) => {
    expect(parsePartsAmount(input)).toBe(expected);
  });

  it('rejects zero unless allowZero', () => {
    expect(() => parsePartsAmount(0)).toThrow('amount must be greater than zero');
    expect(() => parsePartsAmount('0', 'fee')).toThrow('fee must be greater than zero');
    expect(() => parsePartsAmount(0n)).toThrow('amount must be greater than zero');
    expect(parsePartsAmount(0, 'x', true)).toBe('0');
    expect(parsePartsAmount('000', 'x', true)).toBe('0');
    expect(parsePartsAmount(0n, 'x', true)).toBe('0');
  });

  it('rejects negative bigint / number values', () => {
    expect(() => parsePartsAmount(-1n)).toThrow('amount must be greater than zero');
    expect(() => parsePartsAmount(-5)).toThrow('amount must be greater than zero');
    expect(() => parsePartsAmount(-1n, 'amount', true)).toThrow('amount must be non-negative');
  });

  it.each([
    ['-5'],
    ['+5'],
    ['1.5'],
    [1.5],
    ['1e3'],
    [''],
    ['   '],
    ['abc'],
    ['0x10'],
    [Number.MAX_SAFE_INTEGER + 1],
    [2 ** 64],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [undefined],
    [null],
    [{}]
  ])('rejects non-integer / unsafe %s', value => {
    expect(() => parsePartsAmount(value, 'amount')).toThrow('amount must be a non-negative integer amount in smallest units');
  });
});

describe('parseUint64', () => {
  it.each([
    [0, 0n],
    [0n, 0n],
    ['0', 0n],
    [' 17 ', 17n],
    [Number.MAX_SAFE_INTEGER, 9007199254740991n],
    [U64_MAX, U64_MAX],
    ['18446744073709551615', U64_MAX]
  ])('accepts %s', (input, expected) => {
    expect(parseUint64(input)).toBe(expected);
  });

  it.each([
    [U64_MAX + 1n],
    ['18446744073709551616'],
    [-1n],
    [-1],
    ['-1'],
    ['1.5'],
    [1.5],
    [Number.MAX_SAFE_INTEGER + 1],
    [''],
    ['abc'],
    [undefined],
    [null]
  ])('rejects %s', value => {
    expect(() => parseUint64(value, 'nonce')).toThrow('nonce must be an unsigned 64-bit integer');
  });
});

describe('toTimestampInit', () => {
  it('splits milliseconds into seconds + nanos', () => {
    expect(toTimestampInit(new Date(0))).toEqual({ seconds: 0n, nanos: 0 });
    expect(toTimestampInit(new Date(1500))).toEqual({ seconds: 1n, nanos: 500_000_000 });
    expect(toTimestampInit(TIMESTAMP)).toEqual({ seconds: BigInt(Math.floor(TIMESTAMP.getTime() / 1000)), nanos: 123_000_000 });
  });

  it('keeps nanos non-negative before the epoch', () => {
    expect(toTimestampInit(new Date(-1500))).toEqual({ seconds: -2n, nanos: 500_000_000 });
    expect(toTimestampInit(new Date(-1000))).toEqual({ seconds: -1n, nanos: 0 });
  });

  it('accepts the protobuf range bounds 0001-01-01 … 9999-12-31', () => {
    const min = new Date('0001-01-01T00:00:00.000Z');
    const max = new Date('9999-12-31T23:59:59.999Z');
    expect(toTimestampInit(min)).toEqual({ seconds: -62135596800n, nanos: 0 });
    expect(toTimestampInit(max)).toEqual({ seconds: 253402300799n, nanos: 999_000_000 });
  });

  it.each([
    [new Date(Date.parse('0001-01-01T00:00:00.000Z') - 1), 'before 0001'],
    [new Date(Date.parse('9999-12-31T23:59:59.999Z') + 1), 'after 9999'],
    [new Date(Number.NaN), 'invalid date'],
    [1_700_000_000_000 as unknown as Date, 'number'],
    ['2026-01-01' as unknown as Date, 'string']
  ])('rejects %s (%s)', (value, _label) => {
    expect(() => toTimestampInit(value, 'since')).toThrow('since must be a valid Date between years 0001 and 9999');
  });
});

// ----------------------------------------------------------------------------
// resolveNonce
// ----------------------------------------------------------------------------

describe('resolveNonce', () => {
  it('uses an explicit nonce without touching the network', async () => {
    const transport = createRouterTransport(() => { /* no services: any RPC would fail */ });
    expect(await resolveNonce('op', alice.publicKey, { nonce: 5, grpcConfig: { transport } })).toBe(5n);
    expect(await resolveNonce('op', alice.publicKey, { nonce: '18446744073709551615' })).toBe(U64_MAX);
    expect(await resolveNonce('op', alice.publicKey, { nonce: 0n })).toBe(0n);
  });

  it('validates an explicit nonce', async () => {
    await expect(resolveNonce('op', alice.publicKey, { nonce: -1 })).rejects.toThrow('nonce must be an unsigned 64-bit integer');
    await expect(resolveNonce('op', alice.publicKey, { nonce: '1.5' })).rejects.toThrow('nonce must be an unsigned 64-bit integer');
  });
});

// ----------------------------------------------------------------------------
// buildStandardTransaction
// ----------------------------------------------------------------------------

describe('buildStandardTransaction', () => {
  it('builds an unsigned message with the base envelope populated', async () => {
    const txn = await buildQuash();
    expect(txn.$typeName).toBe('zera_txn.QuashTXN');
    expect(txn.contractId).toBe(KALVORA_NATIVE_TOKEN);
    expect(txn.txnHash).toEqual(new Uint8Array(32).fill(0xab));
    const base = txn.base!;
    expect(base.nonce).toBe(42n);
    expect(base.feeAmount).toBe('500');
    expect(base.feeId).toBe(KALVORA_NATIVE_TOKEN);
    expect(base.publicKey?.single).toEqual(new Uint8Array(getPublicKeyBytes(alice.publicKey)));
    expect(base.timestamp?.seconds).toBe(BigInt(Math.floor(TIMESTAMP.getTime() / 1000)));
    expect(base.timestamp?.nanos).toBe(123_000_000);
    expect(base.memo).toBeUndefined();
    expect(base.safeSend).toBeUndefined();
    expect(base.signature).toBeUndefined();
    expect(base.hash).toBeUndefined();
    expect(base.interfaceFee).toBeUndefined();
    expect(base.interfaceFeeId).toBeUndefined();
    expect(base.interfaceAddress).toBeUndefined();
  });

  it('is deterministic offline (identical bytes for identical inputs)', async () => {
    const a = toBinary(QuashTXNSchema, await buildQuash());
    const b = toBinary(QuashTXNSchema, await buildQuash());
    expect(a).toEqual(b);
    const otherNonce = toBinary(QuashTXNSchema, await buildQuash({ ...OFFLINE, nonce: 43 }));
    expect(otherNonce).not.toEqual(a);
    const otherKey = toBinary(QuashTXNSchema, await buildQuash(OFFLINE, bob.publicKey));
    expect(otherKey).not.toEqual(a);
  });

  it('maps memo, feeId and safeSend onto base', async () => {
    const txn = await buildQuash({ ...OFFLINE, memo: 'hello', feeId: 'USDX0001', safeSend: true });
    expect(txn.base?.memo).toBe('hello');
    expect(txn.base?.feeId).toBe('USDX0001');
    expect(txn.base?.safeSend).toBe(true);

    const noSafe = await buildQuash({ ...OFFLINE, safeSend: false });
    expect(noSafe.base?.safeSend).toBe(false);

    const blankMemo = await buildQuash({ ...OFFLINE, memo: '   ' });
    expect(blankMemo.base?.memo).toBeUndefined();
  });

  it('accepts a bigint / string nonce', async () => {
    expect((await buildQuash({ ...OFFLINE, nonce: U64_MAX })).base?.nonce).toBe(U64_MAX);
    expect((await buildQuash({ ...OFFLINE, nonce: '7' })).base?.nonce).toBe(7n);
  });

  it.each([
    ['', 'publicKey identifier is required'],
    ['   ', 'publicKey identifier is required'],
    [undefined, 'publicKey identifier is required'],
    ['not-a-key', 'publicKey is not a valid Kalvora public key identifier'],
    ['A_', 'publicKey is not a valid Kalvora public key identifier'],
    ['A_0OIl', 'publicKey is not a valid Kalvora public key identifier']
  ])('rejects publicKey %j', async (publicKeyId, message) => {
    await expect(buildStandardTransaction({
      operation: 'buildQuashTXN',
      schema: QuashTXNSchema,
      publicKeyId: publicKeyId as string,
      fields: { contractId: KALVORA_NATIVE_TOKEN },
      options: OFFLINE
    })).rejects.toThrow(message);
  });

  it.each(['bad id', '', ' KALX'])('rejects invalid feeId %j', async feeId => {
    await expect(buildQuash({ ...OFFLINE, feeId })).rejects.toThrow(`feeId must be ${KALVORA_MINT_ID_ERROR}`);
  });

  it.each([
    ['', /feeAmountParts must be a non-negative integer amount/],
    ['abc', /feeAmountParts must be a non-negative integer amount/],
    ['1.5', /feeAmountParts must be a non-negative integer amount/],
    ['-1', /feeAmountParts must be a non-negative integer amount/],
    ['0', /feeAmountParts must be greater than zero/]
  ])('rejects feeAmountParts %j', async (feeAmountParts, message) => {
    await expect(buildQuash({ ...OFFLINE, feeAmountParts })).rejects.toThrow(message);
  });

  // Regression: previously fixed bug (see CHANGELOG 1.0.0).
  it.each([
    [' 5 ', '5'],
    ['007', '7']
  ])('canonicalises accepted feeAmountParts %j to %j on the wire', async (feeAmountParts, expected) => {
    const txn = await buildQuash({ ...OFFLINE, feeAmountParts });
    expect(txn.base?.feeAmount).toBe(expected);
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])('rejects overestimatePercent %s', async overestimatePercent => {
    await expect(buildQuash({ ...OFFLINE, overestimatePercent }))
      .rejects.toThrow('overestimatePercent must be a finite, non-negative number');
  });

  it('accepts overestimatePercent 0 when the fee is explicit', async () => {
    const txn = await buildQuash({ ...OFFLINE, overestimatePercent: 0 });
    expect(txn.base?.feeAmount).toBe('500');
  });

  it.each(['true', 1, null])('rejects non-boolean safeSend %j', async safeSend => {
    await expect(buildQuash({ ...OFFLINE, safeSend: safeSend as unknown as boolean }))
      .rejects.toThrow('safeSend must be a boolean');
  });

  it.each([
    [{ interfaceFeeId: KALVORA_NATIVE_TOKEN }],
    [{ interfaceFee: '0.25' }],
    [{ interfaceAddress: bob.address }],
    [{ interfaceFeeId: KALVORA_NATIVE_TOKEN, interfaceFee: '0.25' }],
    [{ interfaceFee: '0.25', interfaceAddress: bob.address }],
    [{ interfaceFeeId: KALVORA_NATIVE_TOKEN, interfaceAddress: bob.address }]
  ])('requires all three interface fee fields together: %j', async partial => {
    await expect(buildQuash({ ...OFFLINE, ...partial }))
      .rejects.toThrow('interfaceFeeId, interfaceFee, and interfaceAddress must be provided together');
  });

  it('validates interfaceFeeId when all three interface fields are present', async () => {
    await expect(buildQuash({ ...OFFLINE, interfaceFeeId: 'bad id', interfaceFee: '1', interfaceAddress: bob.address }))
      .rejects.toThrow(`interfaceFeeId must be ${KALVORA_MINT_ID_ERROR}`);
  });

  it('rejects an invalid explicit nonce before building', async () => {
    await expect(buildQuash({ ...OFFLINE, nonce: -3 })).rejects.toThrow('nonce must be an unsigned 64-bit integer');
    await expect(buildQuash({ ...OFFLINE, nonce: U64_MAX + 1n })).rejects.toThrow('nonce must be an unsigned 64-bit integer');
  });

  it('rejects an out-of-range timestamp', async () => {
    await expect(buildQuash({ ...OFFLINE, timestamp: new Date(Number.NaN) }))
      .rejects.toThrow('Base transaction timestamp must be a valid protobuf Date');
  });
});

// ----------------------------------------------------------------------------
// submitStandardTransaction
// ----------------------------------------------------------------------------

describe('submitStandardTransaction', () => {
  function txnTransport() {
    const quash = vi.fn((_req: QuashTXN) => ({}));
    const impl: Partial<ServiceImpl<typeof TXNService>> = { quash };
    const transport = createRouterTransport(({ service }) => { service(TXNService, impl); });
    return { transport, quash };
  }

  it('rejects an unsigned transaction without any network call', async () => {
    const { transport, quash } = txnTransport();
    const txn = await buildQuash();
    await expect(submitStandardTransaction(txn, { transport }))
      .rejects.toThrow('Transaction must be signed before submission (missing signature or hash)');

    const hashOnly = await buildQuash();
    hashOnly.base!.hash = new Uint8Array(32);
    await expect(submitStandardTransaction(hashOnly, { transport })).rejects.toThrow(/must be signed/);

    const sigOnly = await buildQuash();
    sigOnly.base!.signature = new Uint8Array(64);
    await expect(submitStandardTransaction(sigOnly, { transport })).rejects.toThrow(/must be signed/);

    const noBase = create(QuashTXNSchema, {});
    await expect(submitStandardTransaction(noBase, { transport })).rejects.toThrow(/must be signed/);

    expect(quash).not.toHaveBeenCalled();
  });

  it('submits a signed transaction and returns the hex hash', async () => {
    const { transport, quash } = txnTransport();
    const txn = signWithKey(await buildQuash(), alice.privateKey, alice.publicKey);
    const hash = await submitStandardTransaction(txn, { transport });
    expect(hash).toBe(bytesToHex(txn.base!.hash!));
    expect(quash).toHaveBeenCalledTimes(1);
    expect(quash.mock.calls[0]![0].base?.signature).toEqual(txn.base!.signature);
  });
});
