/**
 * Standard Transaction Pipeline
 *
 * Every Kalvora transaction other than `CoinTXN` shares the same envelope:
 * a single-signer {@link BaseTXN} (public key, timestamp, nonce, fee, memo,
 * optional safe-send / interface-fee fields) followed by type-specific fields.
 *
 * This module centralises the build → fee → sign → submit lifecycle so that
 * individual transaction modules only describe *their own* fields:
 *
 * ```typescript
 * export async function buildQuashTXN(input, options) {
 *   return buildStandardTransaction({
 *     operation: 'buildQuashTXN',
 *     schema: QuashTXNSchema,
 *     publicKeyId: input.publicKey,
 *     contractId: input.contractId,
 *     fields: { contractId: input.contractId, txnHash: parseHash32(input.txnHash, 'txnHash') },
 *     options
 *   });
 * }
 * ```
 *
 * ## Lifecycle
 *
 * | Stage   | Function                         | Network?                        |
 * |---------|----------------------------------|---------------------------------|
 * | build   | {@link buildStandardTransaction} | nonce + fee lookup unless given |
 * | sign    | {@link signWithKey} / `signAndFinalize` | no                       |
 * | submit  | {@link submitStandardTransaction}| yes                             |
 *
 * Passing both `nonce` and `feeAmountParts` makes `build` fully offline and
 * deterministic (useful for cold signing, tests, and hardware wallets).
 *
 * @module shared/tx/standard
 */

import { create, protoInt64, type DescMessage, type MessageInitShape, type MessageShape } from '@bufbuild/protobuf';

import type { BaseTXN } from '../../../proto/generated/txn_pb.js';
import type { GRPCConfig } from '../../types/index.js';
import { isValidPublicKeyIdentifier, sanitizeAndDecodeAddress } from '../crypto/address-utils.js';
import {
  UniversalFeeCalculator,
  type FeeConfigHelper,
  type TransactionMessage
} from '../fee-calculators/universal-fee-calculator.js';
import { logger } from '../monitoring/index.js';
import { KALVORA_MINT_ID_ERROR, KALVORA_NATIVE_TOKEN } from '../network/constants.js';
import { hexToBytes } from '../utils/byte-utils.js';
import { PROTONET_GRPC_CONFIG } from '../utils/testing-defaults/index.js';
import { isValidContractId } from '../utils/validation.js';

import { buildStandardBaseTXN, getAddressAndNonce } from './base.js';

// ============================================================================
// OPTIONS
// ============================================================================

/**
 * Options accepted by every standard (single-signer, `BaseTXN`-based)
 * transaction builder in the SDK.
 *
 * All fields are optional. Omitted values are resolved from the network
 * (nonce, base fee) or fall back to documented defaults.
 */
export interface StandardTXNOptions {
  /**
   * gRPC endpoint used for nonce and fee lookups.
   * Defaults to {@link PROTONET_GRPC_CONFIG} (which currently targets protonet).
   */
  grpcConfig?: GRPCConfig;
  /**
   * Explicit replay-protection nonce. When set, the network nonce lookup is
   * skipped. Must be the *next* nonce for the signing wallet (current + 1).
   *
   * WARNING: manual nonces are not validated; an incorrect value causes the
   * network to reject the transaction.
   */
  nonce?: string | number | bigint;
  /** Transaction timestamp. Defaults to `new Date()`. */
  timestamp?: Date;
  /** Optional free-form memo stored on-chain in `BaseTXN.memo`. */
  memo?: string;
  /** Base (network) fee instrument. Defaults to {@link KALVORA_NATIVE_TOKEN}. */
  feeId?: string;
  /**
   * Exact base fee in the fee instrument's smallest units ("parts").
   * When set, the automatic fee calculation (and its network calls) is skipped.
   */
  feeAmountParts?: string;
  /**
   * Maximum overestimate applied to the automatically calculated base fee,
   * in percent (default 5). The network only charges the real fee.
   */
  overestimatePercent?: number;
  /**
   * When `true`, sets `BaseTXN.safe_send`, asking validators to reject the
   * transaction instead of executing it if any recipient wallet does not yet
   * exist. Omitted from the wire when not set.
   */
  safeSend?: boolean;
  /**
   * Optional interface (front-end / integrator) fee. All three interface
   * fields must be supplied together. `interfaceFee` is in whole-token units.
   */
  interfaceFeeId?: string;
  /** Interface fee amount in whole-token units (e.g. `'0.25'`). */
  interfaceFee?: string;
  /** Base58 address that receives the interface fee. */
  interfaceAddress?: string;
}

/**
 * Parameters for {@link buildStandardTransaction}.
 *
 * @typeParam Desc - protobuf-es message descriptor (e.g. `QuashTXNSchema`)
 */
export interface BuildStandardTransactionParams<Desc extends DescMessage> {
  /** Name of the public builder, used in logs and error messages. */
  operation: string;
  /** Generated protobuf-es schema for the transaction message. */
  schema: Desc;
  /** Base58 public key identifier of the signer (e.g. `A_c_…`). */
  publicKeyId: string;
  /**
   * Contract the transaction acts on. Used to look up fee information; pass
   * `undefined` for transactions that are not bound to a single contract.
   */
  contractId?: string | undefined;
  /** Type-specific message fields (everything except `base`). */
  fields: Omit<MessageInitShape<Desc>, 'base' | '$typeName'>;
  /** Shared builder options. */
  options?: StandardTXNOptions;
}

// ============================================================================
// PARSING HELPERS (shared by builders)
// ============================================================================

/**
 * Ensure a value is a bounded, printable Kalvora mint/contract ID.
 *
 * This is a *syntactic* check only (see `isKalvoraMintId`); the network
 * performs the final semantic validation (e.g. whether the contract exists).
 *
 * @param value - Candidate contract ID (e.g. `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao`)
 * @param field - Field name used in the error message
 * @returns The same value, typed as a string
 * @throws Error when the ID is not canonical
 */
export function requireContractId(value: unknown, field = 'contractId'): string {
  if (typeof value !== 'string' || !isValidContractId(value)) {
    throw new Error(`${field} must be ${KALVORA_MINT_ID_ERROR}`);
  }
  return value;
}

/**
 * Decode a base58 wallet address into raw bytes, with a field-specific error.
 *
 * @param address - Base58 Kalvora wallet address
 * @param field - Field name used in the error message
 * @returns Raw address bytes suitable for protobuf `bytes` fields
 */
export function parseAddress(address: unknown, field = 'address'): Uint8Array {
  if (typeof address !== 'string' || address.trim() === '') {
    throw new Error(`${field} must be a non-empty base58 address`);
  }
  try {
    return new Uint8Array(sanitizeAndDecodeAddress(address));
  } catch (error) {
    throw new Error(`${field} is not a valid base58 address: ${(error as Error).message}`);
  }
}

/**
 * Parse a 32-byte hash (transaction hash, proposal ID) from hex.
 * Accepts an optional `0x` prefix.
 *
 * @param hex - 64 hex characters, optionally `0x`-prefixed
 * @param field - Field name used in the error message
 */
export function parseHash32(hex: unknown, field = 'hash'): Uint8Array {
  if (typeof hex !== 'string' || !/^(?:0x)?[0-9a-fA-F]{64}$/u.test(hex)) {
    throw new Error(`${field} must be a 32-byte hex string`);
  }
  return hexToBytes(hex);
}

/**
 * Parse a non-negative integer amount expressed in a token's smallest units
 * ("parts"). Returned as a canonical decimal string (no leading zeros).
 *
 * @param value - Integer as string, number, or bigint
 * @param field - Field name used in the error message
 * @param allowZero - Whether `0` is acceptable (default `false`)
 */
export function parsePartsAmount(
  value: unknown,
  field = 'amount',
  allowZero = false
): string {
  let parsed: bigint;
  try {
    if (typeof value === 'bigint') {
      parsed = value;
    } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
      parsed = BigInt(value);
    } else if (typeof value === 'string' && /^\d+$/u.test(value.trim())) {
      parsed = BigInt(value.trim());
    } else {
      throw new Error('not an integer');
    }
  } catch {
    throw new Error(`${field} must be a non-negative integer amount in smallest units`);
  }
  if (parsed < 0n || (!allowZero && parsed === 0n)) {
    throw new Error(`${field} must be ${allowZero ? 'non-negative' : 'greater than zero'}`);
  }
  return parsed.toString();
}

/** Earliest instant representable by `google.protobuf.Timestamp`. */
const PROTOBUF_TIMESTAMP_MIN_MS = Date.parse('0001-01-01T00:00:00.000Z');
/** Latest instant representable by `google.protobuf.Timestamp`. */
const PROTOBUF_TIMESTAMP_MAX_MS = Date.parse('9999-12-31T23:59:59.999Z');

/**
 * Parse an unsigned 64-bit integer (nonce, height) with a field-specific error.
 *
 * @param value - Integer as string, number, or bigint
 * @param field - Field name used in the error message
 */
export function parseUint64(value: unknown, field = 'value'): bigint {
  let parsed: bigint | undefined;
  if (typeof value === 'bigint') parsed = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) parsed = BigInt(value);
  else if (typeof value === 'string' && /^\d+$/u.test(value.trim())) parsed = BigInt(value.trim());
  if (parsed === undefined || parsed < 0n || parsed > 0xFFFF_FFFF_FFFF_FFFFn) {
    throw new Error(`${field} must be an unsigned 64-bit integer`);
  }
  return parsed;
}

/**
 * Convert a `Date` into a protobuf `Timestamp` init shape.
 *
 * @throws Error when the date is invalid
 */
export function toTimestampInit(date: Date, field = 'timestamp'): { seconds: bigint; nanos: number } {
  const ms = date instanceof Date ? date.getTime() : Number.NaN;
  if (!Number.isFinite(ms) || ms < PROTOBUF_TIMESTAMP_MIN_MS || ms > PROTOBUF_TIMESTAMP_MAX_MS) {
    throw new Error(`${field} must be a valid Date between years 0001 and 9999`);
  }
  const seconds = Math.floor(ms / 1000);
  return { seconds: protoInt64.parse(seconds), nanos: (ms - seconds * 1000) * 1_000_000 };
}

// ============================================================================
// PIPELINE
// ============================================================================

/**
 * Resolve the nonce for a standard transaction: use the explicit option when
 * given, otherwise query the network for the signer's next nonce.
 */
export async function resolveNonce(
  operation: string,
  publicKeyId: string,
  options: StandardTXNOptions
): Promise<bigint> {
  if (options.nonce !== undefined) {
    logger.warn('Manual nonce specified - skipping network nonce fetch.', {
      operation,
      nonce: String(options.nonce)
    });
    return parseUint64(options.nonce, 'nonce');
  }
  const grpcConfig = options.grpcConfig ?? PROTONET_GRPC_CONFIG;
  return (await getAddressAndNonce(publicKeyId, grpcConfig)).nonce;
}

function validateInterfaceFee(options: StandardTXNOptions): void {
  const provided = [options.interfaceFeeId, options.interfaceFee, options.interfaceAddress]
    .filter(value => value !== undefined).length;
  if (provided !== 0 && provided !== 3) {
    throw new Error('interfaceFeeId, interfaceFee, and interfaceAddress must be provided together');
  }
  if (options.interfaceFeeId !== undefined) {
    requireContractId(options.interfaceFeeId, 'interfaceFeeId');
  }
}

/**
 * Build an **unsigned** standard transaction.
 *
 * Steps:
 * 1. Validate `publicKeyId`, `feeId`, and interface-fee options.
 * 2. Resolve the nonce (explicit or network).
 * 3. Build the `BaseTXN` (timestamp, memo, fee instrument, safe-send).
 * 4. Create the protobuf message from `fields`.
 * 5. Compute the base fee (and interface fee) unless `feeAmountParts` is set.
 * 6. Assert no signature/hash material leaked into the unsigned message.
 *
 * @returns A fully-populated but unsigned protobuf message.
 */
export async function buildStandardTransaction<Desc extends DescMessage>(
  params: BuildStandardTransactionParams<Desc>
): Promise<MessageShape<Desc>> {
  const { operation, schema, publicKeyId, contractId, fields } = params;
  const options = params.options ?? {};

  if (typeof publicKeyId !== 'string' || publicKeyId.trim() === '') {
    throw new Error('publicKey identifier is required');
  }
  if (!isValidPublicKeyIdentifier(publicKeyId)) {
    throw new Error('publicKey is not a valid Kalvora public key identifier');
  }
  // Canonicalise (trim, strip leading zeros) so the wire value is exactly
  // the validated integer.
  const feeAmountParts = options.feeAmountParts !== undefined
    ? parsePartsAmount(options.feeAmountParts, 'feeAmountParts')
    : undefined;
  if (
    options.overestimatePercent !== undefined &&
    (!Number.isFinite(options.overestimatePercent) || options.overestimatePercent < 0)
  ) {
    throw new Error('overestimatePercent must be a finite, non-negative number');
  }
  const feeId = requireContractId(options.feeId ?? KALVORA_NATIVE_TOKEN, 'feeId');
  validateInterfaceFee(options);
  if (options.safeSend !== undefined && typeof options.safeSend !== 'boolean') {
    throw new Error('safeSend must be a boolean');
  }

  const nonce = await resolveNonce(operation, publicKeyId, options);

  const base: BaseTXN = buildStandardBaseTXN({
    publicKeyId,
    nonce,
    feeId,
    ...(options.memo !== undefined ? { memo: options.memo } : {}),
    ...(options.timestamp !== undefined ? { timestamp: options.timestamp } : {}),
    ...(feeAmountParts !== undefined ? { feeAmountParts } : {})
  });
  if (options.safeSend !== undefined) {
    base.safeSend = options.safeSend;
  }

  const message = create(schema, { ...fields, base } as unknown as MessageInitShape<Desc>);

  const needsFeeCalculation = options.feeAmountParts === undefined;
  const needsInterfaceFee = options.interfaceFeeId !== undefined;
  if (needsFeeCalculation || needsInterfaceFee) {
    const feeOptions: FeeConfigHelper = {
      protoObject: message as unknown as TransactionMessage,
      tokenInfoMap: new Map(),
      baseFeeId: feeId,
      ...(contractId !== undefined ? { contractId } : {}),
      ...(options.grpcConfig !== undefined ? { grpcConfig: options.grpcConfig } : {}),
      ...(feeAmountParts !== undefined ? { baseFeeParts: feeAmountParts } : {}),
      ...(options.overestimatePercent !== undefined ? { overestimatePercent: options.overestimatePercent } : {}),
      ...(needsInterfaceFee
        ? {
          interfaceFeeId: options.interfaceFeeId as string,
          interfaceFee: options.interfaceFee as string,
          interfaceAddress: options.interfaceAddress as string
        }
        : {})
    };
    await UniversalFeeCalculator.calculateFee(feeOptions);
  }

  const built = message as { base?: BaseTXN };
  if (built.base?.signature !== undefined || built.base?.hash !== undefined) {
    throw new Error(`${operation}: unsigned construction unexpectedly produced signature material`);
  }

  return message;
}

/**
 * Submit any signed standard transaction via the universal transaction client.
 *
 * @param txn - Signed protobuf transaction
 * @param grpcConfig - Endpoint configuration
 * @returns Hex transaction hash
 */
export async function submitStandardTransaction(
  txn: { $typeName: string; base?: BaseTXN },
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  if (!txn.base?.signature || !txn.base.hash) {
    throw new Error('Transaction must be signed before submission (missing signature or hash)');
  }
  const { submitTransaction } = await import('../../grpc/transaction/transaction-client.js');
  return submitTransaction(txn, grpcConfig);
}
