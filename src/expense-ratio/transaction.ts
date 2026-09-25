/**
 * Transaction Module - ExpenseRatioTXN
 *
 * Builds, signs, and submits Kalvora expense-ratio collection transactions
 * (`TXNService.ExpenseRatio`).
 *
 * Contracts may define an expense-ratio schedule (`InstrumentContract.
 * expense_ratio`, a list of `{ day, month, percent }` entries where
 * `percent` uses 100,000 = 100%). An `ExpenseRatioTXN` triggers collection of
 * that ratio from the listed holder `addresses` into `outputAddress`. Only a
 * key with the contract's `expense_ratio` restricted-key permission may
 * submit it. Scheduling is enforced by validators (not by this SDK); a
 * repeated collection is rejected with `EXPENSE_RATIO_DUPLICATE`. The
 * resulting per-wallet amounts are reported in an `ExpenseRatioResult`.
 *
 * @module expense-ratio/transaction
 */

import {
  ExpenseRatioTXNSchema,
  type ExpenseRatioTXN
} from '../../proto/generated/txn_pb.js';
import {
  buildStandardTransaction,
  parseAddress,
  requireContractId,
  submitStandardTransaction,
  type StandardTXNOptions
} from '../shared/tx/standard.js';
import { signWithKey } from '../sign/finalize.js';
import type { GRPCConfig } from '../types/index.js';

/** Input for {@link buildExpenseRatioTXN}. */
export interface ExpenseRatioInput {
  /** Signer's base58 public key identifier (must hold the `expense_ratio` restricted key). */
  publicKey: string;
  /** Contract whose expense ratio is collected, e.g. `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao`. */
  contractId: string;
  /** Base58 holder addresses to collect from (non-empty, unique). */
  addresses: string[];
  /** Base58 address that receives the collected tokens. */
  outputAddress: string;
}

function buildExpenseRatioFields(input: ExpenseRatioInput): {
  contractId: string;
  addresses: Uint8Array[];
  outputAddress: Uint8Array;
} {
  if (input === null || typeof input !== 'object') {
    throw new Error('ExpenseRatioTXN input must be an object');
  }
  const contractId = requireContractId(input.contractId, 'contractId');
  if (!Array.isArray(input.addresses) || input.addresses.length === 0) {
    throw new Error('addresses must be a non-empty array of base58 addresses');
  }
  const seen = new Set<string>();
  const addresses = input.addresses.map((address, i) => {
    const bytes = parseAddress(address, `addresses[${i}]`);
    const normalized = address.trim();
    if (seen.has(normalized)) {
      throw new Error(`addresses[${i}] duplicates an earlier address`);
    }
    seen.add(normalized);
    return bytes;
  });
  const outputAddress = parseAddress(input.outputAddress, 'outputAddress');
  return { contractId, addresses, outputAddress };
}

/**
 * Build an **unsigned** `ExpenseRatioTXN`.
 *
 * On-chain semantics: asks validators to apply `contractId`'s configured
 * expense ratio to every wallet in `addresses` and credit the proceeds to
 * `outputAddress`. The amount per wallet is computed on-chain from the
 * contract's schedule — this transaction carries no amounts. The base fee is
 * looked up for `contractId`; pass `options.nonce` and
 * `options.feeAmountParts` for fully offline, deterministic construction.
 *
 * @param input - Signer, contract, holder addresses, and output address
 * @param options - Shared builder options (nonce, fee, memo, timestamp, …)
 * @returns Unsigned `zera_txn.ExpenseRatioTXN`
 * @throws Error on an invalid contract ID, empty/duplicated/invalid
 *   `addresses`, invalid `outputAddress`, or nonce/fee network failures
 *
 * @example
 * ```typescript
 * const txn = await buildExpenseRatioTXN({
 *   publicKey: manager.publicKey,
 *   contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
 *   addresses: [bob.address, charlie.address],
 *   outputAddress: treasury.address
 * });
 * ```
 */
export async function buildExpenseRatioTXN(
  input: ExpenseRatioInput,
  options: StandardTXNOptions = {}
): Promise<ExpenseRatioTXN> {
  const fields = buildExpenseRatioFields(input);
  return buildStandardTransaction({
    operation: 'buildExpenseRatioTXN',
    schema: ExpenseRatioTXNSchema,
    publicKeyId: input.publicKey,
    contractId: fields.contractId,
    fields,
    options
  });
}

/**
 * Build and sign an `ExpenseRatioTXN`.
 *
 * @param input - See {@link ExpenseRatioInput}
 * @param privateKey - Signer's base58 private key (must match `input.publicKey`)
 * @param options - Shared builder options
 * @returns Signed transaction with `base.signature` and `base.hash` populated
 * @throws Error when `privateKey` is empty, plus everything {@link buildExpenseRatioTXN} throws
 *
 * @example
 * ```typescript
 * const txn = await createExpenseRatioTXN({
 *   publicKey: manager.publicKey,
 *   contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
 *   addresses: [bob.address],
 *   outputAddress: treasury.address
 * }, manager.privateKey);
 * const hash = await sendExpenseRatioTXN(txn);
 * ```
 */
export async function createExpenseRatioTXN(
  input: ExpenseRatioInput,
  privateKey: string,
  options: StandardTXNOptions = {}
): Promise<ExpenseRatioTXN> {
  if (typeof privateKey !== 'string' || privateKey === '') {
    throw new Error('privateKey is required');
  }
  const txn = await buildExpenseRatioTXN(input, options);
  return signWithKey(txn, privateKey, input.publicKey);
}

/**
 * Submit a signed `ExpenseRatioTXN` via `TXNService.ExpenseRatio`.
 *
 * @param txn - Signed transaction
 * @param grpcConfig - Endpoint configuration
 * @returns Hex transaction hash
 * @throws Error when the transaction is unsigned or the network rejects it
 *
 * @example
 * ```typescript
 * const hash = await sendExpenseRatioTXN(signedTxn);
 * ```
 */
export async function sendExpenseRatioTXN(
  txn: ExpenseRatioTXN,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  return submitStandardTransaction(txn, grpcConfig);
}
