/**
 * Kalvora DEX Utilities
 * 
 * Constants and helper functions for DEX operations via `zera_dex_proxy`.
 */

import type { SmartContractExecuteTXN } from '../../../../proto/generated/txn_pb.js';
import { getTokenInfoForSingle } from '../../../api/handler/token-info/service.js';
import { PROTONET_GRPC_CONFIG } from '../../../shared/utils/testing-defaults/index.js';
import { toSmallestUnits } from '../../../shared/utils/unified-amount-conversion.js';
import type { AmountInput, GRPCConfig } from '../../../types/index.js';
import { createSmartContractExecuteTXN, ParamType, type ExecuteParameter } from '../../execute/index.js';

import type { DexOptions } from './types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const DEX_CONTRACT_NAME = 'zera_dex_proxy';
export const DEX_INSTANCE = 1;

/** Default lock duration in seconds (60s = 1 minute) */
export const DEFAULT_LOCK_DURATION = 60;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Compute a lock timestamp from now + duration seconds.
 * 
 * @param durationSeconds - Lock duration in seconds from now
 * @returns Unix timestamp string for the lock expiry
 */
export function computeLockTimestamp(durationSeconds: number = DEFAULT_LOCK_DURATION): string {
  const now = Math.floor(Date.now() / 1000);
  return String(now + durationSeconds);
}

/**
 * Resolve a user-friendly amount to smallest units for a given token.
 * 
 * Fetches the token's denomination from the network and converts
 * the human-readable amount (e.g., '10') to its smallest-unit
 * representation (e.g., '10000000000' for a token with 9 decimals).
 * 
 * @param amount - User-friendly amount (e.g., '10', '0.5', 100)
 * @param contractId - Token contract ID (e.g., 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao')
 * @param grpcConfig - gRPC config for the network call
 * @returns Amount in smallest units as a string
 */
export async function resolveAmount(
  amount: AmountInput,
  contractId: string,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  const tokenInfo = await getTokenInfoForSingle(contractId, grpcConfig);
  return toSmallestUnits(amount, contractId, {
    denomination: tokenInfo.denomination
  });
}

/**
 * Create a DEX transaction with the given action and parameters.
 * 
 * This is the core utility for building `zera_dex_proxy` transactions.
 * All DEX operations use the `execute` function with two string parameters:
 *   - Parameter 1: action name (e.g., 'create_liquidity_pool')
 *   - Parameter 2: comma-delimited arguments
 * 
 * @param actionName - The DEX action to execute
 * @param parameterValue - Comma-delimited parameter string
 * @param publicKeyBase58Identifier - Public key of the sender
 * @param privateKeyBase58 - Private key of the sender
 * @param feeId - Fee token to use
 * @param options - Additional transaction options
 * @returns The created transaction
 */
export async function createDexTransaction(
  actionName: string,
  parameterValue: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  feeId: string,
  options: DexOptions
): Promise<SmartContractExecuteTXN> {
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;

  const parameters: ExecuteParameter[] = [
    { type: ParamType.STRING, value: actionName },
    { type: ParamType.STRING, value: parameterValue }
  ];

  return createSmartContractExecuteTXN(
    DEX_CONTRACT_NAME,
    DEX_INSTANCE,
    'execute',
    parameters,
    publicKeyBase58Identifier,
    privateKeyBase58,
    {
      ...options,
      feeId,
      ...(options.feeAmountUsd !== undefined && { feeAmountParts: options.feeAmountUsd }),
      grpcConfig
    }
  );
}
