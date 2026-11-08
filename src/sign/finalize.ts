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

import { clone, toBinary, type Message } from '@bufbuild/protobuf';

import { type BaseTXN, type CoinTXN } from '../../proto/generated/txn_pb.js';
import { getSchemaForTypeName } from '../adapter/serialization.js';
import { signTransactionData, createTransactionHash } from '../shared/crypto/signature-utils.js';

import { assertTransactionContext, type TransactionContext } from './context.js';
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
function prepareBaseForSigning(txn: { $typeName?: string; base?: BaseTXN }, context?: TransactionContext): BaseTXN {
  if (!txn.base) {
    throw new Error('Cannot sign transaction: it has no base (BaseTXN) envelope');
  }
  assertTransactionContext(txn, context);
  delete txn.base.signature;
  delete txn.base.hash;
  delete txn.base.feePayer;
  if (txn.base.publicKey?.multi) txn.base.publicKey.multi.signatures = [];
  if (txn.$typeName === 'kal_txn.ValidatorRegistration') {
    (txn as unknown as { generatedSignature: Uint8Array }).generatedSignature = new Uint8Array(0);
  }
  return txn.base;
}

/** Canonical V1 bytes for offline and multisig signers; leaves the input intact. */
export function getTransactionSigningBytes<T extends Message & { base?: BaseTXN }>(txn: T, context?: TransactionContext): Uint8Array {
  const schema = getSchemaForTypeName(txn.$typeName);
  if (!schema) throw new Error(`Unsupported transaction type: ${txn.$typeName}`);
  const copy = clone(schema, txn) as T;
  prepareBaseForSigning(copy, context);
  if (copy.$typeName === 'kal_txn.CoinTXN') {
    const coin = copy as unknown as CoinTXN;
    if (!coin.auth || coin.auth.publicKey.length === 0 || coin.auth.nonce.length !== coin.auth.publicKey.length) {
      throw new Error('CoinTXN auth public keys and nonce slots must be populated before signing');
    }
    coin.auth.signature = [];
    for (const key of coin.auth.publicKey) if (key.multi) key.multi.signatures = [];
  }
  return messageToBytes(copy);
}

/** Sponsor approval covers the user signature plus the sponsor key and nonce. */
export function getSponsorSigningBytes<T extends Message & { base?: BaseTXN }>(txn: T, context?: TransactionContext): Uint8Array {
  assertTransactionContext(txn, context);
  if (['kal_txn.CoinTXN', 'kal_txn.ProposalResult', 'kal_txn.ValidatorRegistration', 'kal_txn.ValidatorHeartbeat'].includes(txn.$typeName)) {
    throw new Error('This transaction type cannot use base.feePayer sponsorship');
  }
  const hasUserSignature = txn.base?.signature?.length || txn.base?.publicKey?.multi?.signatures.some(signature => signature.length > 0);
  if (!txn.base?.feePayer?.publicKey?.single.length || !hasUserSignature) {
    throw new Error('Sponsor signing requires a user-signed transaction and a single-key feePayer with its nonce');
  }
  const schema = getSchemaForTypeName(txn.$typeName);
  if (!schema) throw new Error(`Unsupported transaction type: ${txn.$typeName}`);
  const copy = clone(schema, txn) as T;
  const base = copy.base;
  if (!base?.feePayer) throw new Error('Missing sponsor envelope');
  delete base.hash;
  base.feePayer.signature = new Uint8Array(0);
  return messageToBytes(copy);
}

/** Hash a completed signed message, excluding the hash itself and registration co-signature. */
export function finalizeTransactionHash<T extends Message & { base?: BaseTXN }>(txn: T, context?: TransactionContext): T {
  assertTransactionContext(txn, context);
  const schema = getSchemaForTypeName(txn.$typeName);
  if (!schema) throw new Error(`Unsupported transaction type: ${txn.$typeName}`);
  const copy = clone(schema, txn) as T;
  if (!copy.base || !txn.base) throw new Error('Cannot hash transaction without a base envelope');
  delete copy.base.hash;
  if (copy.$typeName === 'kal_txn.ValidatorRegistration') {
    (copy as unknown as { generatedSignature: Uint8Array }).generatedSignature = new Uint8Array(0);
  }
  txn.base.hash = createTransactionHash(messageToBytes(copy));
  return txn;
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
  signer: KalvoraSigner,
  context?: TransactionContext
): Promise<T> {
  if ((txn as { $typeName?: string }).$typeName === 'kal_txn.CoinTXN') throw new Error('Use signCoinTXN for CoinTXN authorization signatures');
  const baseData = prepareBaseForSigning(txn, context);
  if (baseData.publicKey?.multi) throw new Error('Use getTransactionSigningBytes to collect base multisig signatures');
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
  publicKeyId: string,
  context?: TransactionContext
): T {
  if ((txn as { $typeName?: string }).$typeName === 'kal_txn.CoinTXN') throw new Error('Use signCoinTXNWithKeys for CoinTXN authorization signatures');
  // Sign
  const baseData = prepareBaseForSigning(txn, context);
  if (baseData.publicKey?.multi) throw new Error('Use getTransactionSigningBytes to collect base multisig signatures');
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
  signers: KalvoraSigner[],
  context?: TransactionContext
): Promise<CoinTXN> {
  if (!signers || signers.length === 0) {
    throw new Error('At least one signer is required');
  }

  if (!txn.base) {
    throw new Error('Cannot sign CoinTXN: it has no base (BaseTXN) envelope');
  }
  const txnBytes = getTransactionSigningBytes(txn, context);
  prepareBaseForSigning(txn, context);
  if (!txn.auth) throw new Error('CoinTXN requires authorization slots before signing');
  const authData = txn.auth;
  authData.signature = authData.publicKey.map(() => new Uint8Array(0));
  for (const key of authData.publicKey) if (key.multi) key.multi.signatures = [];
  if (signers.length > authData.publicKey.length) throw new Error('More signers than CoinTXN authorization slots');

  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i];
    if (!signer) throw new Error(`Signer at index ${i} is undefined`);

    try {
      const signature = await signer.sign(txnBytes);
      if (authData.publicKey[i]?.multi) throw new Error('Use getTransactionSigningBytes to collect Coin multisig signatures');
      authData.signature[i] = signature;
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
  keys: CoinTXNKeyPair[],
  context?: TransactionContext
): CoinTXN {
  if (!keys || keys.length === 0) {
    throw new Error('At least one key pair is required');
  }

  if (!txn.base) {
    throw new Error('Cannot sign CoinTXN: it has no base (BaseTXN) envelope');
  }
  const txnBytes = getTransactionSigningBytes(txn, context);
  prepareBaseForSigning(txn, context);
  if (!txn.auth) throw new Error('CoinTXN requires authorization slots before signing');
  const authData = txn.auth;
  authData.signature = authData.publicKey.map(() => new Uint8Array(0));
  for (const key of authData.publicKey) if (key.multi) key.multi.signatures = [];
  if (keys.length > authData.publicKey.length) throw new Error('More keys than CoinTXN authorization slots');

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!key) throw new Error(`Key pair at index ${i} is undefined`);
    if (!key.privateKey || !key.publicKey) {
      throw new Error(`Key pair at index ${i} is missing privateKey or publicKey`);
    }

    try {
      const signature = signTransactionData(txnBytes, key.privateKey, key.publicKey);
      if (authData.publicKey[i]?.multi) throw new Error('Use getTransactionSigningBytes to collect Coin multisig signatures');
      authData.signature[i] = signature;
    } catch (error) {
      throw new Error(`Failed to sign with key ${i}: ${(error as Error).message}`);
    }
  }

  // Hash after all signatures
  const signedBytes = messageToBytes(txn);
  txn.base.hash = createTransactionHash(signedBytes);

  return txn;
}
