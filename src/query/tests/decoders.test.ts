/**
 * Unit tests for the pure query decoders (no network access).
 */
import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { TRANSACTION_TYPE, TXN_STATUS, TXNStatusFeesSchema } from '../../../proto/generated/txn_pb.js';
import { BlockSchema, type Block } from '../../../proto/generated/validator_pb.js';
import {
  USD_SCALE,
  decodeContractSupply,
  findTransactionResult,
  formatScaled,
  listBlockTransactions,
  parseUintString,
  partsToWhole,
  summarizeBlock,
  toTransactionResult
} from '../decoders.js';

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

/** 32-byte hash whose every byte is `fill`. */
function hash32(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function hex32(fill: number): string {
  return fill.toString(16).padStart(2, '0').repeat(32);
}

function asciiBytes(text: string): number[] {
  return Array.from(text, ch => ch.charCodeAt(0));
}

function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

/** Encode a length-delimited (wire type 2) string field. */
function stringField(field: number, text: string): number[] {
  const payload = asciiBytes(text);
  return [...encodeVarint(field * 8 + 2), ...encodeVarint(payload.length), ...payload];
}

/** Binary protobuf bytes → latin-1 string (how the node transports DatabaseResponse.value). */
function latin1(bytes: number[]): string {
  return String.fromCharCode(...bytes);
}

/** Synthetic block with several transaction types and result records. */
function makeBlock(): Block {
  return create(BlockSchema, {
    blockHeader: {
      version: 100_002n,
      blockHeight: 42n,
      hash: hash32(0xab),
      previousBlockHash: hash32(0xcd),
      timestamp: { seconds: 1_700_000_000n, nanos: 987_654_321 },
      nonce: 0n
    },
    transactions: {
      coinTxns: [{ base: { hash: hash32(0x01) } }, { base: { hash: hash32(0x02) } }],
      mintTxns: [{ base: { hash: hash32(0x03) } }],
      governanceVotes: [{ base: { hash: hash32(0x04) } }],
      smartContractExecutes: [{ base: { hash: hash32(0x05) } }],
      contractTxns: [{ base: { hash: hash32(0x06) }, symbol: 'TST' }],
      allowanceTxns: [{ base: { hash: hash32(0x07) } }],
      proposalCancelTxns: [{}], // no base → empty hash
      txnFeesAndStatus: [
        {
          txnHash: hash32(0x01),
          status: TXN_STATUS.OK,
          baseFees: '1500',
          baseContractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
        },
        {
          txnHash: hash32(0x05),
          status: TXN_STATUS.INSUFFICIENT_AMOUNT,
          baseFees: '',
          baseContractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
          contractFees: '25',
          contractContractId: 'KALother',
          gas: 12_345n
        }
      ]
    }
  });
}

// ----------------------------------------------------------------------------
// parseUintString
// ----------------------------------------------------------------------------

describe('parseUintString', () => {
  it('parses unsigned integers, trimming whitespace', () => {
    expect(parseUintString('0')).toBe(0n);
    expect(parseUintString('  42 ')).toBe(42n);
    expect(parseUintString('000123')).toBe(123n);
    expect(parseUintString('340282366920938463463374607431768211455')).toBe(2n ** 128n - 1n);
  });

  it('treats empty / whitespace-only strings (proto3 default) as 0n', () => {
    expect(parseUintString('')).toBe(0n);
    expect(parseUintString('   ')).toBe(0n);
  });

  it.each(['-1', '1.5', '1e3', '0x10', 'abc', '+1', '1 2', '１２'])('rejects %j', value => {
    expect(() => parseUintString(value, 'balance')).toThrow(`balance is not an unsigned integer: ${JSON.stringify(value)}`);
  });

  it('uses the default field name in errors', () => {
    expect(() => parseUintString('x')).toThrow('value is not an unsigned integer');
  });
});

// ----------------------------------------------------------------------------
// formatScaled
// ----------------------------------------------------------------------------

describe('formatScaled', () => {
  it('formats 1e18-scaled values without floating point', () => {
    expect(USD_SCALE).toBe(10n ** 18n);
    expect(formatScaled(0n)).toBe('0');
    expect(formatScaled(USD_SCALE)).toBe('1');
    expect(formatScaled(1_500_000_000_000_000_000n)).toBe('1.5');
    expect(formatScaled(1n)).toBe('0.000000000000000001');
    expect(formatScaled(123n * USD_SCALE + 45n * 10n ** 15n)).toBe('123.045');
    expect(formatScaled(10n ** 40n)).toBe(`1${'0'.repeat(22)}`);
  });

  it('truncates (does not round) to maxFractionDigits and trims trailing zeros', () => {
    expect(formatScaled(1_999_999_999_999_999_999n, 2)).toBe('1.99');
    expect(formatScaled(1_100_000_000_000_000_000n, 4)).toBe('1.1');
    expect(formatScaled(1_500_000_000_000_000_000n, 0)).toBe('1');
    expect(() => formatScaled(1_500_000_000_000_000_000n, -3)).toThrow(/maxFractionDigits/);
    expect(formatScaled(1n, 30)).toBe('0.000000000000000001');
  });

  it('formats negative values', () => {
    expect(formatScaled(-1_500_000_000_000_000_000n)).toBe('-1.5');
    expect(formatScaled(-USD_SCALE)).toBe('-1');
  });

  it('does not emit "-0" when a negative value truncates to zero', () => {
    expect(formatScaled(-1n, 2)).toBe('0');
  });
});

// ----------------------------------------------------------------------------
// partsToWhole
// ----------------------------------------------------------------------------

describe('partsToWhole', () => {
  it('denomination 1 returns the integer unchanged', () => {
    expect(partsToWhole(0n, 1n)).toBe('0');
    expect(partsToWhole(12345n, 1n)).toBe('12345');
  });

  it('denomination 10', () => {
    expect(partsToWhole(15n, 10n)).toBe('1.5');
    expect(partsToWhole(10n, 10n)).toBe('1');
    expect(partsToWhole(3n, 10n)).toBe('0.3');
  });

  it('denomination 1e9 (native token) with fractional trimming', () => {
    const d = 1_000_000_000n;
    expect(partsToWhole(1_500_000_000n, d)).toBe('1.5');
    expect(partsToWhole(1_000_000_000n, d)).toBe('1');
    expect(partsToWhole(1n, d)).toBe('0.000000001');
    expect(partsToWhole(1_000_000_010n, d)).toBe('1.00000001');
    expect(partsToWhole(0n, d)).toBe('0');
    expect(partsToWhole(123_456_789_000_000_000n, d)).toBe('123456789');
  });

  it('denomination 1e18', () => {
    expect(partsToWhole(2n * 10n ** 18n + 5n, 10n ** 18n)).toBe('2.000000000000000005');
  });

  it('rejects non-positive denominations', () => {
    expect(() => partsToWhole(1n, 0n)).toThrow('denomination must be positive');
    expect(() => partsToWhole(1n, -10n)).toThrow('denomination must be positive');
  });

  it('handles a non-power-of-10 denomination (125 parts of 250 = 0.5)', () => {
    expect(partsToWhole(125n, 250n)).toBe('0.5');
  });

  it('handles a non-power-of-10 denomination (1 part of 4 = 0.25)', () => {
    expect(partsToWhole(1n, 4n)).toBe('0.25');
  });

  it('formats negative parts', () => {
    expect(partsToWhole(-5n, 10n)).toBe('-0.5');
  });
});

// ----------------------------------------------------------------------------
// decodeContractSupply
// ----------------------------------------------------------------------------

describe('decodeContractSupply', () => {
  const record = [...stringField(1, '500000000000000000'), ...stringField(2, '220000000000000')];

  it('decodes a real binary record transported as latin-1', () => {
    expect(decodeContractSupply(latin1(record))).toEqual({
      maxSupply: 500_000_000_000_000_000n,
      currentSupply: 220_000_000_000_000n
    });
  });

  it('is independent of field order', () => {
    const swapped = [...stringField(2, '7'), ...stringField(1, '9')];
    expect(decodeContractSupply(latin1(swapped))).toEqual({ maxSupply: 9n, currentSupply: 7n });
  });

  it('treats missing fields and empty records as 0n', () => {
    expect(decodeContractSupply('')).toEqual({ maxSupply: 0n, currentSupply: 0n });
    expect(decodeContractSupply(latin1(stringField(2, '11')))).toEqual({ maxSupply: 0n, currentSupply: 11n });
  });

  it('decodes multi-byte varint lengths (bytes >= 0x80 in the latin-1 string)', () => {
    const big = '9'.repeat(200);
    const bytes = stringField(1, big);
    expect(bytes[1]).toBeGreaterThanOrEqual(0x80);
    expect(decodeContractSupply(latin1(bytes)).maxSupply).toBe(10n ** 200n - 1n);
  });

  it('rejects a truncated record', () => {
    expect(() => decodeContractSupply(latin1(record.slice(0, record.length - 3)))).toThrow('truncated contract supply record');
  });

  it('rejects a truncated varint', () => {
    expect(() => decodeContractSupply(latin1([0x0a, 0x80]))).toThrow('truncated varint');
    expect(() => decodeContractSupply(latin1([0x8a]))).toThrow('truncated varint');
  });

  it('rejects an over-long varint', () => {
    expect(() => decodeContractSupply(latin1([0x0a, ...new Array<number>(9).fill(0xff), 0x01]))).toThrow('varint too long');
  });

  it('rejects an unexpected wire type', () => {
    // field 1, wire type 0 (varint), value 5
    expect(() => decodeContractSupply(latin1([0x08, 0x05]))).toThrow('unexpected wire type 0 in contract supply record');
  });

  it('rejects non-latin-1 characters', () => {
    expect(() => decodeContractSupply(`${latin1(record)}Ā`)).toThrow('contract supply record is not binary protobuf');
    expect(() => decodeContractSupply('€')).toThrow('contract supply record is not binary protobuf');
  });

  it('rejects non-numeric field contents', () => {
    expect(() => decodeContractSupply(latin1(stringField(1, 'abc')))).toThrow('maxSupply is not an unsigned integer');
    expect(() => decodeContractSupply(latin1(stringField(2, '-1')))).toThrow('currentSupply is not an unsigned integer');
  });
});

// ----------------------------------------------------------------------------
// Blocks
// ----------------------------------------------------------------------------

describe('listBlockTransactions', () => {
  it('flattens every list in TXNS field order with types and hex hashes', () => {
    const txns = listBlockTransactions(makeBlock());
    expect(txns.map(t => [t.list, t.type, t.hash])).toEqual([
      ['coinTxns', TRANSACTION_TYPE.COIN_TYPE, hex32(0x01)],
      ['coinTxns', TRANSACTION_TYPE.COIN_TYPE, hex32(0x02)],
      ['mintTxns', TRANSACTION_TYPE.MINT_TYPE, hex32(0x03)],
      ['contractTxns', TRANSACTION_TYPE.CONTRACT_TXN_TYPE, hex32(0x06)],
      ['governanceVotes', TRANSACTION_TYPE.VOTE_TYPE, hex32(0x04)],
      ['smartContractExecutes', TRANSACTION_TYPE.SMART_CONTRACT_EXECUTE_TYPE, hex32(0x05)],
      ['allowanceTxns', TRANSACTION_TYPE.ALLOWANCE_TYPE, hex32(0x07)],
      ['proposalCancelTxns', TRANSACTION_TYPE.PROPOSAL_CANCEL_TYPE, '']
    ]);
    expect(txns[0]?.txn.$typeName).toBe('zera_txn.CoinTXN');
    expect(txns[3]?.txn.$typeName).toBe('zera_txn.InstrumentContract');
  });

  it('excludes result-only lists (txnFeesAndStatus, tokenFees)', () => {
    const block = create(BlockSchema, {
      transactions: {
        txnFeesAndStatus: [{ txnHash: hash32(1) }],
        tokenFees: [{}]
      }
    });
    expect(listBlockTransactions(block)).toEqual([]);
  });

  it('returns [] for a block without transactions', () => {
    expect(listBlockTransactions(create(BlockSchema, {}))).toEqual([]);
  });
});

describe('toTransactionResult', () => {
  it('maps an OK record without optional fields', () => {
    const raw = create(TXNStatusFeesSchema, {
      txnHash: hash32(0xee),
      status: TXN_STATUS.OK,
      baseFees: '1000',
      baseContractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
    });
    const result = toTransactionResult(raw);
    expect(result).toEqual({
      hash: hex32(0xee),
      status: TXN_STATUS.OK,
      statusName: 'OK',
      success: true,
      baseFees: 1000n,
      baseFeeContractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      raw
    });
    expect('contractFees' in result).toBe(false);
    expect('gas' in result).toBe(false);
  });

  it('maps a failed record with contract fees and gas', () => {
    const raw = create(TXNStatusFeesSchema, {
      txnHash: hash32(1),
      status: TXN_STATUS.INSUFFICIENT_AMOUNT,
      baseFees: '',
      contractFees: '25',
      contractContractId: 'KALother',
      gas: 7n
    });
    expect(toTransactionResult(raw)).toMatchObject({
      status: TXN_STATUS.INSUFFICIENT_AMOUNT,
      statusName: 'INSUFFICIENT_AMOUNT',
      success: false,
      baseFees: 0n,
      contractFees: 25n,
      contractFeeContractId: 'KALother',
      gas: 7n
    });
  });

  it('names unknown status codes', () => {
    const raw = create(TXNStatusFeesSchema, { txnHash: hash32(1), status: 9999 as TXN_STATUS });
    expect(toTransactionResult(raw).statusName).toBe('UNKNOWN_9999');
  });

  it('throws on a malformed fee string', () => {
    const raw = create(TXNStatusFeesSchema, { txnHash: hash32(1), baseFees: '1.5' });
    expect(() => toTransactionResult(raw)).toThrow('baseFees is not an unsigned integer');
  });
});

describe('findTransactionResult', () => {
  const block = makeBlock();

  it('finds a result by lower-case hex hash', () => {
    const result = findTransactionResult(block, hex32(0x05));
    expect(result?.gas).toBe(12_345n);
    expect(result?.statusName).toBe('INSUFFICIENT_AMOUNT');
  });

  it('accepts 0x/0X prefixes and upper-case hashes', () => {
    expect(findTransactionResult(block, `0x${hex32(0x01)}`)?.success).toBe(true);
    expect(findTransactionResult(block, `0X${hex32(0x01).toUpperCase()}`)?.baseFees).toBe(1500n);
    expect(findTransactionResult(block, hex32(0x05).toUpperCase())?.contractFees).toBe(25n);
  });

  it('returns undefined when the hash is absent or the block has no transactions', () => {
    expect(findTransactionResult(block, hex32(0x02))).toBeUndefined(); // tx present but no result record
    expect(findTransactionResult(block, hex32(0x99))).toBeUndefined();
    expect(findTransactionResult(create(BlockSchema, {}), hex32(0x01))).toBeUndefined();
  });
});

describe('summarizeBlock', () => {
  it('summarises header, counts per type and results', () => {
    const summary = summarizeBlock(makeBlock());
    expect(summary.height).toBe(42n);
    expect(summary.hash).toBe(hex32(0xab));
    expect(summary.previousHash).toBe(hex32(0xcd));
    expect(summary.version).toBe(100_002n);
    expect(summary.timestamp?.toISOString()).toBe(new Date(1_700_000_000_987).toISOString());
    expect(summary.transactionCount).toBe(8);
    expect(summary.transactionsByType).toEqual({
      COIN_TYPE: 2,
      MINT_TYPE: 1,
      CONTRACT_TXN_TYPE: 1,
      VOTE_TYPE: 1,
      SMART_CONTRACT_EXECUTE_TYPE: 1,
      ALLOWANCE_TYPE: 1,
      PROPOSAL_CANCEL_TYPE: 1
    });
    expect(summary.results.map(r => [r.hash, r.success])).toEqual([
      [hex32(0x01), true],
      [hex32(0x05), false]
    ]);
  });

  it('handles an empty (genesis-like) block', () => {
    expect(summarizeBlock(create(BlockSchema, {}))).toEqual({
      height: 0n,
      hash: '',
      previousHash: '',
      timestamp: undefined,
      version: undefined,
      transactionCount: 0,
      transactionsByType: {},
      results: []
    });
  });

  it('is JSON-serialisable after bigint replacement', () => {
    const json = JSON.stringify(summarizeBlock(makeBlock()), (key, value: unknown) =>
      key === 'raw' ? undefined : typeof value === 'bigint' ? value.toString() : value
    );
    expect(JSON.parse(json)).toMatchObject({ height: '42', transactionCount: 8 });
  });
});
