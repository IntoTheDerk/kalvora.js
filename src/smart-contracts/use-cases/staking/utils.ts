/**
 * Kalvora Staking Utilities
 * 
 * Constants and helper functions for staking operations via `staking_proxy`.
 */

import type { SmartContractExecuteTXN } from '../../../../proto/generated/txn_pb.js';
import { PROTONET_GRPC_CONFIG } from '../../../shared/utils/testing-defaults/index.js';
import { createSmartContractExecuteTXN, ParamType, type ExecuteParameter } from '../../execute/index.js';

import type { StakingOptions } from './types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const STAKING_CONTRACT_NAME = 'staking_proxy';
export const STAKING_INSTANCE = 1;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a staking transaction with the given action and parameters.
 * 
 * This is the core utility for building `staking_proxy` transactions.
 * All staking operations use the `execute` function with two string parameters:
 *   - Parameter 1: action name (e.g., 'stake', 'instant_stake')
 *   - Parameter 2: comma-delimited arguments (or empty string)
 * 
 * @param actionName - The staking action to execute
 * @param parameterValue - Comma-delimited parameter string (or empty string)
 * @param publicKeyBase58Identifier - Public key of the sender
 * @param privateKeyBase58 - Private key of the sender
 * @param feeId - Fee token to use
 * @param options - Additional transaction options
 * @returns The created transaction
 */
export async function createStakingTransaction(
  actionName: string,
  parameterValue: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  feeId: string,
  options: StakingOptions
): Promise<SmartContractExecuteTXN> {
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;

  const parameters: ExecuteParameter[] = [
    { type: ParamType.STRING, value: actionName },
    { type: ParamType.STRING, value: parameterValue }
  ];

  return createSmartContractExecuteTXN(
    STAKING_CONTRACT_NAME,
    STAKING_INSTANCE,
    'execute',
    parameters,
    publicKeyBase58Identifier,
    privateKeyBase58,
    {
      ...options,
      feeId,
      grpcConfig
    }
  );
}
