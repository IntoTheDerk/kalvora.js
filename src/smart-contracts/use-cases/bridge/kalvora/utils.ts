/**
 * Kalvora Bridge Utilities
 * 
 * Helper functions for Kalvora-side bridge operations.
 */

import type { ZeraPayload } from '../../../../../proto/generated/guardian_pb.js';
import { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import {
  createSmartContractExecuteTXN,
  ParamType,
  type CreateSmartContractExecuteOptions,
  type ExecuteParameter
} from '../../../execute/index.js';

import type { BridgeKalvoraOptions } from './types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const BRIDGE_CONTRACT_NAME = 'zera_bridge_proxy';
export const BRIDGE_INSTANCE = 1;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format guardian signatures for smart contract parameter
 * 
 * Converts the payload's signatures and public keys into the format
 * expected by the bridge_proxy smart contract.
 * 
 * @param payload - Guardian-signed payload
 * @returns Formatted signature string
 */
export function formatGuardianSignatures(payload: ZeraPayload): string {
  // Format: signedHash|sig1,pk1|sig2,pk2|...
  const sigPairs = payload.signatures.map((sig, i) => 
    `${sig},${payload.publicKeys[i] || ''}`
  ).join('|');
  
  return `${payload.signedHash}|${sigPairs}`;
}

function resolveFeeAmountParts(options: BridgeKalvoraOptions): string | undefined {
  const { feeAmountParts } = options;

  if (feeAmountParts !== undefined && !/^\d+$/.test(feeAmountParts)) {
    throw new Error(
      'feeAmountParts must be an integer string in raw token parts. Use gasFeeInUsd to add USD-denominated smart-contract gas.'
    );
  }

  return feeAmountParts;
}

/**
 * Create a bridge transaction with the given function and parameters
 * 
 * This is the core utility for building bridge_proxy transactions.
 * 
 * @param functionName - The bridge_proxy function to call
 * @param parameterValue - The formatted parameter string
 * @param publicKeyBase58Identifier - Public key of the sender
 * @param privateKeyBase58 - Private key of the sender
 * @param feeId - Fee token to use
 * @param options - Additional options
 * @returns The created transaction
 */
export async function createBridgeTransaction(
  functionName: string,
  parameterValue: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  feeId: string,
  options: BridgeKalvoraOptions
): Promise<SmartContractExecuteTXN> {
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  const feeAmountParts = resolveFeeAmountParts(options);
  const executeOptionsBase = { ...options };
  
  const parameters: ExecuteParameter[] = [
    { type: ParamType.STRING, value: functionName },
    { type: ParamType.STRING, value: parameterValue }
  ];

  const executeOptions: CreateSmartContractExecuteOptions = {
    ...executeOptionsBase,
    feeId,
    ...(feeAmountParts !== undefined && { feeAmountParts }),
    grpcConfig
  };

  return createSmartContractExecuteTXN(
    BRIDGE_CONTRACT_NAME,
    BRIDGE_INSTANCE,
    'execute',
    parameters,
    publicKeyBase58Identifier,
    privateKeyBase58,
    executeOptions
  );
}
