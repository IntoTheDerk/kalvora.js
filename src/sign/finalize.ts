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

import { clone, create, toBinary, type Message } from '@bufbuild/protobuf';
import bs58 from 'bs58';

import { CoinTXNSchema, FeePayerSchema, WalletWitnessSchema, type BaseTXN, type CoinTXN, type PublicKey, type WalletHash, type WalletPolicy, type WalletRegistration } from '../../proto/generated/txn_pb.js';
import { getSchemaForTypeName } from '../adapter/serialization.js';
import { decodeFalconPublicKey, selectedWalletHash } from '../adapter/signing-account.js';
import { decodeWalletAddress, deriveFalconAddress, falconSignatureSize, falconVariantFromKey } from '../shared/crypto/falcon-address.js';
import { signTransactionData, createTransactionHash } from '../shared/crypto/signature-utils.js';
import { verifyFalconSignature } from '../wallet-creation/falcon.js';
import { derivePolicyAddress } from '../wallet-registration/policy.js';

import { assertTransactionContext, type TransactionContext } from './context.js';
import { allowsFeePayer, assertAuthenticationBudget } from './resources.js';
import type { KalvoraSigner } from './signer.js';

export interface PolicySigner {
  policy: WalletPolicy;
  walletHash: WalletHash;
  /** Participating registered single-key wallets, in ascending permanent slot order. */
  members: readonly { slot: number; signer: KalvoraSigner }[];
}

export type TransactionSigner = KalvoraSigner | PolicySigner;

function signingContext(signer: TransactionSigner, supplied?: TransactionContext): TransactionContext | undefined {
  const pin = 'policy' in signer ? signer.members[0]?.signer.chainId : signer.chainId;
  return supplied ?? (pin ? { chainId: pin } : undefined);
}

function assertUnchanged(a: Uint8Array, b: Uint8Array): void {
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) throw new Error('Signing bytes changed while collecting proofs');
}

async function singleProof(signer: KalvoraSigner, address: Uint8Array, bytes: Uint8Array, chainId: Uint8Array) {
  if (!signer.walletAddress || bs58.encode(address) !== signer.walletAddress) throw new Error('Signer does not control the selected wallet address');
  if (signer.chainId && (signer.chainId.length !== chainId.length || signer.chainId.some((v, i) => v !== chainId[i]))) {
    throw new Error('Signer chainId does not match the transaction');
  }
  const raw = signer.rawPublicKey ?? (signer.publicKey.length >= 897 ? decodeFalconPublicKey(signer.publicKey) : undefined);
  const variant = raw ? falconVariantFromKey(raw) : signer.variant;
  if (signer.variant !== undefined && signer.variant !== variant) throw new Error('Signer variant does not match its Falcon key');
  if (raw) {
    const hash = signer.walletHash ?? selectedWalletHash(raw, signer.walletAddress);
    if (bs58.encode(deriveFalconAddress(raw, hash)) !== signer.walletAddress) throw new Error('Signer key does not match its wallet address');
  }
  const signature = await signer.sign(bytes.slice());
  if (variant === undefined ? signature.length !== 666 && signature.length !== 1280 : signature.length !== falconSignatureSize(variant)) {
    throw new Error('Expected the padded Falcon signature for the selected variant');
  }
  if (raw && !verifyFalconSignature(raw, bytes, signature)) throw new Error('Signer returned an invalid Falcon signature');
  return signature;
}

async function signRegistered(key: PublicKey, signer: TransactionSigner, bytes: Uint8Array, chainId: Uint8Array) {
  if (!key.walletAddress || key.single.length || key.multi || key.governanceAuth || key.smartContractAuth || key.parentContract !== undefined) {
    throw new Error('Expected a registered wallet address identity');
  }
  if (!('policy' in signer)) return { signature: await singleProof(signer, key.walletAddress, bytes, chainId), witnesses: [] };
  const { policy, walletHash, members } = signer;
  if (bs58.encode(derivePolicyAddress(policy, walletHash)) !== bs58.encode(key.walletAddress)) throw new Error('Policy does not match signer address');
  const votes = new Map<number, number>();
  let previous = -1;
  for (const { slot } of members) {
    const member = policy.members[slot];
    if (!Number.isInteger(slot) || slot <= previous || !member) throw new Error('Policy slots must be distinct and strictly increasing');
    votes.set(member.classId, (votes.get(member.classId) ?? 0) + 1);
    previous = slot;
  }
  if (!policy.patterns.some(p => p.thresholds.every(t => (votes.get(t.classId) ?? 0) >= t.required))) {
    throw new Error('Selected witnesses do not satisfy a policy pattern');
  }
  const witnesses = await Promise.all(members.map(async ({ slot, signer: memberSigner }) => {
    const member = policy.members[slot];
    if (!member) throw new Error('Unknown policy member slot');
    return create(WalletWitnessSchema, { slot, signature: await singleProof(memberSigner, member.walletAddress, bytes, chainId) });
  }));
  return { signature: undefined, witnesses };
}

/** Attach a sponsor's proof after the owner's single signature or policy witnesses. */
export async function countersignTransaction<T extends Message & { base?: BaseTXN }>(
  txn: T, sponsor: KalvoraSigner, nonce: bigint, context?: TransactionContext
): Promise<T> {
  if (!sponsor.walletAddress || !txn.base?.publicKey?.walletAddress) throw new Error('Sponsorship requires registered wallet identities');
  if (bs58.encode(txn.base.publicKey.walletAddress) === sponsor.walletAddress) throw new Error('Sponsor must differ from the owner');
  if (nonce <= 0n || nonce > 0xffffffffffffffffn) throw new Error('Sponsor nonce must be a positive uint64');
  const selected = signingContext(sponsor, context);
  const schema = getSchemaForTypeName(txn.$typeName);
  if (!schema) throw new Error('Unsupported sponsored transaction');
  const original = toBinary(schema, txn);
  const copy = clone(schema, txn) as T;
  const address = decodeWalletAddress(sponsor.walletAddress);
  const feePayer = create(FeePayerSchema, { publicKey: { walletAddress: address }, nonce });
  if (!copy.base) throw new Error('Missing sponsor base envelope');
  copy.base.feePayer = feePayer;
  const bytes = getSponsorSigningBytes(copy, selected);
  feePayer.signature = await singleProof(sponsor, address, bytes, copy.base.chainId);
  assertUnchanged(original, toBinary(schema, txn));
  finalizeTransactionHash(copy, selected);
  if (!copy.base.hash) throw new Error('Missing signed transaction hash');
  txn.base.feePayer = feePayer;
  txn.base.hash = copy.base.hash;
  return txn;
}

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
  if (txn.base.publicKey) txn.base.publicKey.witnesses = [];
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
    for (const key of coin.auth.publicKey) {
      key.witnesses = [];
      if (key.multi) key.multi.signatures = [];
    }
  }
  if (copy.base?.publicKey?.walletAddress) assertAuthenticationBudget(copy);
  return messageToBytes(copy);
}

/** Sponsor approval covers the user signature plus the sponsor key and nonce. */
export function getSponsorSigningBytes<T extends Message & { base?: BaseTXN }>(txn: T, context?: TransactionContext): Uint8Array {
  assertTransactionContext(txn, context);
  if (!allowsFeePayer(txn.$typeName)) {
    throw new Error('This transaction type cannot use base.feePayer sponsorship');
  }
  const hasUserSignature = txn.base?.signature?.length || txn.base?.publicKey?.witnesses.length || txn.base?.publicKey?.multi?.signatures.some(signature => signature.length > 0);
  const payer = txn.base?.feePayer;
  if (txn.base?.publicKey?.walletAddress) {
    const key = payer?.publicKey;
    if (!key?.walletAddress || key.single.length || key.multi || key.governanceAuth || key.smartContractAuth || key.parentContract !== undefined ||
        bs58.encode(key.walletAddress) === bs58.encode(txn.base.publicKey.walletAddress)) {
      throw new Error('Sponsor must use a distinct registered single-key wallet address');
    }
  }
  if (!(payer?.publicKey?.walletAddress?.length || payer?.publicKey?.single.length) || !hasUserSignature || payer.nonce <= 0n || payer.publicKey.witnesses.length) {
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

/** Hash a completed transaction with every proof in place. */
export function finalizeTransactionHash<T extends Message & { base?: BaseTXN }>(txn: T, context?: TransactionContext): T {
  assertTransactionContext(txn, context);
  const schema = getSchemaForTypeName(txn.$typeName);
  if (!schema) throw new Error(`Unsupported transaction type: ${txn.$typeName}`);
  const copy = clone(schema, txn) as T;
  if (!copy.base || !txn.base) throw new Error('Cannot hash transaction without a base envelope');
  delete copy.base.hash;
  const hash = createTransactionHash(messageToBytes(copy));
  copy.base.hash = hash;
  if (copy.base.publicKey?.walletAddress) assertAuthenticationBudget(copy);
  txn.base.hash = hash;
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
  signer: TransactionSigner,
  context?: TransactionContext
): Promise<T> {
  if ((txn as { $typeName?: string }).$typeName === 'kal_txn.CoinTXN') throw new Error('Use signCoinTXN for CoinTXN authorization signatures');
  const selected = signingContext(signer, context);
  if (txn.base?.publicKey?.walletAddress) {
    const message = txn as T & Message;
    const schema = getSchemaForTypeName(message.$typeName);
    if (!schema) throw new Error('Unsupported transaction type');
    const copy = clone(schema, message) as T & Message;
    const bytes = getTransactionSigningBytes(message, selected);
    const original = toBinary(schema, message);
    const base = prepareBaseForSigning(copy, selected);
    if (!base.publicKey) throw new Error('Missing signer identity');
    const proof = await signRegistered(base.publicKey, signer, bytes, base.chainId);
    if (message.$typeName === 'kal_txn.WalletRegistration') {
      const registration = copy as unknown as WalletRegistration;
      const identity = registration.identity;
      if (identity.case === 'falcon') {
        const { rawPublicKey, variant } = identity.value;
        if (variant !== falconVariantFromKey(rawPublicKey) || !proof.signature ||
            bs58.encode(deriveFalconAddress(rawPublicKey, registration.walletHash)) !== bs58.encode(base.publicKey.walletAddress ?? new Uint8Array()) ||
            !verifyFalconSignature(rawPublicKey, bytes, proof.signature)) throw new Error('Invalid single-key registration proof');
      } else if (identity.case !== 'policy' || !proof.witnesses.length ||
          bs58.encode(derivePolicyAddress(identity.value, registration.walletHash)) !== bs58.encode(base.publicKey.walletAddress ?? new Uint8Array())) {
        throw new Error('Invalid policy registration proof');
      }
    }
    if (proof.signature) base.signature = proof.signature;
    base.publicKey.witnesses = proof.witnesses;
    finalizeTransactionHash(copy, selected);
    assertUnchanged(original, toBinary(schema, message));
    Object.assign(txn, copy);
    return txn;
  }
  if ('policy' in signer || signer.walletAddress) throw new Error('Registered signer requires a wallet address in the transaction');
  const baseData = prepareBaseForSigning(txn, selected);
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
  if (txn.base?.publicKey?.walletAddress) throw new Error('Use signAndFinalize with a registered Falcon signer');
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
  signers: TransactionSigner[],
  context?: TransactionContext
): Promise<CoinTXN> {
  if (!signers || signers.length === 0) {
    throw new Error('At least one signer is required');
  }

  if (!txn.base) {
    throw new Error('Cannot sign CoinTXN: it has no base (BaseTXN) envelope');
  }
  const first = signers[0];
  if (!first) throw new Error('Signer at index 0 is undefined');
  const selected = signingContext(first, context);
  const txnBytes = getTransactionSigningBytes(txn, selected);
  if (txn.auth?.publicKey.some(key => key.walletAddress)) {
    if (txn.base.feePayer) throw new Error('Coin sponsorship uses a zero-amount authorization input');
    if (signers.length !== txn.auth.publicKey.length) throw new Error('Coin requires one signer per authorization slot');
    const copy = clone(CoinTXNSchema, txn);
    const original = toBinary(CoinTXNSchema, txn);
    const chainId = prepareBaseForSigning(copy, selected).chainId;
    const auth = copy.auth;
    if (!auth) throw new Error('Coin requires authorization slots');
    const proofs = await Promise.all(auth.publicKey.map((key, i) => {
      const signer = signers[i];
      if (!signer) throw new Error(`Missing signer at index ${i}`);
      return signRegistered(key, signer, txnBytes, chainId);
    }));
    auth.signature = proofs.map(proof => proof.signature ?? new Uint8Array());
    auth.publicKey.forEach((key, i) => { key.witnesses = proofs[i]?.witnesses ?? []; });
    finalizeTransactionHash(copy, selected);
    assertUnchanged(original, toBinary(CoinTXNSchema, txn));
    Object.assign(txn, copy);
    return txn;
  }
  prepareBaseForSigning(txn, context);
  if (!txn.auth) throw new Error('CoinTXN requires authorization slots before signing');
  const authData = txn.auth;
  authData.signature = authData.publicKey.map(() => new Uint8Array(0));
  for (const key of authData.publicKey) if (key.multi) key.multi.signatures = [];
  if (signers.length > authData.publicKey.length) throw new Error('More signers than CoinTXN authorization slots');

  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i];
    if (!signer) throw new Error(`Signer at index ${i} is undefined`);
    if ('policy' in signer || signer.walletAddress) throw new Error('Registered Coin signers require wallet addresses in authorization slots');

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
  if (txn.auth?.publicKey.some(key => key.walletAddress)) throw new Error('Use signCoinTXN with registered Falcon signers');
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
