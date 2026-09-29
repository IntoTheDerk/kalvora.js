/**
 * Smart Contract Deploy Transaction
 *
 * Creates, builds, and submits SmartContractTXN transactions.
 *
 * `buildSmartContractTXN()` constructs an unsigned transaction (no private keys needed).
 * `createSmartContractTXN()` is a convenience wrapper: build + sign with private key.
 */

import { create } from '@bufbuild/protobuf';

import { LANGUAGE, SmartContractTXNSchema } from '../../../proto/generated/txn_pb.js';
import type { SmartContractTXN } from '../../../proto/generated/txn_pb.js';
import { validateKeyPair } from '../../contract/shared/utils.js';
import { signWithKey } from '../../sign/finalize.js';
import type { GRPCConfig } from '../../types/index.js';
import {
  buildSmartContractBaseTXN,
  calculateSmartContractFee,
  type SmartContractBaseTXNOptions
} from '../shared/base.js';
import { validateSmartContractName } from '../shared/validation.js';

// ============================================================================
// TYPES
// ============================================================================

export type SmartContractCodeInput = string | Uint8Array;

export interface BuildSmartContractTXNOptions extends SmartContractBaseTXNOptions {
  /** Name used to identify the smart contract on-chain */
  smartContractName: string;
  /** Contract bytecode or deployable code payload */
  binaryCode?: SmartContractCodeInput;
  /** Optional source text, URL, CID, or other storage reference for discoverability/auditing */
  sourceCode?: SmartContractCodeInput;
  /** Contract language (defaults to LANGUAGE.COMPILED) */
  language?: LANGUAGE;
  /** Public entry points exposed by the smart contract */
  functions?: string[];
  /** Public key identifier (no private key needed) */
  publicKeyBase58Identifier: string;
}

export interface CreateSmartContractTXNOptions extends BuildSmartContractTXNOptions {
  /** Private key for signing the transaction */
  privateKeyBase58: string;
}


// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function toCodeBytes(value: SmartContractCodeInput | undefined): Uint8Array {
  if (value === undefined) return new Uint8Array();
  if (value instanceof Uint8Array) return value;
  return new TextEncoder().encode(value);
}

function hasDeployCode(value: SmartContractCodeInput | undefined, fieldName: string): boolean {
  if (value === undefined) return false;
  if (value instanceof Uint8Array) {
    if (value.length === 0) throw new Error(`${fieldName} cannot be empty`);
    return true;
  }
  if (value.trim().length === 0) throw new Error(`${fieldName} cannot be empty`);
  return true;
}

function validateDeployOptions(options: BuildSmartContractTXNOptions): void {
  validateSmartContractName(options.smartContractName);
  if (!options.publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');

  const language = options.language ?? LANGUAGE.COMPILED;
  const hasBinaryCode = hasDeployCode(options.binaryCode, 'binaryCode');
  const hasSourceCode = hasDeployCode(options.sourceCode, 'sourceCode');

  if (!hasBinaryCode && !hasSourceCode) {
    throw new Error('binaryCode or sourceCode is required');
  }
  if (language === LANGUAGE.COMPILED && !hasBinaryCode) {
    throw new Error('binaryCode is required for compiled smart contracts');
  }
  if (options.functions !== undefined) {
    if (!Array.isArray(options.functions)) throw new Error('functions must be an array');
    const invalidFunction = options.functions.find((functionName) => !functionName || functionName.trim() === '');
    if (invalidFunction !== undefined) throw new Error('functions cannot contain empty names');
  }
}

// ============================================================================
// PUBLIC API — BUILD UNSIGNED
// ============================================================================

/**
 * Build an unsigned SmartContractTXN deployment transaction.
 *
 * Performs validation, nonce fetching, and fee calculation but **stops before signing**.
 */
export async function buildSmartContractTXN(
  options: BuildSmartContractTXNOptions
): Promise<SmartContractTXN> {
  validateDeployOptions(options);

  const { base, grpcConfig, effectiveFeeId } = await buildSmartContractBaseTXN(
    options.publicKeyBase58Identifier,
    options,
    'buildSmartContractTXN'
  );

  const deployTxn = create(SmartContractTXNSchema, {
    base,
    smartContractName: options.smartContractName,
    binaryCode: toCodeBytes(options.binaryCode),
    sourceCode: toCodeBytes(options.sourceCode),
    language: options.language ?? LANGUAGE.COMPILED,
    functions: options.functions ?? []
  });

  await calculateSmartContractFee(deployTxn, options, grpcConfig, effectiveFeeId);

  return deployTxn;
}

/**
 * Alias for callers that prefer deploy-oriented naming.
 */

// ============================================================================
// PUBLIC API — CONVENIENCE (build + sign)
// ============================================================================

/**
 * Create a SmartContractTXN deployment transaction.
 *
 * Convenience wrapper: builds with `buildSmartContractTXN()` then signs with the provided private key.
 */
export async function createSmartContractTXN(
  options: CreateSmartContractTXNOptions
): Promise<SmartContractTXN> {
  if (!options.privateKeyBase58) throw new Error('privateKeyBase58 is required');

  validateKeyPair({
    publicKeyBase58Identifier: options.publicKeyBase58Identifier,
    privateKeyBase58: options.privateKeyBase58
  });

  const { privateKeyBase58, ...unsignedOptions } = options;
  const deployTxn = await buildSmartContractTXN(unsignedOptions);

  signWithKey(deployTxn, privateKeyBase58, options.publicKeyBase58Identifier);

  return deployTxn;
}

/**
 * Alias for callers that prefer deploy-oriented naming.
 */

// ============================================================================
// PUBLIC API — SEND
// ============================================================================

export async function sendSmartContractTXN(
  txn: SmartContractTXN,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  const { submitTransaction } = await import('../../grpc/transaction/transaction-client.js');
  return submitTransaction(txn, grpcConfig);
}

/**
 * Alias for callers that prefer deploy-oriented naming.
 */
