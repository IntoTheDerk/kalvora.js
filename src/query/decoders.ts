/**
 * Decoders and helpers for Kalvora query responses.
 *
 * Pure functions (no network access) that turn raw protobuf responses into
 * convenient, typed values. They are used by {@link KalvoraQueryClient} and
 * are exported for callers that fetch data through other channels (e.g. an
 * indexer that stores raw blocks).
 *
 * @module query/decoders
 */

import {
  TRANSACTION_TYPE,
  TXN_STATUS,
  type TXNS,
  type TXNStatusFees
} from '../../proto/generated/txn_pb.js';
import type { Block } from '../../proto/generated/validator_pb.js';
import { bytesToHex } from '../shared/utils/byte-utils.js';

// ============================================================================
// SCALED VALUES
// ============================================================================

/**
 * Fixed-point scale used by the network for USD rates, currency equivalents,
 * and fee percentages: `1_000_000_000_000_000_000` (1e18) represents
 * `$1.00` (or 100 %).
 */
export const USD_SCALE = 10n ** 18n;

/**
 * Parse a non-negative integer string returned by the node into a `bigint`.
 * Empty strings (proto3 defaults) parse as `0n`.
 *
 * @throws Error if the value is not an unsigned integer string
 */
export function parseUintString(value: string, field = 'value'): bigint {
  const trimmed = value.trim();
  if (trimmed === '') return 0n;
  if (!/^\d+$/u.test(trimmed)) {
    throw new Error(`${field} is not an unsigned integer: ${JSON.stringify(value)}`);
  }
  return BigInt(trimmed);
}

/**
 * Divide `numerator` by a positive `denominator` and render the exact quotient
 * as a decimal string, truncated (not rounded) to `maxFractionDigits`, with
 * trailing zeros removed and no negative zero.
 */
function formatQuotient(numerator: bigint, denominator: bigint, maxFractionDigits: number): string {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  if (!Number.isInteger(maxFractionDigits) || maxFractionDigits < 0) {
    throw new Error('maxFractionDigits must be a non-negative integer');
  }
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const whole = abs / denominator;
  let remainder = abs % denominator;
  let fraction = '';
  for (let i = 0; i < maxFractionDigits && remainder !== 0n; i++) {
    remainder *= 10n;
    fraction += (remainder / denominator).toString();
    remainder %= denominator;
  }
  fraction = fraction.replace(/0+$/u, '');
  const isZero = whole === 0n && fraction === '';
  return `${negative && !isZero ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Format a 1e18-scaled integer as a decimal string without floating point.
 *
 * @param scaled - Scaled value (e.g. a `rate` or `currencyEquivalent`)
 * @param maxFractionDigits - Digits kept after the decimal point (default 18,
 *   truncated); trailing zeros are removed.
 *
 * @example
 * ```typescript
 * formatScaled(1_500_000_000_000_000_000n); // '1.5'
 * ```
 */
export function formatScaled(scaled: bigint, maxFractionDigits = 18): string {
  return formatQuotient(scaled, USD_SCALE, maxFractionDigits);
}

/**
 * Convert a token amount in smallest units into whole units as a decimal
 * string, using the token's `denomination` (parts per whole token).
 *
 * Works for any positive denomination (not only powers of ten); results that
 * do not terminate are truncated to `maxFractionDigits` (default 18).
 *
 * @example
 * ```typescript
 * partsToWhole(1_500_000_000n, 1_000_000_000n); // '1.5'
 * partsToWhole(1n, 4n);                         // '0.25'
 * ```
 */
export function partsToWhole(parts: bigint, denomination: bigint, maxFractionDigits = 18): string {
  if (denomination <= 0n) throw new Error('denomination must be positive');
  return formatQuotient(parts, denomination, maxFractionDigits);
}

// ============================================================================
// CONTRACT SUPPLY (DATABASE_TYPE.CONTRACT_SUPPLY)
// ============================================================================

/** Decoded `CONTRACT_SUPPLY` database record. */
export interface ContractSupply {
  /** Maximum supply in smallest units (`0n` when the contract is uncapped). */
  maxSupply: bigint;
  /** Current (minted, not burned) supply in smallest units. */
  currentSupply: bigint;
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  for (;;) {
    if (cursor >= bytes.length) throw new Error('truncated varint');
    const byte = bytes[cursor] as number;
    cursor += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7;
    if (shift > 49) throw new Error('varint too long');
  }
}

/**
 * Decode the `CONTRACT_SUPPLY` database record.
 *
 * The validator stores this record as an internal protobuf message whose
 * schema is not part of the public protos: field 1 is the max supply and
 * field 2 the current supply, both as decimal strings. Field meaning was
 * confirmed against the live network (field 1 equals the contract's
 * `max_supply`).
 *
 * @param value - The raw `DatabaseResponse.value` string (binary protobuf
 *   transported as a latin-1 string)
 * @throws Error if the record is malformed
 */
export function decodeContractSupply(value: string): ContractSupply {
  const bytes = Uint8Array.from(value, ch => {
    const code = ch.charCodeAt(0);
    if (code > 0xff) throw new Error('contract supply record is not binary protobuf');
    return code;
  });
  const decoder = new TextDecoder();
  const fields = new Map<number, string>();
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    if (wireType !== 2) throw new Error(`unexpected wire type ${wireType} in contract supply record`);
    const length = readVarint(bytes, tag.next);
    const end = length.next + length.value;
    if (end > bytes.length) throw new Error('truncated contract supply record');
    fields.set(fieldNumber, decoder.decode(bytes.subarray(length.next, end)));
    offset = end;
  }
  return {
    maxSupply: parseUintString(fields.get(1) ?? '', 'maxSupply'),
    currentSupply: parseUintString(fields.get(2) ?? '', 'currentSupply')
  };
}

// ============================================================================
// BLOCKS
// ============================================================================

/**
 * Mapping of every `TXNS` list field to the transaction type it contains.
 * Result-only lists (`txnFeesAndStatus`, `tokenFees`, …) are excluded.
 */
const TXNS_LIST_TYPES = {
  coinTxns: TRANSACTION_TYPE.COIN_TYPE,
  mintTxns: TRANSACTION_TYPE.MINT_TYPE,
  itemMintTxns: TRANSACTION_TYPE.ITEM_MINT_TYPE,
  contractTxns: TRANSACTION_TYPE.CONTRACT_TXN_TYPE,
  governanceVotes: TRANSACTION_TYPE.VOTE_TYPE,
  governanceProposals: TRANSACTION_TYPE.PROPOSAL_TYPE,
  smartContracts: TRANSACTION_TYPE.SMART_CONTRACT_TYPE,
  smartContractExecutes: TRANSACTION_TYPE.SMART_CONTRACT_EXECUTE_TYPE,
  expenseRatios: TRANSACTION_TYPE.EXPENSE_RATIO_TYPE,
  nftTxns: TRANSACTION_TYPE.NFT_TYPE,
  contractUpdateTxns: TRANSACTION_TYPE.UPDATE_CONTRACT_TYPE,
  validatorRegistrationTxns: TRANSACTION_TYPE.VALIDATOR_REGISTRATION_TYPE,
  validatorHeartbeatTxns: TRANSACTION_TYPE.VALIDATOR_HEARTBEAT_TYPE,
  proposalResultTxns: TRANSACTION_TYPE.PROPOSAL_RESULT_TYPE,
  delegatedVotingTxns: TRANSACTION_TYPE.DELEGATED_VOTING_TYPE,
  quashTxns: TRANSACTION_TYPE.QUASH_TYPE,
  revokeTxns: TRANSACTION_TYPE.REVOKE_TYPE,
  complianceTxns: TRANSACTION_TYPE.COMPLIANCE_TYPE,
  burnSbtTxns: TRANSACTION_TYPE.SBT_BURN_TYPE,
  smartContractInstantiateTxns: TRANSACTION_TYPE.SMART_CONTRACT_INSTANTIATE_TYPE,
  allowanceTxns: TRANSACTION_TYPE.ALLOWANCE_TYPE,
  proposalCancelTxns: TRANSACTION_TYPE.PROPOSAL_CANCEL_TYPE
} as const satisfies Partial<Record<keyof TXNS, TRANSACTION_TYPE>>;

/** A transaction extracted from a block, with its type and (hex) hash. */
export interface BlockTransaction {
  /** Transaction type. */
  type: TRANSACTION_TYPE;
  /** Name of the `TXNS` field the transaction came from, e.g. `coinTxns`. */
  list: keyof typeof TXNS_LIST_TYPES | 'requiredVersionTxn';
  /** Lower-case hex transaction hash (`''` if the transaction has no base hash). */
  hash: string;
  /** The decoded protobuf transaction message. */
  txn: { $typeName: string; base?: { hash?: Uint8Array } };
}

/**
 * Flatten every transaction in a block's `TXNS` container into a single list.
 *
 * Ordering follows the `TXNS` field order, then in-list order.
 */
export function listBlockTransactions(block: Block): BlockTransaction[] {
  const txns = block.transactions;
  if (!txns) return [];
  const result: BlockTransaction[] = [];
  const push = (type: TRANSACTION_TYPE, list: BlockTransaction['list'], txn: BlockTransaction['txn']): void => {
    const hashBytes = txn.base?.hash;
    result.push({ type, list, hash: hashBytes ? bytesToHex(hashBytes) : '', txn });
  };
  for (const [list, type] of Object.entries(TXNS_LIST_TYPES) as [keyof typeof TXNS_LIST_TYPES, TRANSACTION_TYPE][]) {
    for (const txn of txns[list] as BlockTransaction['txn'][]) push(type, list, txn);
  }
  // The only singular transaction field in TXNS.
  if (txns.requiredVersionTxn) {
    push(TRANSACTION_TYPE.REQUIRED_VERSION, 'requiredVersionTxn', txns.requiredVersionTxn);
  }
  return result;
}

/** Processing result for one transaction, from `TXNS.txn_fees_and_status`. */
export interface TransactionResult {
  /** Lower-case hex transaction hash. */
  hash: string;
  /** Network status code. `TXN_STATUS.OK` means the transaction succeeded. */
  status: TXN_STATUS;
  /** Upper-snake status name, e.g. `OK` or `INSUFFICIENT_AMOUNT`. */
  statusName: string;
  /** `true` when `status === TXN_STATUS.OK`. */
  success: boolean;
  /** Base fee charged, in smallest units of `baseFeeContractId`. */
  baseFees: bigint;
  /** Instrument the base fee was paid in. */
  baseFeeContractId: string;
  /** Contract fee charged (smallest units), when applicable. */
  contractFees?: bigint;
  /** Instrument the contract fee was paid in, when applicable. */
  contractFeeContractId?: string;
  /** Gas consumed by smart contract execution, when applicable. */
  gas?: bigint;
  /** The raw protobuf record, for fields not surfaced above. */
  raw: TXNStatusFees;
}

/** Convert a raw `TXNStatusFees` record into a {@link TransactionResult}. */
export function toTransactionResult(raw: TXNStatusFees): TransactionResult {
  return {
    hash: bytesToHex(raw.txnHash),
    status: raw.status,
    statusName: TXN_STATUS[raw.status] ?? `UNKNOWN_${raw.status}`,
    success: raw.status === TXN_STATUS.OK,
    baseFees: parseUintString(raw.baseFees, 'baseFees'),
    baseFeeContractId: raw.baseContractId,
    ...(raw.contractFees !== undefined ? { contractFees: parseUintString(raw.contractFees, 'contractFees') } : {}),
    ...(raw.contractContractId !== undefined ? { contractFeeContractId: raw.contractContractId } : {}),
    ...(raw.gas !== undefined ? { gas: raw.gas } : {}),
    raw
  };
}

/**
 * Find the processing result of a transaction inside a block.
 *
 * @param block - Block to search
 * @param txnHash - Hex transaction hash (optionally `0x`-prefixed, any case)
 * @returns The result, or `undefined` if the block does not contain it
 */
export function findTransactionResult(block: Block, txnHash: string): TransactionResult | undefined {
  const wanted = txnHash.toLowerCase().replace(/^0x/u, '');
  const raw = block.transactions?.txnFeesAndStatus.find(entry => bytesToHex(entry.txnHash) === wanted);
  return raw ? toTransactionResult(raw) : undefined;
}

/** Compact, JSON-friendly summary of a block header and contents. */
export interface BlockSummary {
  /** Block height. */
  height: bigint;
  /** Lower-case hex block hash. */
  hash: string;
  /** Lower-case hex hash of the previous block (`''` for genesis). */
  previousHash: string;
  /** Block timestamp. */
  timestamp: Date | undefined;
  /** Protocol version the block was produced with. */
  version: bigint | undefined;
  /** Number of user/system transactions (excludes result records). */
  transactionCount: number;
  /** Transaction count per type name, e.g. `{ COIN_TYPE: 3 }`. */
  transactionsByType: Record<string, number>;
  /** Per-transaction processing results. */
  results: TransactionResult[];
}

/** Summarise a block into plain values (hex hashes, `Date`, counts). */
export function summarizeBlock(block: Block): BlockSummary {
  const header = block.blockHeader;
  const transactions = listBlockTransactions(block);
  const transactionsByType: Record<string, number> = {};
  for (const { type } of transactions) {
    const name = TRANSACTION_TYPE[type] ?? `TYPE_${type}`;
    transactionsByType[name] = (transactionsByType[name] ?? 0) + 1;
  }
  const ts = header?.timestamp;
  return {
    height: header?.blockHeight ?? 0n,
    hash: header?.hash ? bytesToHex(header.hash) : '',
    previousHash: header?.previousBlockHash ? bytesToHex(header.previousBlockHash) : '',
    timestamp: ts ? new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000)) : undefined,
    version: header?.version,
    transactionCount: transactions.length,
    transactionsByType,
    results: (block.transactions?.txnFeesAndStatus ?? []).map(toTransactionResult)
  };
}
