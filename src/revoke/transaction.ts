/**
 * Transaction Module - RevokeTXN
 *
 * Builds, signs, and submits Kalvora item revocation transactions. A
 * `RevokeTXN` lets a contract authority forcibly take back a specific
 * NFT / SBT item (identified by `itemId`) from the wallet currently holding it.
 *
 * All envelope handling (nonce, `BaseTXN`, fees) is delegated to the shared
 * standard transaction pipeline in `shared/tx/standard`.
 *
 * @module revoke/transaction
 */

import { RevokeTXNSchema, type RevokeTXN } from '../../proto/generated/txn_pb.js';
import {
  buildStandardTransaction,
  parseAddress,
  requireContractId,
  submitStandardTransaction,
  type StandardTXNOptions
} from '../shared/tx/standard.js';
import { signWithKey } from '../sign/finalize.js';
import type { GRPCConfig } from '../types/index.js';

/**
 * Options accepted by {@link buildRevokeTXN} and {@link createRevokeTXN}.
 *
 * Identical to the shared {@link StandardTXNOptions}. Pass both `nonce` and
 * `feeAmountParts` to build fully offline and deterministically.
 */
export type RevokeTXNOptions = StandardTXNOptions;

/**
 * Readable input for a {@link RevokeTXN}.
 */
export interface RevokeTXNInput {
  /** NFT / SBT contract that issued the item (canonical mint ID, e.g. `KALSBT001`). */
  contractId: string;
  /**
   * Base58 wallet address that currently holds the item and from which it is
   * revoked.
   */
  recipientAddress: string;
  /**
   * Item identifier within the contract, exactly as it was minted (for
   * example `'1'` or `'42'`). Must be non-empty and have no surrounding
   * whitespace.
   */
  itemId: string;
  /**
   * Base58 public key identifier of the signer (e.g. `A_…`). The key must be
   * a restricted key on the contract with the `revoke` permission.
   */
  publicKey: string;
}

function parseItemId(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error('itemId must be a non-empty string');
  }
  if (value.trim() !== value) {
    throw new Error('itemId must not contain leading or trailing whitespace');
  }
  return value;
}

/**
 * Build an **unsigned** {@link RevokeTXN}.
 *
 * On-chain, a revoke transaction removes item `itemId` of `contractId` from
 * `recipientAddress` (typically used for soul-bound tokens, credentials, and
 * licences that the issuer must be able to withdraw). Validators accept it
 * only if the signer's public key is a `RestrictedKey` of the contract with
 * `revoke = true`. With a `time_delay` on that key the revocation is held
 * pending and can be quashed until the delay elapses.
 *
 * Unless both `options.nonce` and `options.feeAmountParts` are set, this
 * function queries the network for the signer's next nonce and the base fee.
 *
 * @param input - Revoke parameters (see {@link RevokeTXNInput})
 * @param options - Shared standard transaction options
 * @returns The unsigned protobuf `RevokeTXN`
 *
 * @throws Error when `contractId` is not a canonical mint ID,
 *   `recipientAddress` is not valid base58, `itemId` is empty or padded with
 *   whitespace, `publicKey` is missing, or any shared option is invalid.
 *
 * @example
 * ```typescript
 * import { buildRevokeTXN } from 'kalvora.js';
 *
 * const txn = await buildRevokeTXN(
 *   {
 *     contractId: 'KALSBT001',
 *     recipientAddress: '<holder base58 address>',
 *     itemId: '17',
 *     publicKey: 'A_<signer base58 public key>'
 *   },
 *   { nonce: 3, feeAmountParts: '1000' } // offline + deterministic
 * );
 * ```
 */
export async function buildRevokeTXN(
  input: RevokeTXNInput,
  options: RevokeTXNOptions = {}
): Promise<RevokeTXN> {
  if (input === null || typeof input !== 'object') {
    throw new Error('buildRevokeTXN: input object is required');
  }
  const contractId = requireContractId(input.contractId, 'contractId');
  const recipientAddress = parseAddress(input.recipientAddress, 'recipientAddress');
  const itemId = parseItemId(input.itemId);

  return buildStandardTransaction({
    operation: 'buildRevokeTXN',
    schema: RevokeTXNSchema,
    publicKeyId: input.publicKey,
    contractId,
    fields: { contractId, recipientAddress, itemId },
    options
  });
}

/**
 * Build and sign a {@link RevokeTXN} with a private key.
 *
 * Equivalent to {@link buildRevokeTXN} followed by `signWithKey`. The signer
 * (`input.publicKey`) needs the `revoke` permission on the contract.
 *
 * @param input - Revoke parameters
 * @param privateKey - Signer's base58 private key (matching `input.publicKey`)
 * @param options - Shared standard transaction options
 * @returns The signed `RevokeTXN` (with `base.signature` and `base.hash`)
 *
 * @throws Error when `privateKey` is missing, on any validation error from
 *   {@link buildRevokeTXN}, or when signing fails.
 *
 * @example
 * ```typescript
 * const signed = await createRevokeTXN(
 *   { contractId: 'KALSBT001', recipientAddress, itemId: '17', publicKey },
 *   privateKey
 * );
 * const hash = await sendRevokeTXN(signed);
 * ```
 */
export async function createRevokeTXN(
  input: RevokeTXNInput,
  privateKey: string,
  options: RevokeTXNOptions = {}
): Promise<RevokeTXN> {
  if (typeof privateKey !== 'string' || privateKey.trim() === '') {
    throw new Error('privateKey is required');
  }
  const txn = await buildRevokeTXN(input, options);
  return signWithKey(txn, privateKey, input.publicKey);
}

/**
 * Submit a signed {@link RevokeTXN} to the network (`TXNService.Revoke`).
 *
 * @param txn - Signed revoke transaction (from {@link createRevokeTXN})
 * @param grpcConfig - Endpoint configuration (defaults to SDK defaults)
 * @returns Hex transaction hash
 *
 * @throws Error when the transaction is unsigned (missing signature/hash) or
 *   the network rejects it.
 *
 * @example
 * ```typescript
 * const hash = await sendRevokeTXN(signed, { host: 'kal-protonet.visiondynamics.ch' });
 * ```
 */
export async function sendRevokeTXN(txn: RevokeTXN, grpcConfig: GRPCConfig = {}): Promise<string> {
  return submitStandardTransaction(txn, grpcConfig);
}
