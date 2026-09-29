/**
 * Kalvora Transaction Signing
 *
 * All signing workflows for Kalvora transactions in one place.
 *
 * ## Standard Transactions (Vote, Contract, SmartContract)
 * - `signAndFinalize(txn, signer)` — sign with any KalvoraSigner
 * - `signWithKey(txn, privateKey, publicKeyId)` — sign with a private key
 *
 * ## CoinTXN (multi-input)
 * - `signCoinTXN(txn, signers[])` — sign with KalvoraSigner instances
 * - `signCoinTXNWithKeys(txn, keys[])` — sign with private key pairs
 *
 * @module sign/finalize
 */

import { create, toBinary } from '@bufbuild/protobuf';

import { TransferAuthenticationSchema, type BaseTXN, type CoinTXN } from '../../proto/generated/txn_pb.js';
import { getSchemaForTypeName } from '../adapter/serialization.js';
import { signTransactionData, createTransactionHash } from '../shared/crypto/signature-utils.js';

import type { KalvoraSigner } from './signer.js';

// ============================================================================
// INTERNAL HELPER — Generic toBinary using schema registry
// ============================================================================

/**
 * Serialize any protobuf message to binary using its $typeName to look up the schema.
 * Falls back to the v1 .toBinary() instance method if the schema is not found.
 */
function messageToBytes(msg: unknown): Uint8Array {
  const typedMsg = msg as { $typeName?: string; toBinary?: () => Uint8Array };
  if (typedMsg.$typeName) {
    const schema = getSchemaForTypeName(typedMsg.$typeName);
    if (schema) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return toBinary(schema as any, msg as any);
    }
  }
  // Fallback: try v1 instance method
  if (typeof typedMsg.toBinary === 'function') {
    return typedMsg.toBinary();
  }
  throw new Error('Cannot serialize message: no $typeName found and no toBinary method');
}

// ============================================================================
// INTERNAL HELPER — Base envelope preparation
// ============================================================================

/**
 * Return the transaction's `BaseTXN`, cleared of any previous signature and
 * hash so the bytes being signed never include stale signing material
 * (e.g. when a transaction is re-signed after editing).
 *
 * @throws Error if the transaction has no `base` (signing would otherwise be
 *   silently discarded).
 */
function prepareBaseForSigning(txn: { base?: BaseTXN }): BaseTXN {
  if (!txn.base) {
    throw new Error('Cannot sign transaction: it has no base (BaseTXN) envelope');
  }
  delete txn.base.signature;
  delete txn.base.hash;
  return txn.base;
}

// ============================================================================
// STANDARD TRANSACTIONS — External Signer
// ============================================================================

/**
 * Sign and finalize a standard transaction with a `KalvoraSigner`.
 *
 * Works with GovernanceVote, SmartContractExecuteTXN, InstrumentContract,
 * ContractUpdateTXN, and any transaction that uses `BaseTXN`.
 *
 * @example
 * ```typescript
 * const signer = new KeyPairSigner(publicKey, privateKey);
 * const signed = await signAndFinalize(vote, signer);
 * ```
 */
export async function signAndFinalize<T extends { base?: BaseTXN }>(
  txn: T,
  signer: KalvoraSigner
): Promise<T> {
  const baseData = prepareBaseForSigning(txn);
  const bytes = messageToBytes(txn);
  const signature = await signer.sign(bytes);
  baseData.signature = signature;

  const signedBytes = messageToBytes(txn);
  baseData.hash = createTransactionHash(signedBytes);

  return txn;
}

// ============================================================================
// STANDARD TRANSACTIONS — Private Key
// ============================================================================

/**
 * Sign and hash a standard transaction with a private key.
 *
 * Combines signing + hashing in a single call. This is the convenience
 * method used by `createVoteTXN()`, `createContractTXN()`, etc.
 *
 * @example
 * ```typescript
 * const txn = await buildVoteTXN(contractId, proposalId, publicKey);
 * signWithKey(txn, privateKey, publicKeyId);
 * ```
 */
export function signWithKey<T extends { base?: BaseTXN }>(
  txn: T,
  privateKey: string,
  publicKeyId: string
): T {
  // Sign
  const baseData = prepareBaseForSigning(txn);
  const bytes = messageToBytes(txn);
  const signature = signTransactionData(bytes, privateKey, publicKeyId);
  baseData.signature = signature;

  // Hash
  const signedBytes = messageToBytes(txn);
  baseData.hash = createTransactionHash(signedBytes);

  return txn;
}

// ============================================================================
// COIN TXN — External Signer (multi-input)
// ============================================================================

/**
 * Sign a CoinTXN with one or more `KalvoraSigner` instances.
 *
 * Each signer produces a signature. After all signatures are collected,
 * the transaction hash is computed.
 *
 * @example
 * ```typescript
 * const signer = new KeyPairSigner(publicKey, privateKey);
 * const signed = await signCoinTXN(unsigned, [signer]);
 * ```
 */
export async function signCoinTXN(
  txn: CoinTXN,
  signers: KalvoraSigner[]
): Promise<CoinTXN> {
  if (!signers || signers.length === 0) {
    throw new Error('At least one signer is required');
  }

  if (!txn.base) {
    throw new Error('Cannot sign CoinTXN: it has no base (BaseTXN) envelope');
  }
  // A stale hash must never be part of the signed bytes.
  delete txn.base.hash;
  const txnBytes = messageToBytes(txn);

  // Attach the auth container if missing so signatures are never written to
  // a detached object (which would silently leave the transaction unsigned).
  if (!txn.auth) {
    txn.auth = create(TransferAuthenticationSchema, {});
  }
  const authData = txn.auth;
  if (!authData.signature) {
    authData.signature = [];
  }

  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i];
    if (!signer) throw new Error(`Signer at index ${i} is undefined`);

    try {
      const signature = await signer.sign(txnBytes);
      authData.signature.push(signature);
    } catch (error) {
      throw new Error(`Failed to sign with signer ${i}: ${(error as Error).message}`);
    }
  }

  // Hash after all signatures
  const signedBytes = messageToBytes(txn);
  txn.base.hash = createTransactionHash(signedBytes);

  return txn;
}

// ============================================================================
// COIN TXN — Private Keys (multi-input)
// ============================================================================

/** Key pair for CoinTXN signing (one per input) */
export interface CoinTXNKeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * Sign a CoinTXN with private key pairs (one per input).
 *
 * This is the convenience method used by `createCoinTXN()`.
 * Each key pair signs the serialized transaction bytes, and
 * the hash is computed after all signatures are collected.
 *
 * @example
 * ```typescript
 * const txn = await buildCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
 * signCoinTXNWithKeys(txn, [
 *   { publicKey: 'A_abc...', privateKey: '5Jd8...' }
 * ]);
 * ```
 */
export function signCoinTXNWithKeys(
  txn: CoinTXN,
  keys: CoinTXNKeyPair[]
): CoinTXN {
  if (!keys || keys.length === 0) {
    throw new Error('At least one key pair is required');
  }

  if (!txn.base) {
    throw new Error('Cannot sign CoinTXN: it has no base (BaseTXN) envelope');
  }
  // A stale hash must never be part of the signed bytes.
  delete txn.base.hash;
  const txnBytes = messageToBytes(txn);

  // Attach the auth container if missing so signatures are never written to
  // a detached object (which would silently leave the transaction unsigned).
  if (!txn.auth) {
    txn.auth = create(TransferAuthenticationSchema, {});
  }
  const authData = txn.auth;
  if (!authData.signature) {
    authData.signature = [];
  }

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!key) throw new Error(`Key pair at index ${i} is undefined`);
    if (!key.privateKey || !key.publicKey) {
      throw new Error(`Key pair at index ${i} is missing privateKey or publicKey`);
    }

    try {
      const signature = signTransactionData(txnBytes, key.privateKey, key.publicKey);
      authData.signature.push(signature);
    } catch (error) {
      throw new Error(`Failed to sign with key ${i}: ${(error as Error).message}`);
    }
  }

  // Hash after all signatures
  const signedBytes = messageToBytes(txn);
  txn.base.hash = createTransactionHash(signedBytes);

  return txn;
}
