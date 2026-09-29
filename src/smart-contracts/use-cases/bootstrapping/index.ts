/**
 * Kalvora Bootstrapping - Public API
 *
 * SDK helpers for interacting with the Kalvora LP bootstrapping protocol via the
 * `bootstrapping_proxy` smart contract.
 *
 * ## Implemented Operations
 *
 * - `stake` / `stakeAndSend` - Lock LP tokens into the bootstrapping rewards program
 * - `updateWallet` / `updateWalletAndSend` - Update the payout wallet for a locked LP position
 * - `processRewards` / `processRewardsAndSend` - Trigger reward processing for accrued emissions
 *
 * ## Reward Model Reference
 *
 * The governance proposal describes rewards as proportional to:
 *
 * `locked LP tokens × lock-duration multiplier`
 *
 * This module exports the proposal reference tables for emission periods,
 * lock multipliers, and eligible pairs alongside the transaction builders.
 */

// ============================================================================
// TRANSACTION BUILDERS
// ============================================================================

export {
  stake,
  stakeAndSend,
  updateWallet,
  updateWalletAndSend,
  processRewards,
  processRewardsAndSend
} from './transactions/index.js';

// ============================================================================
// TYPES
// ============================================================================

export type {
  BootstrappingOptions,
  StakeOptions,
  UpdateWalletOptions,
  BootstrappingTransactionResult
} from './types.js';

// ============================================================================
// UTILITIES
// ============================================================================

export {
  BOOTSTRAPPING_CONTRACT_NAME,
  BOOTSTRAPPING_INSTANCE,
  BOOTSTRAPPING_LP_DENOMINATION,
  BOOTSTRAPPING_ELIGIBLE_FEE_RATE_BPS,
  BOOTSTRAPPING_EMISSION_PERIODS,
  BOOTSTRAPPING_LOCK_MULTIPLIERS,
  BOOTSTRAPPING_ELIGIBLE_PAIRS,
  createBootstrappingTransaction,
  resolveBootstrappingAmount
} from './utils.js';
