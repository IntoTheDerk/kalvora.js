/**
 * Transaction Module - Validator Operator Transactions
 *
 * Builds, signs, and submits the two transactions a validator *operator*
 * sends to the network about their own node:
 *
 * - `ValidatorRegistration` — register (or deregister) a validator node.
 *   Carries the node's {@link Validator} record plus a second, node-generated
 *   key pair that co-signs the transaction hash.
 * - `ValidatorHeartbeat` — periodic liveness/version report.
 *
 * Unlike most transactions these are **not** submitted through `TXNService`;
 * they go to `zera_validator.ValidatorService` (rpcs `ValidatorRegistration`
 * and `ValidatorHeartbeat`).
 *
 * Envelope handling (nonce, `BaseTXN`, fee) is delegated to the shared
 * standard transaction pipeline in `shared/tx/standard`.
 *
 * ## Generated-key signature — protocol assumption
 *
 * The proto comment for `ValidatorRegistration.generated_signature` reads
 * "signature of the generated public key (signing txn hash)". This module
 * therefore computes it **after** the operator has signed, as
 * `sign(generatedPrivateKey, base.hash)`, where `base.hash` is the SHA3-256
 * hash produced by operator signing (with `generated_signature` still empty).
 * `generated_signature` is consequently **not** covered by `base.signature`
 * or `base.hash`.
 *
 * The exact verification order used by validators has not been verified
 * against the node implementation. If it differs, use the lower-level
 * {@link buildValidatorRegistrationTXN} + `signWithKey` +
 * {@link attachGeneratedSignature} (or your own signing) to adapt.
 *
 * @module validator-ops/transaction
 */

import { create } from '@bufbuild/protobuf';

import {
  PublicKeySchema,
  ValidatorHeartbeatSchema,
  ValidatorRegistrationSchema,
  ValidatorSchema,
  type BaseTXN,
  type Validator,
  type ValidatorHeartbeat,
  type ValidatorRegistration
} from '../../proto/generated/txn_pb.js';
import { ValidatorService } from '../../proto/generated/validator_pb.js';
import { createClient } from '../grpc/client-factory.js';
import {
  getKeyTypeFromPublicKey,
  getPublicKeyBytes,
  isValidPublicKeyIdentifier
} from '../shared/crypto/address-utils.js';
import { KEY_TYPE } from '../shared/crypto/constants.js';
import { signTransactionData } from '../shared/crypto/signature-utils.js';
import {
  buildStandardTransaction,
  parseUint64,
  requireContractId,
  toTimestampInit,
  type StandardTXNOptions
} from '../shared/tx/standard.js';
import { bytesEqual, bytesToHex } from '../shared/utils/byte-utils.js';
import { signWithKey } from '../sign/finalize.js';
import type { GRPCConfig } from '../types/index.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options accepted by the validator-operator builders.
 *
 * Identical to the shared {@link StandardTXNOptions}. Pass both `nonce` and
 * `feeAmountParts` to build fully offline and deterministically.
 */
export type ValidatorOpsTXNOptions = StandardTXNOptions;

/**
 * Readable input for the `zera_txn.Validator` record embedded in a
 * {@link ValidatorRegistration}.
 */
export interface ValidatorInfoInput {
  /**
   * Base58 public key identifier stored in `Validator.public_key` (the
   * "original" public key). Defaults to the registration's operator
   * `publicKey` when omitted.
   */
  publicKey?: string;
  /** Hostname or IP address the node is reachable at. Non-empty, no whitespace. */
  host: string;
  /** Client-facing port, `1`–`65535`, as a numeric string or integer. */
  clientPort: string | number;
  /** Validator-to-validator port, `1`–`65535`, as a numeric string or integer. */
  validatorPort: string | number;
  /** Contract IDs the node stakes with. Must be canonical and unique. Defaults to `[]`. */
  stakedContractIds?: string[];
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
}

/**
 * Readable input for a {@link ValidatorRegistration}.
 */
export interface ValidatorRegistrationInput {
  /** Base58 public key identifier of the operator (the `BaseTXN` signer). */
  publicKey: string;
  /** The validator node record. */
  validator: ValidatorInfoInput;
  /** `true` to register the node, `false` to deregister it. */
  register: boolean;
  /**
   * Base58 public key identifier of the node's generated key, stored in
   * `generated_public_key`. Required by {@link buildValidatorRegistrationTXN};
   * optional for {@link createValidatorRegistrationTXN}, which takes it from
   * the generated key pair (and rejects a mismatch).
   */
  generatedPublicKey?: string;
}

/** The node-generated key pair that co-signs a registration. */
export interface GeneratedKeyPair {
  /** Base58 public key identifier (e.g. `A_…` or `B_…`). */
  publicKey: string;
  /** Base58 private key matching `publicKey`. */
  privateKey: string;
}

/**
 * Readable input for a {@link ValidatorHeartbeat}.
 */
export interface ValidatorHeartbeatInput {
  /** Base58 public key identifier of the operator (the `BaseTXN` signer). */
  publicKey: string;
  /** Whether the node is online. */
  online: boolean;
  /** Node software version (uint32). */
  version: number;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

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

function parseStakedContractIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('validator.stakedContractIds must be an array of contract IDs');
  }
  const seen = new Set<string>();
  return value.map((id: unknown, index) => {
    const contractId = requireContractId(id, `validator.stakedContractIds[${index}]`);
    if (seen.has(contractId)) {
      throw new Error(`validator.stakedContractIds contains duplicate contract ID ${contractId}`);
    }
    seen.add(contractId);
    return contractId;
  });
}

function requirePublicKeyId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} identifier is required`);
  }
  if (!isValidPublicKeyIdentifier(value)) {
    throw new Error(`${field} is not a valid Kalvora public key identifier`);
  }
  return value;
}

function requirePrivateKey(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
  return value;
}

function buildValidatorRecord(input: ValidatorInfoInput, operatorPublicKey: string): Validator {
  requireObject(input, 'validator object is required');
  const publicKeyId = requirePublicKeyId(input.publicKey ?? operatorPublicKey, 'validator.publicKey');
  return create(ValidatorSchema, {
    publicKey: { single: getPublicKeyBytes(publicKeyId) },
    host: parseHost(input.host),
    clientPort: parsePort(input.clientPort, 'validator.clientPort'),
    validatorPort: parsePort(input.validatorPort, 'validator.validatorPort'),
    stakedContractIds: parseStakedContractIds(input.stakedContractIds),
    benchmark: input.benchmark === undefined ? 0n : parseUint64(input.benchmark, 'validator.benchmark'),
    timestamp: toTimestampInit(input.timestamp ?? new Date(), 'validator.timestamp'),
    lite: input.lite === undefined ? false : requireBoolean(input.lite, 'validator.lite'),
    online: input.online === undefined ? false : requireBoolean(input.online, 'validator.online'),
    version: input.version === undefined ? 0 : parseUint32(input.version, 'validator.version'),
    lastHeartbeat: input.lastHeartbeat === undefined
      ? 0n
      : parseUint64(input.lastHeartbeat, 'validator.lastHeartbeat')
  });
}

function requireSigned(txn: { base?: BaseTXN } | null | undefined): BaseTXN & { hash: Uint8Array } {
  const base = txn?.base;
  if (!base?.signature || base.signature.length === 0 || !base.hash || base.hash.length === 0) {
    throw new Error('Transaction must be signed before submission (missing signature or hash)');
  }
  return base as BaseTXN & { hash: Uint8Array };
}

// ============================================================================
// VALIDATOR REGISTRATION
// ============================================================================

/**
 * Build an **unsigned** {@link ValidatorRegistration}.
 *
 * `generated_public_key` is populated from `input.generatedPublicKey`;
 * `generated_signature` is left empty (see {@link attachGeneratedSignature}).
 *
 * Unless both `options.nonce` and `options.feeAmountParts` are set, this
 * function queries the network for the operator's next nonce and the base fee.
 * The automatic fee includes the size of the 64/114-byte `generated_signature`
 * (a zero-filled placeholder reserves it during fee calculation).
 *
 * @param input - Registration parameters (see {@link ValidatorRegistrationInput})
 * @param options - Shared standard transaction options
 * @returns The unsigned protobuf `ValidatorRegistration`
 *
 * @throws Error when `publicKey` / `generatedPublicKey` are missing or invalid,
 *   `register` is not a boolean, `validator.host` is empty, a port is not in
 *   `1`–`65535`, a staked contract ID is invalid or duplicated, `benchmark` /
 *   `lastHeartbeat` are not uint64, `version` is not uint32, or any shared
 *   option is invalid.
 *
 * @example
 * ```typescript
 * import { buildValidatorRegistrationTXN, signWithKey, attachGeneratedSignature } from 'kalvora.js';
 *
 * const txn = await buildValidatorRegistrationTXN(
 *   {
 *     publicKey: 'A_<operator public key>',
 *     generatedPublicKey: 'A_<node generated public key>',
 *     register: true,
 *     validator: { host: 'node1.example.com', clientPort: '50052', validatorPort: '50051', version: 100 }
 *   },
 *   { nonce: 3, feeAmountParts: '1000' } // offline + deterministic
 * );
 * signWithKey(txn, operatorPrivateKey, 'A_<operator public key>');
 * attachGeneratedSignature(txn, generatedPrivateKey, 'A_<node generated public key>');
 * ```
 */
export async function buildValidatorRegistrationTXN(
  input: ValidatorRegistrationInput,
  options: ValidatorOpsTXNOptions = {}
): Promise<ValidatorRegistration> {
  requireObject(input, 'buildValidatorRegistrationTXN: input object is required');
  const operatorPublicKey = requirePublicKeyId(input.publicKey, 'publicKey');
  const generatedPublicKey = requirePublicKeyId(input.generatedPublicKey, 'generatedPublicKey');
  const register = requireBoolean(input.register, 'register');
  const validator = buildValidatorRecord(input.validator, operatorPublicKey);

  // The generated-key signature is attached after operator signing, but it is
  // part of the transaction the network prices. Reserve its size with a
  // zero-filled placeholder while fees are calculated, then clear it.
  const txn = await buildStandardTransaction({
    operation: 'buildValidatorRegistrationTXN',
    schema: ValidatorRegistrationSchema,
    publicKeyId: operatorPublicKey,
    contractId: undefined,
    fields: {
      validator,
      register,
      generatedPublicKey: create(PublicKeySchema, { single: getPublicKeyBytes(generatedPublicKey) }),
      generatedSignature: new Uint8Array(signatureLength(generatedPublicKey))
    },
    options
  });
  txn.generatedSignature = new Uint8Array(0);
  return txn;
}

/** Raw signature length for a key identifier: Ed25519 = 64 bytes, Ed448 = 114 bytes. */
function signatureLength(publicKeyId: string): number {
  return getKeyTypeFromPublicKey(publicKeyId) === KEY_TYPE.ED448 ? 114 : 64;
}

/**
 * Set `generated_signature` on an operator-signed {@link ValidatorRegistration}.
 *
 * Computes `generated_signature = sign(generatedPrivateKey, base.hash)`, per
 * the proto comment "signature of the generated public key (signing txn
 * hash)". The transaction must already carry `base.signature` and `base.hash`
 * (i.e. be signed by the operator), and its `generated_public_key` must match
 * `generatedPublicKey`.
 *
 * **Assumption:** validators verify `generated_signature` over the final
 * `base.hash` (computed with `generated_signature` empty). This ordering has
 * not been verified against the node implementation. Because
 * `generated_signature` is set after hashing, it is not covered by
 * `base.signature` / `base.hash`, and calling this does not invalidate the
 * operator signature. Calling it again replaces the previous value.
 *
 * @param txn - Operator-signed registration (mutated in place)
 * @param generatedPrivateKey - Base58 private key of the node-generated key
 * @param generatedPublicKey - Base58 public key identifier of the node-generated key
 * @returns The same transaction, with `generatedSignature` populated
 *
 * @throws Error when the transaction is not operator-signed, a key is missing,
 *   or `generatedPublicKey` does not match `txn.generatedPublicKey`.
 *
 * @example
 * ```typescript
 * signWithKey(txn, operatorPrivateKey, operatorPublicKey);
 * attachGeneratedSignature(txn, node.privateKey, node.publicKey);
 * ```
 */
export function attachGeneratedSignature(
  txn: ValidatorRegistration,
  generatedPrivateKey: string,
  generatedPublicKey: string
): ValidatorRegistration {
  requireObject(txn, 'attachGeneratedSignature: transaction is required');
  const privateKey = requirePrivateKey(generatedPrivateKey, 'generatedPrivateKey');
  const publicKeyId = requirePublicKeyId(generatedPublicKey, 'generatedPublicKey');
  const base = txn.base;
  if (!base?.signature || base.signature.length === 0 || !base.hash || base.hash.length === 0) {
    throw new Error('attachGeneratedSignature: transaction must be signed by the operator first (missing base.signature or base.hash)');
  }
  const embedded = txn.generatedPublicKey?.single;
  if (!embedded || !bytesEqual(embedded, getPublicKeyBytes(publicKeyId))) {
    throw new Error('attachGeneratedSignature: generatedPublicKey does not match the transaction\'s generated_public_key');
  }
  txn.generatedSignature = signTransactionData(base.hash, privateKey, publicKeyId);
  return txn;
}

/**
 * Build and fully sign a {@link ValidatorRegistration}.
 *
 * Steps, in order:
 * 1. {@link buildValidatorRegistrationTXN} with `generated_public_key` set to
 *    `generatedKeyPair.publicKey` (and `generated_signature` empty).
 * 2. Operator signing via `signWithKey` — sets `base.signature`, then
 *    `base.hash = SHA3-256(serialized signed txn)`.
 * 3. {@link attachGeneratedSignature} — `generated_signature =
 *    sign(generatedKeyPair.privateKey, base.hash)`.
 *
 * **Assumption:** step 3 follows the proto comment "signature of the generated
 * public key (signing txn hash)"; the validator-side verification order is
 * unverified. See {@link attachGeneratedSignature}.
 *
 * @param input - Registration parameters; `generatedPublicKey` may be omitted
 * @param operatorPrivateKey - Operator's base58 private key (matching `input.publicKey`)
 * @param generatedKeyPair - The node-generated key pair
 * @param options - Shared standard transaction options
 * @returns The signed registration, ready for {@link sendValidatorRegistrationTXN}
 *
 * @throws Error when a key is missing, `input.generatedPublicKey` differs from
 *   `generatedKeyPair.publicKey`, on any validation error from
 *   {@link buildValidatorRegistrationTXN}, or when signing fails.
 *
 * @example
 * ```typescript
 * const signed = await createValidatorRegistrationTXN(
 *   {
 *     publicKey: operator.publicKey,
 *     register: true,
 *     validator: {
 *       host: 'node1.example.com',
 *       clientPort: '50052',
 *       validatorPort: '50051',
 *       stakedContractIds: ['KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'],
 *       version: 100
 *     }
 *   },
 *   operator.privateKey,
 *   { publicKey: node.publicKey, privateKey: node.privateKey }
 * );
 * const hash = await sendValidatorRegistrationTXN(signed);
 * ```
 */
export async function createValidatorRegistrationTXN(
  input: ValidatorRegistrationInput,
  operatorPrivateKey: string,
  generatedKeyPair: GeneratedKeyPair,
  options: ValidatorOpsTXNOptions = {}
): Promise<ValidatorRegistration> {
  requireObject(input, 'createValidatorRegistrationTXN: input object is required');
  requirePrivateKey(operatorPrivateKey, 'operatorPrivateKey');
  requireObject(generatedKeyPair, 'generatedKeyPair is required');
  const generatedPrivateKey = requirePrivateKey(generatedKeyPair.privateKey, 'generatedKeyPair.privateKey');
  const generatedPublicKey = requirePublicKeyId(generatedKeyPair.publicKey, 'generatedKeyPair.publicKey');
  if (input.generatedPublicKey !== undefined && input.generatedPublicKey !== generatedPublicKey) {
    throw new Error('input.generatedPublicKey does not match generatedKeyPair.publicKey');
  }

  const txn = await buildValidatorRegistrationTXN({ ...input, generatedPublicKey }, options);
  signWithKey(txn, operatorPrivateKey, input.publicKey);
  return attachGeneratedSignature(txn, generatedPrivateKey, generatedPublicKey);
}

/**
 * Submit a signed {@link ValidatorRegistration} to
 * `ValidatorService.ValidatorRegistration`.
 *
 * @param txn - Signed registration (from {@link createValidatorRegistrationTXN})
 * @param grpcConfig - Endpoint configuration (defaults to SDK defaults);
 *   `grpcConfig.transport` overrides the transport entirely
 * @returns Hex transaction hash (`base.hash`)
 *
 * @throws Error when the transaction is missing `base.signature`,
 *   `base.hash`, or `generated_signature`, or the network rejects it
 *   (as a `KalvoraRpcError`).
 *
 * @example
 * ```typescript
 * const hash = await sendValidatorRegistrationTXN(signed, { host: 'validator.example.com' });
 * ```
 */
export async function sendValidatorRegistrationTXN(
  txn: ValidatorRegistration,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  const base = requireSigned(txn);
  if (!txn.generatedSignature || txn.generatedSignature.length === 0) {
    throw new Error('ValidatorRegistration is missing generated_signature (see attachGeneratedSignature)');
  }
  const client = createClient(ValidatorService, grpcConfig);
  await client.validatorRegistration(txn);
  return bytesToHex(base.hash);
}

// ============================================================================
// VALIDATOR HEARTBEAT
// ============================================================================

/**
 * Build an **unsigned** {@link ValidatorHeartbeat}.
 *
 * Unless both `options.nonce` and `options.feeAmountParts` are set, this
 * function queries the network for the operator's next nonce and the base fee.
 *
 * @param input - Heartbeat parameters (see {@link ValidatorHeartbeatInput})
 * @param options - Shared standard transaction options
 * @returns The unsigned protobuf `ValidatorHeartbeat`
 *
 * @throws Error when `publicKey` is missing/invalid, `online` is not a
 *   boolean, `version` is not a uint32, or any shared option is invalid.
 *
 * @example
 * ```typescript
 * const txn = await buildValidatorHeartbeatTXN(
 *   { publicKey: 'A_<operator public key>', online: true, version: 100 },
 *   { nonce: 4, feeAmountParts: '1000' }
 * );
 * ```
 */
export async function buildValidatorHeartbeatTXN(
  input: ValidatorHeartbeatInput,
  options: ValidatorOpsTXNOptions = {}
): Promise<ValidatorHeartbeat> {
  requireObject(input, 'buildValidatorHeartbeatTXN: input object is required');
  const operatorPublicKey = requirePublicKeyId(input.publicKey, 'publicKey');
  const online = requireBoolean(input.online, 'online');
  const version = parseUint32(input.version, 'version');

  return buildStandardTransaction({
    operation: 'buildValidatorHeartbeatTXN',
    schema: ValidatorHeartbeatSchema,
    publicKeyId: operatorPublicKey,
    contractId: undefined,
    fields: { online, version },
    options
  });
}

/**
 * Build and sign a {@link ValidatorHeartbeat} with the operator's private key.
 *
 * @param input - Heartbeat parameters
 * @param privateKey - Operator's base58 private key (matching `input.publicKey`)
 * @param options - Shared standard transaction options
 * @returns The signed heartbeat, ready for {@link sendValidatorHeartbeatTXN}
 *
 * @throws Error when `privateKey` is missing, on any validation error from
 *   {@link buildValidatorHeartbeatTXN}, or when signing fails.
 *
 * @example
 * ```typescript
 * const signed = await createValidatorHeartbeatTXN(
 *   { publicKey: operator.publicKey, online: true, version: 100 },
 *   operator.privateKey
 * );
 * const hash = await sendValidatorHeartbeatTXN(signed);
 * ```
 */
export async function createValidatorHeartbeatTXN(
  input: ValidatorHeartbeatInput,
  privateKey: string,
  options: ValidatorOpsTXNOptions = {}
): Promise<ValidatorHeartbeat> {
  requirePrivateKey(privateKey, 'privateKey');
  const txn = await buildValidatorHeartbeatTXN(input, options);
  return signWithKey(txn, privateKey, input.publicKey);
}

/**
 * Submit a signed {@link ValidatorHeartbeat} to
 * `ValidatorService.ValidatorHeartbeat`.
 *
 * @param txn - Signed heartbeat (from {@link createValidatorHeartbeatTXN})
 * @param grpcConfig - Endpoint configuration (defaults to SDK defaults);
 *   `grpcConfig.transport` overrides the transport entirely
 * @returns Hex transaction hash (`base.hash`)
 *
 * @throws Error when the transaction is unsigned or the network rejects it.
 *
 * @example
 * ```typescript
 * const hash = await sendValidatorHeartbeatTXN(signed);
 * ```
 */
export async function sendValidatorHeartbeatTXN(
  txn: ValidatorHeartbeat,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  const base = requireSigned(txn);
  const client = createClient(ValidatorService, grpcConfig);
  await client.validatorHeartbeat(txn);
  return bytesToHex(base.hash);
}
