/**
 * Transaction Module - QuashTXN
 *
 * Builds, signs, and submits Kalvora quash transactions. A `QuashTXN`
 * cancels a *pending* time-delayed transaction before it executes.
 *
 * Contract restricted keys may carry a `time_delay`: transactions they sign
 * (mint, revoke, contract update, …) are not executed immediately but held
 * pending for that delay. During the window, a key holding the `quash`
 * permission can stop the pending transaction by referencing its hash.
 *
 * All envelope handling (nonce, `BaseTXN`, fees) is delegated to the shared
 * standard transaction pipeline in `shared/tx/standard`.
 *
 * @module quash/transaction
 */

import { QuashTXNSchema, type QuashTXN } from '../../proto/generated/txn_pb.js';
import {
  buildStandardTransaction,
  parseHash32,
  requireContractId,
  submitStandardTransaction,
  type StandardTXNOptions
} from '../shared/tx/standard.js';
import { signWithKey } from '../sign/finalize.js';
import type { GRPCConfig } from '../types/index.js';

/**
 * Options accepted by {@link buildQuashTXN} and {@link createQuashTXN}.
 *
 * Identical to the shared {@link StandardTXNOptions}. Pass both `nonce` and
 * `feeAmountParts` to build fully offline and deterministically.
 */
export type QuashTXNOptions = StandardTXNOptions;

/**
 * Readable input for a {@link QuashTXN}.
 */
export interface QuashTXNInput {
  /**
   * Contract whose restricted key issued the pending transaction (canonical
   * mint ID, e.g. `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao`).
   */
  contractId: string;
  /**
   * Hash of the pending time-delayed transaction to quash: 32 bytes as 64 hex
   * characters, optionally `0x`-prefixed (the value returned by the `send*`
   * function that submitted it).
   */
  txnHash: string;
  /**
   * Base58 public key identifier of the signer (e.g. `A_…`). The key must be
   * a restricted key on the contract with the `quash` permission.
   */
  publicKey: string;
}

/**
 * Build an **unsigned** {@link QuashTXN}.
 *
 * On-chain, a quash transaction cancels the pending transaction `txnHash` on
 * `contractId` so it never executes. Validators accept it only while the
 * target is still inside its time-delay window, and only if the signer's
 * public key is a `RestrictedKey` of the contract with `quash = true`.
 * Quashing an already-executed or unknown hash is rejected by the network.
 *
 * Unless both `options.nonce` and `options.feeAmountParts` are set, this
 * function queries the network for the signer's next nonce and the base fee.
 *
 * @param input - Quash parameters (see {@link QuashTXNInput})
 * @param options - Shared standard transaction options
 * @returns The unsigned protobuf `QuashTXN`
 *
 * @throws Error when `contractId` is not a canonical mint ID, `txnHash` is not
 *   a 32-byte hex string, `publicKey` is missing, or any shared option is
 *   invalid.
 *
 * @example
 * ```typescript
 * import { buildQuashTXN } from 'kalvora.js';
 *
 * const txn = await buildQuashTXN(
 *   {
 *     contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
 *     txnHash: '9f2c…64 hex chars…',
 *     publicKey: 'A_<signer base58 public key>'
 *   },
 *   { nonce: 8, feeAmountParts: '1000' } // offline + deterministic
 * );
 * ```
 */
export async function buildQuashTXN(
  input: QuashTXNInput,
  options: QuashTXNOptions = {}
): Promise<QuashTXN> {
  if (input === null || typeof input !== 'object') {
    throw new Error('buildQuashTXN: input object is required');
  }
  const contractId = requireContractId(input.contractId, 'contractId');
  const txnHash = parseHash32(input.txnHash, 'txnHash');

  return buildStandardTransaction({
    operation: 'buildQuashTXN',
    schema: QuashTXNSchema,
    publicKeyId: input.publicKey,
    contractId,
    fields: { contractId, txnHash },
    options
  });
}

/**
 * Build and sign a {@link QuashTXN} with a private key.
 *
 * Equivalent to {@link buildQuashTXN} followed by `signWithKey`. The signer
 * (`input.publicKey`) needs the `quash` permission on the contract.
 *
 * @param input - Quash parameters
 * @param privateKey - Signer's base58 private key (matching `input.publicKey`)
 * @param options - Shared standard transaction options
 * @returns The signed `QuashTXN` (with `base.signature` and `base.hash`)
 *
 * @throws Error when `privateKey` is missing, on any validation error from
 *   {@link buildQuashTXN}, or when signing fails.
 *
 * @example
 * ```typescript
 * const pendingHash = await sendMintTXN(delayedMint);
 * const quash = await createQuashTXN(
 *   { contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', txnHash: pendingHash, publicKey },
 *   privateKey
 * );
 * await sendQuashTXN(quash);
 * ```
 */
export async function createQuashTXN(
  input: QuashTXNInput,
  privateKey: string,
  options: QuashTXNOptions = {}
): Promise<QuashTXN> {
  if (typeof privateKey !== 'string' || privateKey.trim() === '') {
    throw new Error('privateKey is required');
  }
  const txn = await buildQuashTXN(input, options);
  return signWithKey(txn, privateKey, input.publicKey);
}

/**
 * Submit a signed {@link QuashTXN} to the network (`TXNService.Quash`).
 *
 * @param txn - Signed quash transaction (from {@link createQuashTXN})
 * @param grpcConfig - Endpoint configuration (defaults to SDK defaults)
 * @returns Hex transaction hash of the quash transaction itself
 *
 * @throws Error when the transaction is unsigned (missing signature/hash) or
 *   the network rejects it.
 *
 * @example
 * ```typescript
 * const hash = await sendQuashTXN(signed, { host: 'kal-protonet.visiondynamics.ch' });
 * ```
 */
export async function sendQuashTXN(txn: QuashTXN, grpcConfig: GRPCConfig = {}): Promise<string> {
  return submitStandardTransaction(txn, grpcConfig);
}
