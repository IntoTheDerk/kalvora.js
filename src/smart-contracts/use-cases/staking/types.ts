/**
 * Kalvora Staking Transaction Types
 * 
 * Type definitions for all staking operations via the `staking_proxy` smart contract.
 * 
 * Amounts are specified in smallest units (raw parts). Terms use string identifiers
 * like '6_months'.
 */

import type { SmartContractExecuteTXN } from '../../../../proto/generated/txn_pb.js';
import type { AmountInput, GRPCConfig } from '../../../types/index.js';
import type { CreateSmartContractExecuteOptions } from '../../execute/index.js';

// ============================================================================
// BASE OPTIONS
// ============================================================================

/**
 * Base options for all Kalvora Staking transactions
 */
export interface StakingOptions extends Omit<CreateSmartContractExecuteOptions, 'feeId' | 'feeAmountParts'> {
  /** gRPC configuration for network communication */
  grpcConfig?: GRPCConfig;
  /** Optional fee ID (defaults to `KALVORA_NATIVE_TOKEN`) */
  feeId?: string;
  /**
   * Exact base fee in smallest units of `feeId` ("parts"); skips automatic
   * fee calculation when provided.
   */
  feeAmountParts?: string;
}

// ============================================================================
// STAKING OPTIONS
// ============================================================================

/**
 * Options for staking tokens (liquid staking)
 * 
 * Locks tokens for a specified term and associates them with a wallet address.
 */
export interface StakeOptions {
  /** Amount to stake in smallest units / parts (1 KALV = 1e9 parts, e.g., 500 for 500e9 parts) */
  amount: AmountInput;
  /** Wallet address to associate with the stake */
  walletAddress: string;
  /** Staking term (e.g., '6_months') */
  term: string;
}

/**
 * Options for updating the wallet address associated with a stake
 */
export interface UpdateWalletOptions {
  /** New wallet address */
  walletAddress: string;
  /** Bump ID — identifies which stake position to update the wallet for (only used for wallet updates, not when entering a stake) */
  bumpId: AmountInput;
}

/**
 * Options for instant staking
 * 
 * Locks tokens directly for a term with no liquid token representation.
 * Does not require a wallet address.
 */
export interface InstantStakeOptions {
  /** Amount to stake in smallest units / parts (1 KALV = 1e9 parts, e.g., 500 for 500e9 parts) */
  amount: AmountInput;
  /** Staking term (e.g., '6_months') */
  term: string;
}

/**
 * Options for updating the wallet address associated with an instant stake
 */
export interface UpdateInstantWalletOptions {
  /** New wallet address */
  walletAddress: string;
  /** Bump ID — identifies which instant stake position to update the wallet for (only used for wallet updates, not when entering a stake) */
  bumpId: AmountInput;
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Result from staking transaction builders
 */
export interface StakingTransactionResult {
  /** The created transaction (not yet sent) */
  transaction: SmartContractExecuteTXN;
}
