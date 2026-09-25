/**
 * Smart Contract Execute Transaction
 *
 * Creates, builds, and submits SmartContractExecuteTXN transactions.
 *
 * `buildSmartContractExecuteTXN()` constructs an unsigned transaction (no private keys needed).
 * `createSmartContractExecuteTXN()` is a convenience wrapper: build + sign with private key.
 */

import { create } from '@bufbuild/protobuf';

import { SmartContractExecuteTXNSchema } from '../../../proto/generated/txn_pb.js';
import type { SmartContractExecuteTXN } from '../../../proto/generated/txn_pb.js';
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
  ParamType,
  type ParameterType,
  type SmartContractParameter
} from '../shared/parameters.js';
import {
  validateSmartContractInstance,
  validateSmartContractName
} from '../shared/validation.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameter for smart contract function execution.
 */
export type ExecuteParameter = SmartContractParameter;

export { ParamType, type ParameterType };

/**
 * Options for building an unsigned SmartContractExecuteTXN.
 */
export interface BuildSmartContractExecuteOptions extends SmartContractBaseTXNOptions {
  /** Gas fee in USD */
  gasFeeInUsd?: number;
}

/**
 * Options for creating a SmartContractExecute transaction.
 */
export type CreateSmartContractExecuteOptions = BuildSmartContractExecuteOptions;

// ============================================================================
// PUBLIC API — BUILD UNSIGNED
// ============================================================================

/**
 * Build an unsigned SmartContractExecuteTXN transaction.
 *
 * Performs all validation, nonce fetching, and fee calculation but **stops before signing**.
 *
 * @param smartContractName - Name of the smart contract
 * @param instance - Instance number
 * @param functionName - Function to call
 * @param parameters - Function parameters
 * @param publicKeyBase58Identifier - Public key identifier (no private key needed)
 * @param options - Execution options (fees, nonce, etc.)
 * @returns An unsigned `SmartContractExecuteTXN` protobuf
 *
 * @example
 * ```typescript
 * const unsigned = await buildSmartContractExecuteTXN(
 *   'my_contract', 0, 'transfer',
 *   [{ type: 'string', value: 'hello' }],
 *   'ed25519:9Xk3...'
 * );
 * const signed = await signAndFinalize(unsigned, signer);
 * ```
 */
export async function buildSmartContractExecuteTXN(
  smartContractName: string,
  instance: number,
  functionName: string,
  parameters: ExecuteParameter[],
  publicKeyBase58Identifier: string,
  options: BuildSmartContractExecuteOptions = {}
): Promise<SmartContractExecuteTXN> {
  validateSmartContractName(smartContractName);
  validateSmartContractInstance(instance);
  if (!functionName) throw new Error('functionName is required');
  if (!Array.isArray(parameters)) {
    throw new Error('parameters must be an array');
  }

  const { base, grpcConfig, effectiveFeeId } = await buildSmartContractBaseTXN(
    publicKeyBase58Identifier,
    options,
    'buildSmartContractExecuteTXN'
  );

  const executeTxn = create(SmartContractExecuteTXNSchema, {
    base,
    smartContractName,
    function: functionName,
    instance,
    parameters: buildSmartContractParameters(parameters)
  });

  await calculateSmartContractFee(executeTxn, options, grpcConfig, effectiveFeeId);

  return executeTxn;
}

// ============================================================================
// PUBLIC API — CONVENIENCE (build + sign)
// ============================================================================

/**
 * Create a SmartContractExecute transaction.
 *
 * Convenience wrapper: builds with `buildSmartContractExecuteTXN()` then signs with the provided private key.
 */
export async function createSmartContractExecuteTXN(
  smartContractName: string,
  instance: number,
  functionName: string,
  parameters: ExecuteParameter[],
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: CreateSmartContractExecuteOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  validateKeyPair({
    publicKeyBase58Identifier,
    privateKeyBase58
  });

  const executeTxn = await buildSmartContractExecuteTXN(
    smartContractName, instance, functionName, parameters,
    publicKeyBase58Identifier, options
  );

  signWithKey(executeTxn, privateKeyBase58, publicKeyBase58Identifier);

  return executeTxn;
}

// ============================================================================
// PUBLIC API — SEND
// ============================================================================

export async function sendSmartContractExecuteTXN(txn: SmartContractExecuteTXN, grpcConfig: GRPCConfig = {}): Promise<string> {
  const { submitTransaction } = await import('../../grpc/transaction/transaction-client.js');
  return submitTransaction(txn, grpcConfig);
}
