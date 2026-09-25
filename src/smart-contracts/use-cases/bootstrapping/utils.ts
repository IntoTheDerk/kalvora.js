/**
 * Kalvora Bootstrapping Utilities
 *
 * Constants and helper functions for the bootstrapping protocol via
 * `bootstrapping_proxy`.
 */

import type { SmartContractExecuteTXN } from '../../../../proto/generated/txn_pb.js';
import { PROTONET_GRPC_CONFIG } from '../../../shared/utils/testing-defaults/index.js';
import { toSmallestUnits } from '../../../shared/utils/unified-amount-conversion.js';
import type { AmountInput } from '../../../types/index.js';
import { createSmartContractExecuteTXN, ParamType, type ExecuteParameter } from '../../execute/index.js';

import type { BootstrappingOptions } from './types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const BOOTSTRAPPING_CONTRACT_NAME = 'bootstrapping_proxy';
export const BOOTSTRAPPING_INSTANCE = 1;
export const BOOTSTRAPPING_LP_DENOMINATION = '1000000000';
export const BOOTSTRAPPING_ELIGIBLE_FEE_RATE_BPS = 25;

/**
 * Governance reference schedule from the Strategic Liquidity & Ecosystem Infrastructure Proposal.
 *
 * The proposal labels this as a "7-Year Bootstrapping Program", but the specified
 * ten-period schedule spans 4,215 days in total (approximately 11.5 years).
 */
export const BOOTSTRAPPING_EMISSION_PERIODS = [
  { period: 1, startDay: 1, endDay: 30, dailyRewardsZra: '23333.33' },
  { period: 2, startDay: 31, endDay: 76, dailyRewardsZra: '15217.39' },
  { period: 3, startDay: 77, endDay: 147, dailyRewardsZra: '9859.15' },
  { period: 4, startDay: 148, endDay: 257, dailyRewardsZra: '6363.64' },
  { period: 5, startDay: 258, endDay: 427, dailyRewardsZra: '4117.65' },
  { period: 6, startDay: 428, endDay: 690, dailyRewardsZra: '2661.60' },
  { period: 7, startDay: 691, endDay: 1097, dailyRewardsZra: '1719.90' },
  { period: 8, startDay: 1098, endDay: 1727, dailyRewardsZra: '1111.11' },
  { period: 9, startDay: 1728, endDay: 2703, dailyRewardsZra: '717.21' },
  { period: 10, startDay: 2704, endDay: 4215, dailyRewardsZra: '462.96' }
] as const;

/**
 * Governance reference multiplier table used to weight rewards by lock duration.
 */
export const BOOTSTRAPPING_LOCK_MULTIPLIERS = [
  { lockDays: 30, lockYears: '0.08', multiplier: '1.00' },
  { lockDays: 90, lockYears: '0.25', multiplier: '1.16' },
  { lockDays: 180, lockYears: '0.49', multiplier: '1.40' },
  { lockDays: 365, lockYears: '1.00', multiplier: '1.67' },
  { lockDays: 730, lockYears: '2.00', multiplier: '2.01' },
  { lockDays: 1095, lockYears: '3.00', multiplier: '2.41' },
  { lockDays: 1460, lockYears: '4.00', multiplier: '2.89' },
  { lockDays: 1825, lockYears: '5.00', multiplier: '3.47' },
  { lockDays: 2190, lockYears: '6.00', multiplier: '4.17' },
  { lockDays: 2555, lockYears: '7.00', multiplier: '5.00' }
] as const;

export const BOOTSTRAPPING_ELIGIBLE_PAIRS = [
  'Native Kalvora DEX: KALV / Wrapped USDC',
  'Solana DEX (Raydium): Wrapped KALV / USDC'
] as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Bootstrapping LP tokens use a fixed 1e9 denomination.
 *
 * This lets callers pass user-friendly token amounts such as `15000` and have
 * the SDK convert them to raw parts before building the contract payload.
 */
export function resolveBootstrappingAmount(amount: AmountInput, lpTokenId: string): string {
  return toSmallestUnits(amount, lpTokenId, {
    denomination: BOOTSTRAPPING_LP_DENOMINATION
  });
}

/**
 * Create a bootstrapping transaction with the given action and parameters.
 *
 * All bootstrapping operations use the `execute` function with two string parameters:
 *   - Parameter 1: action name (for example, `update_wallet`)
 *   - Parameter 2: comma-delimited arguments (or empty string)
 */
export async function createBootstrappingTransaction(
  actionName: string,
  parameterValue: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  feeId: string,
  options: BootstrappingOptions
): Promise<SmartContractExecuteTXN> {
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;

  const parameters: ExecuteParameter[] = [
    { type: ParamType.STRING, value: actionName },
    { type: ParamType.STRING, value: parameterValue }
  ];

  return createSmartContractExecuteTXN(
    BOOTSTRAPPING_CONTRACT_NAME,
    BOOTSTRAPPING_INSTANCE,
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
