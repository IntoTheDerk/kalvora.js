/**
 * Transaction Module - MintTXN
 *
 * Builds, signs, and submits Kalvora token mint transactions. A `MintTXN`
 * creates new supply of a fungible token contract and credits it to a
 * recipient wallet (rpc `TXNService.Mint`).
 *
 * All envelope handling (nonce, `BaseTXN`, fees) is delegated to the shared
 * standard transaction pipeline in `shared/tx/standard`.
 *
 * @module mint/transaction
 */

import { MintTXNSchema, type MintTXN } from '../../proto/generated/txn_pb.js';
import {
  buildStandardTransaction,
  parseAddress,
  parsePartsAmount,
  requireContractId,
  submitStandardTransaction,
  type StandardTXNOptions
} from '../shared/tx/standard.js';
import { signWithKey } from '../sign/finalize.js';
import type { GRPCConfig } from '../types/index.js';

/**
 * Options accepted by {@link buildMintTXN} and {@link createMintTXN}.
 *
 * Identical to the shared {@link StandardTXNOptions}. Pass both `nonce` and
 * `feeAmountParts` to build fully offline and deterministically.
 */
export type MintTXNOptions = StandardTXNOptions;

/**
 * Readable input for a {@link MintTXN}.
 */
export interface MintTXNInput {
  /**
   * Token contract to mint from (canonical Kalvora mint ID, e.g. `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao`).
   * The contract must allow minting and must not exceed its max supply.
   */
  contractId: string;
  /**
   * Amount to mint in the token's **smallest units ("parts")**, as a
   * non-negative integer string, safe-integer number, or bigint. Must be > 0.
   *
   * This builder deliberately does not accept whole-token amounts, to avoid
   * a denomination lookup. Convert first with `toSmallestUnits`, e.g.
   * `toSmallestUnits('1.5', 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', { denomination })`.
   */
  amount: string | number | bigint;
  /** Base58 wallet address that receives the newly minted tokens. */
  recipientAddress: string;
  /**
   * Base58 public key identifier of the signer (e.g. `A_…`). The key must be
   * a restricted key on the contract with the `mint` permission.
   */
  publicKey: string;
}

/**
 * Build an **unsigned** {@link MintTXN}.
 *
 * On-chain, a mint transaction increases the circulating supply of
 * `contractId` by `amount` parts and credits them to `recipientAddress`.
 * Validators accept it only if the signer's public key is a `RestrictedKey`
 * of the contract with `mint = true` (restricted keys with a `time_delay`
 * cause the mint to be held pending and quashable until the delay elapses).
 *
 * Unless both `options.nonce` and `options.feeAmountParts` are set, this
 * function queries the network for the signer's next nonce and the base fee.
 *
 * @param input - Mint parameters (see {@link MintTXNInput})
 * @param options - Shared standard transaction options
 * @returns The unsigned protobuf `MintTXN`
 *
 * @throws Error when `contractId` is not a canonical mint ID, `amount` is not a
 *   positive integer, `recipientAddress` is not valid base58, `publicKey` is
 *   missing, or any shared option (fee ID, interface fee, …) is invalid.
 *
 * @example
 * ```typescript
 * import { buildMintTXN } from 'kalvora.js';
 *
 * const txn = await buildMintTXN(
 *   {
 *     contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
 *     amount: '2500000000', // parts
 *     recipientAddress: '<recipient base58 address>',
 *     publicKey: 'A_<signer base58 public key>'
 *   },
 *   { nonce: 12, feeAmountParts: '1000' } // offline + deterministic
 * );
 * ```
 */
export async function buildMintTXN(
  input: MintTXNInput,
  options: MintTXNOptions = {}
): Promise<MintTXN> {
  if (input === null || typeof input !== 'object') {
    throw new Error('buildMintTXN: input object is required');
  }
  const contractId = requireContractId(input.contractId, 'contractId');
  const amount = parsePartsAmount(input.amount, 'amount');
  const recipientAddress = parseAddress(input.recipientAddress, 'recipientAddress');

  return buildStandardTransaction({
    operation: 'buildMintTXN',
    schema: MintTXNSchema,
    publicKeyId: input.publicKey,
    contractId,
    fields: { contractId, amount, recipientAddress },
    options
  });
}

/**
 * Build and sign a {@link MintTXN} with a private key.
 *
 * Equivalent to {@link buildMintTXN} followed by `signWithKey`. The returned
 * transaction has `base.signature` and `base.hash` populated and is ready for
 * {@link sendMintTXN}.
 *
 * The signer (`input.publicKey`) needs the `mint` permission on the contract.
 *
 * @param input - Mint parameters
 * @param privateKey - Signer's base58 private key (matching `input.publicKey`)
 * @param options - Shared standard transaction options
 * @returns The signed `MintTXN`
 *
 * @throws Error when `privateKey` is missing, on any validation error from
 *   {@link buildMintTXN}, or when signing fails.
 *
 * @example
 * ```typescript
 * const signed = await createMintTXN(
 *   { contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', amount: 1_000_000n, recipientAddress, publicKey },
 *   privateKey
 * );
 * const hash = await sendMintTXN(signed);
 * ```
 */
export async function createMintTXN(
  input: MintTXNInput,
  privateKey: string,
  options: MintTXNOptions = {}
): Promise<MintTXN> {
  if (typeof privateKey !== 'string' || privateKey.trim() === '') {
    throw new Error('privateKey is required');
  }
  const txn = await buildMintTXN(input, options);
  return signWithKey(txn, privateKey, input.publicKey);
}

/**
 * Submit a signed {@link MintTXN} to the network (`TXNService.Mint`).
 *
 * @param txn - Signed mint transaction (from {@link createMintTXN})
 * @param grpcConfig - Endpoint configuration (defaults to SDK defaults)
 * @returns Hex transaction hash
 *
 * @throws Error when the transaction is unsigned (missing signature/hash) or
 *   the network rejects it.
 *
 * @example
 * ```typescript
 * const hash = await sendMintTXN(signed, { host: 'kal-protonet.visiondynamics.ch' });
 * ```
 */
export async function sendMintTXN(txn: MintTXN, grpcConfig: GRPCConfig = {}): Promise<string> {
  return submitStandardTransaction(txn, grpcConfig);
}
