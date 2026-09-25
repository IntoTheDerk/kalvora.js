/**
 * Transaction Module - ComplianceTXN
 *
 * Builds, signs, and submits Kalvora compliance (KYC) transactions. A
 * `ComplianceTXN` assigns or revokes compliance levels for one or more
 * wallets on a contract. Contracts can require a minimum compliance level to
 * hold or transfer their token, which makes this the on-chain side of a
 * KYC / accreditation workflow.
 *
 * All envelope handling (nonce, `BaseTXN`, fees) is delegated to the shared
 * standard transaction pipeline in `shared/tx/standard`.
 *
 * @module compliance/transaction
 */

import { ComplianceTXNSchema, type ComplianceTXN } from '../../proto/generated/txn_pb.js';
import {
  buildStandardTransaction,
  parseAddress,
  requireContractId,
  submitStandardTransaction,
  toTimestampInit,
  type StandardTXNOptions
} from '../shared/tx/standard.js';
import { signWithKey } from '../sign/finalize.js';
import type { GRPCConfig } from '../types/index.js';

/** Largest value representable by the protobuf `uint32 compliance_level` field. */
export const MAX_COMPLIANCE_LEVEL = 0xffff_ffff;

const EARLIEST_TIMESTAMP_MS = Date.parse('0001-01-01T00:00:00.000Z');
const LATEST_TIMESTAMP_MS = Date.parse('9999-12-31T23:59:59.999Z');

/**
 * Options accepted by {@link buildComplianceTXN} and {@link createComplianceTXN}.
 *
 * Identical to the shared {@link StandardTXNOptions}. Pass both `nonce` and
 * `feeAmountParts` to build fully offline and deterministically.
 */
export type ComplianceTXNOptions = StandardTXNOptions;

/**
 * A single compliance change for one wallet (maps to `ComplianceAssign`).
 */
export interface ComplianceAssignmentInput {
  /** Base58 wallet address whose compliance level is changed. */
  recipientAddress: string;
  /**
   * Compliance level to assign or revoke. Integer in `0..2^32-1`
   * (`uint32`). The meaning of each level is defined by the contract's
   * compliance configuration (e.g. `1` = KYC, `2` = accredited investor).
   */
  complianceLevel: number;
  /** `true` assigns `complianceLevel` to the wallet; `false` revokes it. */
  assign: boolean;
  /**
   * Optional expiry of an **assignment**. After this instant the level is no
   * longer considered valid for the wallet. Omit for a non-expiring
   * assignment. Not allowed when `assign` is `false`.
   */
  expiry?: Date;
}

/**
 * Readable input for a {@link ComplianceTXN}.
 */
export interface ComplianceTXNInput {
  /** Contract the compliance levels apply to (canonical mint ID, e.g. `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao`). */
  contractId: string;
  /**
   * One or more compliance changes, applied in order. Each
   * `(recipientAddress, complianceLevel)` pair may appear only once.
   */
  assignments: readonly ComplianceAssignmentInput[];
  /**
   * Base58 public key identifier of the signer (e.g. `A_…`). The key must be
   * a restricted key on the contract with the `compliance` permission.
   */
  publicKey: string;
}

function parseComplianceLevel(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_COMPLIANCE_LEVEL
  ) {
    throw new Error(`${field} must be an integer between 0 and ${MAX_COMPLIANCE_LEVEL}`);
  }
  return value;
}

function parseExpiry(value: unknown, field: string): { seconds: bigint; nanos: number } {
  if (!(value instanceof Date)) {
    throw new Error(`${field} must be a valid Date`);
  }
  const ms = value.getTime();
  if (Number.isFinite(ms) && (ms < EARLIEST_TIMESTAMP_MS || ms > LATEST_TIMESTAMP_MS)) {
    throw new Error(`${field} must be between 0001-01-01 and 9999-12-31 (UTC)`);
  }
  return toTimestampInit(value, field);
}

function parseAssignments(value: unknown): Array<{
  recipientAddress: Uint8Array;
  complianceLevel: number;
  assignRevoke: boolean;
  expiry?: { seconds: bigint; nanos: number };
}> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('assignments must be a non-empty array');
  }

  const seen = new Set<string>();
  return value.map((entry: unknown, index) => {
    const prefix = `assignments[${index}]`;
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`${prefix} must be an object`);
    }
    const assignment = entry as Partial<ComplianceAssignmentInput>;

    const recipientAddress = parseAddress(assignment.recipientAddress, `${prefix}.recipientAddress`);
    const complianceLevel = parseComplianceLevel(assignment.complianceLevel, `${prefix}.complianceLevel`);
    if (typeof assignment.assign !== 'boolean') {
      throw new Error(`${prefix}.assign must be a boolean (true = assign, false = revoke)`);
    }

    const key = `${recipientAddress.join(',')}#${complianceLevel}`;
    if (seen.has(key)) {
      throw new Error(`${prefix} duplicates an earlier recipientAddress/complianceLevel pair`);
    }
    seen.add(key);

    if (assignment.expiry !== undefined) {
      if (!assignment.assign) {
        throw new Error(`${prefix}.expiry is only allowed when assign is true`);
      }
      return {
        recipientAddress,
        complianceLevel,
        assignRevoke: true,
        expiry: parseExpiry(assignment.expiry, `${prefix}.expiry`)
      };
    }
    return { recipientAddress, complianceLevel, assignRevoke: assignment.assign };
  });
}

/**
 * Build an **unsigned** {@link ComplianceTXN}.
 *
 * On-chain, each entry of `assignments` becomes a `ComplianceAssign` that
 * either grants (`assign: true`) or removes (`assign: false`) compliance
 * level `complianceLevel` for `recipientAddress` on `contractId`, optionally
 * with an expiry. Validators accept the transaction only if the signer's
 * public key is a `RestrictedKey` of the contract with `compliance = true`.
 *
 * Unless both `options.nonce` and `options.feeAmountParts` are set, this
 * function queries the network for the signer's next nonce and the base fee.
 *
 * @param input - Compliance parameters (see {@link ComplianceTXNInput})
 * @param options - Shared standard transaction options
 * @returns The unsigned protobuf `ComplianceTXN`
 *
 * @throws Error when `contractId` is not a canonical mint ID, `assignments`
 *   is empty, any assignment has an invalid address, a level outside
 *   `0..2^32-1`, a non-boolean `assign`, an invalid `expiry` (or an expiry on
 *   a revocation), a duplicate address/level pair, when `publicKey` is
 *   missing, or when any shared option is invalid.
 *
 * @example
 * ```typescript
 * import { buildComplianceTXN } from 'kalvora.js';
 *
 * const txn = await buildComplianceTXN(
 *   {
 *     contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
 *     assignments: [
 *       { recipientAddress: '<wallet A>', complianceLevel: 1, assign: true,
 *         expiry: new Date('2027-12-31T00:00:00Z') },
 *       { recipientAddress: '<wallet B>', complianceLevel: 2, assign: false }
 *     ],
 *     publicKey: 'A_<signer base58 public key>'
 *   },
 *   { nonce: 21, feeAmountParts: '1000' } // offline + deterministic
 * );
 * ```
 */
export async function buildComplianceTXN(
  input: ComplianceTXNInput,
  options: ComplianceTXNOptions = {}
): Promise<ComplianceTXN> {
  if (input === null || typeof input !== 'object') {
    throw new Error('buildComplianceTXN: input object is required');
  }
  const contractId = requireContractId(input.contractId, 'contractId');
  const compliance = parseAssignments(input.assignments);

  return buildStandardTransaction({
    operation: 'buildComplianceTXN',
    schema: ComplianceTXNSchema,
    publicKeyId: input.publicKey,
    contractId,
    fields: { contractId, compliance },
    options
  });
}

/**
 * Build and sign a {@link ComplianceTXN} with a private key.
 *
 * Equivalent to {@link buildComplianceTXN} followed by `signWithKey`. The
 * signer (`input.publicKey`) needs the `compliance` permission on the contract.
 *
 * @param input - Compliance parameters
 * @param privateKey - Signer's base58 private key (matching `input.publicKey`)
 * @param options - Shared standard transaction options
 * @returns The signed `ComplianceTXN` (with `base.signature` and `base.hash`)
 *
 * @throws Error when `privateKey` is missing, on any validation error from
 *   {@link buildComplianceTXN}, or when signing fails.
 *
 * @example
 * ```typescript
 * const signed = await createComplianceTXN(
 *   {
 *     contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
 *     assignments: [{ recipientAddress, complianceLevel: 1, assign: true }],
 *     publicKey
 *   },
 *   privateKey
 * );
 * const hash = await sendComplianceTXN(signed);
 * ```
 */
export async function createComplianceTXN(
  input: ComplianceTXNInput,
  privateKey: string,
  options: ComplianceTXNOptions = {}
): Promise<ComplianceTXN> {
  if (typeof privateKey !== 'string' || privateKey.trim() === '') {
    throw new Error('privateKey is required');
  }
  const txn = await buildComplianceTXN(input, options);
  return signWithKey(txn, privateKey, input.publicKey);
}

/**
 * Submit a signed {@link ComplianceTXN} to the network (`TXNService.Compliance`).
 *
 * @param txn - Signed compliance transaction (from {@link createComplianceTXN})
 * @param grpcConfig - Endpoint configuration (defaults to SDK defaults)
 * @returns Hex transaction hash
 *
 * @throws Error when the transaction is unsigned (missing signature/hash) or
 *   the network rejects it.
 *
 * @example
 * ```typescript
 * const hash = await sendComplianceTXN(signed, { host: 'kal-protonet.visiondynamics.ch' });
 * ```
 */
export async function sendComplianceTXN(
  txn: ComplianceTXN,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  return submitStandardTransaction(txn, grpcConfig);
}
