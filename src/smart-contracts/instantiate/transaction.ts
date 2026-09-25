/**
 * Smart Contract Instantiate Transaction
 *
 * Creates, builds, and submits SmartContractInstantiateTXN transactions.
 *
 * `buildSmartContractInstantiateTXN()` constructs an unsigned transaction (no private keys needed).
 * `createSmartContractInstantiateTXN()` is a convenience wrapper: build + sign with private key.
 */

import { create } from '@bufbuild/protobuf';

import { SmartContractInstantiateTXNSchema } from '../../../proto/generated/txn_pb.js';
import type { SmartContractInstantiateTXN } from '../../../proto/generated/txn_pb.js';
import { validateKeyPair } from '../../contract/shared/utils.js';
import { signWithKey } from '../../sign/finalize.js';
import type { GRPCConfig } from '../../types/index.js';
import {
  buildSmartContractBaseTXN,
  calculateSmartContractFee,
  type SmartContractBaseTXNOptions
} from '../shared/base.js';
import {
  buildSmartContractParameters,
  type SmartContractParameter
} from '../shared/parameters.js';
import {
  validateSmartContractInstance,
  validateSmartContractName
} from '../shared/validation.js';

// ============================================================================
// TYPES
// ============================================================================

export type InstantiateParameter = SmartContractParameter;

export interface BuildSmartContractInstantiateTXNOptions extends SmartContractBaseTXNOptions {
  /** Name of the deployed smart contract */
  smartContractName: string;
  /** Instance number to initialize */
  instance: number;
  /** Instantiation parameters */
  parameters?: InstantiateParameter[];
  /** Public key identifier (no private key needed) */
  publicKeyBase58Identifier: string;
  /** Optional gas fee in USD for initialization work */
  gasFeeInUsd?: number;
}

export interface CreateSmartContractInstantiateTXNOptions extends BuildSmartContractInstantiateTXNOptions {
  /** Private key for signing the transaction */
  privateKeyBase58: string;
}

function validateInstantiateOptions(options: BuildSmartContractInstantiateTXNOptions): void {
  validateSmartContractName(options.smartContractName);
  validateSmartContractInstance(options.instance);
  if (!options.publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (options.parameters !== undefined && !Array.isArray(options.parameters)) {
    throw new Error('parameters must be an array');
  }
}

// ============================================================================
// PUBLIC API — BUILD UNSIGNED
// ============================================================================

/**
 * Build an unsigned SmartContractInstantiateTXN transaction.
 *
 * Performs validation, nonce fetching, and fee calculation but **stops before signing**.
 */
export async function buildSmartContractInstantiateTXN(
  options: BuildSmartContractInstantiateTXNOptions
): Promise<SmartContractInstantiateTXN> {
  validateInstantiateOptions(options);

  const { base, grpcConfig, effectiveFeeId } = await buildSmartContractBaseTXN(
    options.publicKeyBase58Identifier,
    options,
    'buildSmartContractInstantiateTXN'
  );

  const instantiateTxn = create(SmartContractInstantiateTXNSchema, {
    base,
    smartContractName: options.smartContractName,
    instance: options.instance,
    parameters: buildSmartContractParameters(options.parameters ?? [])
  });

  await calculateSmartContractFee(instantiateTxn, options, grpcConfig, effectiveFeeId);

  return instantiateTxn;
}

// ============================================================================
// PUBLIC API — CONVENIENCE (build + sign)
// ============================================================================

/**
 * Create a SmartContractInstantiateTXN transaction.
 *
 * Convenience wrapper: builds with `buildSmartContractInstantiateTXN()` then signs with the provided private key.
 */
export async function createSmartContractInstantiateTXN(
  options: CreateSmartContractInstantiateTXNOptions
): Promise<SmartContractInstantiateTXN> {
  if (!options.privateKeyBase58) throw new Error('privateKeyBase58 is required');

  validateKeyPair({
    publicKeyBase58Identifier: options.publicKeyBase58Identifier,
    privateKeyBase58: options.privateKeyBase58
  });

  const { privateKeyBase58, ...unsignedOptions } = options;
  const instantiateTxn = await buildSmartContractInstantiateTXN(unsignedOptions);

  signWithKey(instantiateTxn, privateKeyBase58, options.publicKeyBase58Identifier);

  return instantiateTxn;
}

// ============================================================================
// PUBLIC API — SEND
// ============================================================================

export async function sendSmartContractInstantiateTXN(
  txn: SmartContractInstantiateTXN,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  const { submitTransaction } = await import('../../grpc/transaction/transaction-client.js');
  return submitTransaction(txn, grpcConfig);
}
