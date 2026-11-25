/** Registered validator owner assignments and operational heartbeats. */
import { clone, create, toBinary } from '@bufbuild/protobuf';

import {
  AttestationKeySchema, PublicKeySchema, ValidatorHeartbeatSchema, ValidatorRegistrationSchema, ValidatorSchema,
  type AttestationKey, type BaseTXN, type PublicKey, type Validator, type ValidatorHeartbeat, type ValidatorRegistration
} from '../../proto/generated/txn_pb.js';
import { ValidatorService } from '../../proto/generated/validator_pb.js';
import { createClient } from '../grpc/client-factory.js';
import { decodeWalletAddress, deriveFalconAddress, falconVariantFromKey, isWalletAddress, isWalletAddressBytes } from '../shared/crypto/falcon-address.js';
import { KALVORA_NATIVE_TOKEN } from '../shared/network/constants.js';
import { getAddressAndNonce } from '../shared/tx/base.js';
import { buildStandardTransaction, parseUint64, toTimestampInit, type StandardTXNOptions } from '../shared/tx/standard.js';
import { bytesEqual, bytesToHex } from '../shared/utils/byte-utils.js';
import { assertTransactionContext } from '../sign/context.js';
import { finalizeTransactionHash, getTransactionSigningBytes, signAndFinalize } from '../sign/finalize.js';
import { assertRegisteredSubmission } from '../sign/resources.js';
import type { KalvoraSigner } from '../sign/signer.js';
import type { GRPCConfig } from '../types/index.js';
import { verifyFalconSignature } from '../wallet-creation/falcon.js';

export type ValidatorOpsTXNOptions = StandardTXNOptions;
export type ValidatorWalletSigner = Required<KalvoraSigner>;
type ValidatorWalletIdentity = Pick<ValidatorWalletSigner, 'walletAddress' | 'rawPublicKey' | 'walletHash' | 'chainId'> &
  Partial<Pick<ValidatorWalletSigner, 'variant'>>;

/** BLS12-381 attestation key and proof supplied by the validator operator. */
export interface AttestationKeyInput {
  /** Version of this attestation key (uint64). */
  version: string | number | bigint;
  /** Compressed BLS12-381 G1 public key, 48 bytes. */
  publicKey: Uint8Array;
  /** BLS12-381 G2 proof of possession, 96 bytes. */
  proofOfPossession: Uint8Array;
}

/**
 * Readable input for the `kal_txn.Validator` record embedded in a
 * {@link ValidatorRegistration}.
 */
export interface ValidatorInfoInput {
  /**
   * Registered owner address. Defaults to the owner in the registration envelope.
   */
  publicKey?: string;
  /** Hostname or IP address the node is reachable at. Non-empty, no whitespace. */
  host: string;
  /** Client-facing port, `1`–`65535`, as a numeric string or integer. */
  clientPort: string | number;
  /** Validator-to-validator port, `1`–`65535`, as a numeric string or integer. */
  validatorPort: string | number;
  /**
   * @deprecated Removed from the protocol: `Validator.staked_contract_ids`
   * (field 5) is reserved because staking is KALV-only. Supplying any value
   * throws so that callers migrating from 0.1.x do not silently lose it.
   */
  stakedContractIds?: never;
  /** Node benchmark score (uint64). Defaults to `0`. */
  benchmark?: string | number | bigint;
  /** Record timestamp. Defaults to `new Date()` at build time. */
  timestamp?: Date;
  /** Whether the node runs in lite mode. Defaults to `false`. */
  lite?: boolean;
  /** Whether the node reports itself online. Defaults to `false`. */
  online?: boolean;
  /** Node software version (uint32). Defaults to `0`. */
  version?: number;
  /** Last heartbeat marker (uint64). Defaults to `0`. */
  lastHeartbeat?: string | number | bigint;
  /** Attestation key material for consensus participation. */
  attestationKey?: AttestationKeyInput;
}

/**
 * Readable input for a {@link ValidatorRegistration}.
 */
export interface ValidatorRegistrationInput {
  /** Registered owner address. */
  publicKey: string;
  /** The validator node record. */
  validator: ValidatorInfoInput;
  /** `true` to register the node, `false` to deregister it. */
  register: boolean;
  /**
   * Registered operational wallet address. Omit for deregistration.
   */
  generatedPublicKey?: string;
}

export interface ValidatorHeartbeatInput {
  /** Operational wallet named in the signed heartbeat. */
  publicKey: string;
  /** Owner of the stake. Its nonce is consumed and its balance pays the fee. */
  ownerAddress: string;
  online: boolean;
  version: number;
}

const UINT32_MAX = 0xFFFF_FFFF;

function requireObject(value: unknown, message: string): void {
  if (value === null || typeof value !== 'object') {
    throw new Error(message);
  }
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function parseHost(value: unknown): string {
  if (typeof value !== 'string' || !/^\S+$/u.test(value)) {
    throw new Error('validator.host must be a non-empty string without whitespace');
  }
  return value;
}

function parsePort(value: unknown, field: string): string {
  let digits: string | undefined;
  if (typeof value === 'number' && Number.isInteger(value)) digits = String(value);
  else if (typeof value === 'string' && /^\d{1,5}$/u.test(value)) digits = value;
  const port = digits === undefined ? Number.NaN : Number(digits);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${field} must be a port number between 1 and 65535`);
  }
  return String(port);
}

function parseUint32(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Error(`${field} must be an unsigned 32-bit integer`);
  }
  return value;
}

function rejectStakedContractIds(value: unknown): void {
  if (value !== undefined) {
    throw new Error(
      'validator.stakedContractIds is no longer part of the Kalvora protocol ' +
      '(Validator field 5 is reserved; staking is KALV-only) - remove it'
    );
  }
}

function requirePublicKeyId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} identifier is required`);
  }
  if (!isWalletAddress(value)) {
    throw new Error(`${field} is not a valid registered-wallet address`);
  }
  return value;
}

function buildAttestationKey(input: AttestationKeyInput): AttestationKey {
  requireObject(input, 'validator.attestationKey must be an object');
  if (!(input.publicKey instanceof Uint8Array) || input.publicKey.length !== 48) {
    throw new Error('validator.attestationKey.publicKey must be 48 bytes');
  }
  if (!(input.proofOfPossession instanceof Uint8Array) || input.proofOfPossession.length !== 96) {
    throw new Error('validator.attestationKey.proofOfPossession must be 96 bytes');
  }
  return create(AttestationKeySchema, {
    version: parseUint64(input.version, 'validator.attestationKey.version'),
    publicKey: input.publicKey.slice(),
    proofOfPossession: input.proofOfPossession.slice()
  });
}

function buildValidatorRecord(input: ValidatorInfoInput, operatorPublicKey: string): Validator {
  requireObject(input, 'validator object is required');
  const publicKeyId = requirePublicKeyId(input.publicKey ?? operatorPublicKey, 'validator.publicKey');
  if (publicKeyId !== operatorPublicKey) throw new Error('validator.publicKey must match the owner address');
  rejectStakedContractIds((input as { stakedContractIds?: unknown }).stakedContractIds);
  return create(ValidatorSchema, {
    publicKey: { walletAddress: decodeWalletAddress(publicKeyId) },
    host: parseHost(input.host),
    clientPort: parsePort(input.clientPort, 'validator.clientPort'),
    validatorPort: parsePort(input.validatorPort, 'validator.validatorPort'),
    benchmark: input.benchmark === undefined ? 0n : parseUint64(input.benchmark, 'validator.benchmark'),
    timestamp: toTimestampInit(input.timestamp ?? new Date(), 'validator.timestamp'),
    lite: input.lite === undefined ? false : requireBoolean(input.lite, 'validator.lite'),
    online: input.online === undefined ? false : requireBoolean(input.online, 'validator.online'),
    version: input.version === undefined ? 0 : parseUint32(input.version, 'validator.version'),
    lastHeartbeat: input.lastHeartbeat === undefined
      ? 0n
      : parseUint64(input.lastHeartbeat, 'validator.lastHeartbeat'),
    ...(input.attestationKey !== undefined ? { attestationKey: buildAttestationKey(input.attestationKey) } : {})
  });
}

function requireSigned(txn: { base?: BaseTXN } | null | undefined): BaseTXN & { hash: Uint8Array } {
  const base = txn?.base;
  if (!base?.signature || base.signature.length === 0 || !base.hash || base.hash.length === 0) {
    throw new Error('Transaction must be signed before submission (missing signature or hash)');
  }
  return base as BaseTXN & { hash: Uint8Array };
}

export async function buildValidatorRegistrationTXN(
  input: ValidatorRegistrationInput, options: ValidatorOpsTXNOptions = {}
): Promise<ValidatorRegistration> {
  requireObject(input, 'buildValidatorRegistrationTXN: input object is required');
  const owner = requirePublicKeyId(input.publicKey, 'publicKey');
  const register = requireBoolean(input.register, 'register');
  const validator = buildValidatorRecord(input.validator, owner);
  if (options.feeId !== undefined && options.feeId !== KALVORA_NATIVE_TOKEN) throw new Error('Validator registration feeId must be native KALV');
  if (options.proofLayout?.sponsor) throw new Error('Validator registration cannot be sponsored');
  const operator = register ? requirePublicKeyId(input.generatedPublicKey, 'generatedPublicKey') : undefined;
  if (!register && input.generatedPublicKey !== undefined) throw new Error('Deregistration must omit the generated public key');
  if (operator === owner) throw new Error('Owner and operator must use distinct wallets');
  return buildStandardTransaction({
    operation: 'buildValidatorRegistrationTXN', schema: ValidatorRegistrationSchema, publicKeyId: owner,
    fields: { validator, register, ...(operator && { generatedPublicKey: { walletAddress: decodeWalletAddress(operator) } }) },
    options
  });
}

function checkSigner(signer: ValidatorWalletIdentity, address: Uint8Array | undefined): void {
  if (!Number.isInteger(signer.walletHash) || !(signer.chainId instanceof Uint8Array) || signer.chainId.length !== 32 ||
      (signer.variant !== undefined && signer.variant !== falconVariantFromKey(signer.rawPublicKey))) {
    throw new Error('Invalid validator wallet signer metadata');
  }
  if (!address || !bytesEqual(address, decodeWalletAddress(signer.walletAddress)) ||
      !bytesEqual(address, deriveFalconAddress(signer.rawPublicKey, signer.walletHash))) {
    throw new Error('Signer does not match the registered wallet address');
  }
}

function singleAddress(key?: PublicKey): Uint8Array {
  const address = key?.walletAddress;
  if (!key || !address || !isWalletAddressBytes(address) ||
      !bytesEqual(toBinary(PublicKeySchema, key), toBinary(PublicKeySchema, create(PublicKeySchema, { walletAddress: address })))) {
    throw new Error('Validator roles require registered single-key wallet addresses without witnesses');
  }
  return address;
}

function checkAssignment(txn: ValidatorRegistration): void {
  const owner = singleAddress(txn.base?.publicKey);
  if (!bytesEqual(owner, singleAddress(txn.validator?.publicKey))) throw new Error('Validator owner identities differ');
  if (txn.base?.feePayer || txn.base?.feeId !== KALVORA_NATIVE_TOKEN || txn.base.nonce <= 0n) {
    throw new Error('Validator registration requires native KALV, a positive owner nonce and no sponsor');
  }
  if (txn.register) {
    if (bytesEqual(owner, singleAddress(txn.generatedPublicKey))) throw new Error('Owner and operator must use distinct wallets');
  } else if (txn.generatedPublicKey || txn.generatedSignature.length) {
    throw new Error('Deregistration must omit the operational key and proof');
  }
}

/** Verify the owner's approval, sign the same assignment bytes, then hash both proofs. */
export async function attachGeneratedSignature(
  txn: ValidatorRegistration, owner: ValidatorWalletIdentity, operator: ValidatorWalletSigner
): Promise<ValidatorRegistration> {
  if (!txn.register || !txn.base?.signature || txn.base.feePayer) throw new Error('Expected an owner-signed, unsponsored assignment');
  checkAssignment(txn);
  if (bytesEqual(owner.rawPublicKey, operator.rawPublicKey)) throw new Error('Owner and operator must use distinct underlying keys');
  checkSigner(owner, txn.base.publicKey?.walletAddress);
  checkSigner(operator, txn.generatedPublicKey?.walletAddress);
  assertTransactionContext(txn, { chainId: owner.chainId });
  const context = { chainId: operator.chainId };
  const bytes = getTransactionSigningBytes(txn, context);
  const ownerProof = txn.base.signature.slice();
  if (!verifyFalconSignature(owner.rawPublicKey, bytes, ownerProof)) throw new Error('Invalid owner signature');
  const original = toBinary(ValidatorRegistrationSchema, txn);
  const signature = await operator.sign(bytes.slice());
  if (!bytesEqual(original, toBinary(ValidatorRegistrationSchema, txn))) throw new Error('Assignment changed while signing');
  if (!verifyFalconSignature(operator.rawPublicKey, bytes, signature)) throw new Error('Invalid operator signature');
  const completed = clone(ValidatorRegistrationSchema, txn);
  completed.generatedSignature = signature;
  finalizeTransactionHash(completed, context);
  assertRegisteredSubmission(completed);
  return Object.assign(txn, completed);
}

/** Build an assignment with both proofs, or an owner-only deregistration. */
export async function createValidatorRegistrationTXN(
  input: ValidatorRegistrationInput, owner: ValidatorWalletSigner, operator?: ValidatorWalletSigner,
  options: ValidatorOpsTXNOptions = {}
): Promise<ValidatorRegistration> {
  if (input.register !== Boolean(operator)) throw new Error('Supply an operational signer only for an assignment');
  if (operator && input.generatedPublicKey !== undefined && input.generatedPublicKey !== operator.walletAddress) throw new Error('Operational wallet mismatch');
  const txn = await buildValidatorRegistrationTXN({ ...input, ...(operator && { generatedPublicKey: operator.walletAddress }) }, {
    ...options, grpcConfig: { transactionContext: { chainId: owner.chainId }, ...options.grpcConfig },
    proofLayout: { ...options.proofLayout, owner: owner.variant, ...(operator && { operator: operator.variant }) }
  });
  checkSigner(owner, txn.base?.publicKey?.walletAddress);
  await signAndFinalize(txn, owner);
  return operator ? attachGeneratedSignature(txn, owner, operator) : txn;
}

export async function sendValidatorRegistrationTXN(txn: ValidatorRegistration, grpcConfig: GRPCConfig = {}): Promise<string> {
  const signed = clone(ValidatorRegistrationSchema, txn);
  const base = requireSigned(signed);
  if (signed.register ? !signed.generatedPublicKey || !signed.generatedSignature.length : signed.generatedPublicKey || signed.generatedSignature.length) {
    throw new Error('Invalid generated key or signature for the registration operation');
  }
  if (grpcConfig.transactionContext) assertTransactionContext(signed, grpcConfig.transactionContext);
  if (grpcConfig.transactionContext || base.publicKey?.walletAddress || signed.validator?.publicKey?.walletAddress || signed.generatedPublicKey?.walletAddress) {
    checkAssignment(signed);
    if (signed.register && signed.generatedSignature.length !== 666 && signed.generatedSignature.length !== 1280) throw new Error('Expected a padded operational signature');
    assertRegisteredSubmission(signed);
  }
  await createClient(ValidatorService, grpcConfig).validatorRegistration(signed);
  return bytesToHex(base.hash);
}

export async function buildValidatorHeartbeatTXN(
  input: ValidatorHeartbeatInput, options: ValidatorOpsTXNOptions = {}
): Promise<ValidatorHeartbeat> {
  requireObject(input, 'buildValidatorHeartbeatTXN: input object is required');
  const operator = requirePublicKeyId(input.publicKey, 'publicKey');
  const owner = requirePublicKeyId(input.ownerAddress, 'ownerAddress');
  if (owner === operator) throw new Error('Owner and operator must use distinct wallets');
  const online = requireBoolean(input.online, 'online');
  const version = parseUint32(input.version, 'version');
  if (new TextEncoder().encode(options.memo).length > 64) throw new Error('Heartbeat memo exceeds 64 bytes');
  if (options.interfaceFee !== undefined || options.interfaceAddress !== undefined || options.interfaceFeeId !== undefined || options.proofLayout?.sponsor) {
    throw new Error('Heartbeat cannot carry a sponsor or interface fee');
  }
  const nonce = options.nonce ?? (await getAddressAndNonce(owner, options.grpcConfig)).nonce;
  return buildStandardTransaction({
    operation: 'buildValidatorHeartbeatTXN', schema: ValidatorHeartbeatSchema, publicKeyId: operator,
    fields: { online, version }, options: { ...options, nonce }
  });
}

function checkHeartbeat(txn: ValidatorHeartbeat): void {
  const base = requireSigned(txn);
  if (base.feePayer || base.interfaceFee !== undefined || base.interfaceFeeId !== undefined || base.interfaceAddress !== undefined ||
      new TextEncoder().encode(base.memo).length > 64 || toBinary(ValidatorHeartbeatSchema, txn).length > 4096) {
    throw new Error('Heartbeat exceeds its signed size or memo limit, or includes prohibited fee fields');
  }
}

export async function createValidatorHeartbeatTXN(
  input: ValidatorHeartbeatInput, operator: ValidatorWalletSigner, options: ValidatorOpsTXNOptions = {}
): Promise<ValidatorHeartbeat> {
  const txn = await buildValidatorHeartbeatTXN(input, {
    ...options, grpcConfig: { transactionContext: { chainId: operator.chainId }, ...options.grpcConfig },
    proofLayout: { ...options.proofLayout, owner: operator.variant }
  });
  checkSigner(operator, txn.base?.publicKey?.walletAddress);
  await signAndFinalize(txn, operator);
  checkHeartbeat(txn);
  return txn;
}

export async function sendValidatorHeartbeatTXN(txn: ValidatorHeartbeat, grpcConfig: GRPCConfig = {}): Promise<string> {
  const signed = clone(ValidatorHeartbeatSchema, txn);
  checkHeartbeat(signed);
  if (grpcConfig.transactionContext) assertTransactionContext(signed, grpcConfig.transactionContext);
  if (grpcConfig.transactionContext || signed.base?.publicKey?.walletAddress) {
    singleAddress(signed.base?.publicKey);
    if (!signed.base?.nonce) throw new Error('A heartbeat requires the next positive owner nonce');
    assertRegisteredSubmission(signed);
  }
  await createClient(ValidatorService, grpcConfig).validatorHeartbeat(signed);
  return bytesToHex(requireSigned(signed).hash);
}
