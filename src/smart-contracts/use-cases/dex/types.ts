/**
 * Kalvora DEX Transaction Types
 * 
 * Type definitions for all DEX operations via the `zera_dex_proxy` smart contract.
 * 
 * All amount fields accept user-friendly values (e.g., '10', '0.5') and are
 * automatically converted to smallest units via the token info API.
 */

import type { SmartContractExecuteTXN } from '../../../../proto/generated/txn_pb.js';
import type { AmountInput } from '../../../types/index.js';
import type { GRPCConfig } from '../../../types/index.js';
import type { CreateSmartContractExecuteOptions } from '../../execute/index.js';

// ============================================================================
// BASE OPTIONS
// ============================================================================

/**
 * Base options for all Kalvora DEX transactions
 */
export interface DexOptions extends Omit<CreateSmartContractExecuteOptions, 'feeId' | 'feeAmountParts'> {
  /** gRPC configuration for network communication */
  grpcConfig?: GRPCConfig;
  /** Optional fee ID (defaults to `KALVORA_NATIVE_TOKEN`) */
  feeId?: string;
  /** Optional fee amount in USD (skips auto-calculation if provided) */
  feeAmountUsd?: string;
}

// ============================================================================
// LIQUIDITY POOL OPTIONS
// ============================================================================

/**
 * Options for creating a new liquidity pool
 * 
 * Amounts are user-friendly (e.g., '10' for 10 tokens) and auto-converted
 * to smallest units using the token denomination from the network.
 */
export interface CreateLiquidityPoolOptions {
  /** First token contract ID (e.g., 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao') */
  tokenA: string;
  /** Second token contract ID (e.g., 'solana-USDC000000') */
  tokenB: string;
  /** Amount of token A in user-friendly units (e.g., '100' for 100 KALV) */
  amountA: AmountInput;
  /** Amount of token B in user-friendly units (e.g., '12' for 12 USDC) */
  amountB: AmountInput;
  /** Fee rate for the pool (basis points, e.g., 25 = 0.25%) */
  feeRate: number;
  /**
   * Lock duration in seconds from now.
   * If provided, LP tokens are locked until `now + lockDuration`.
   * Defaults to 60 seconds.
   */
  lockDuration?: number;
}

/**
 * Options for adding liquidity to an existing pool
 * 
 * Amounts are user-friendly and auto-converted to smallest units.
 */
export interface AddLiquidityOptions {
  /** First token contract ID */
  tokenA: string;
  /** Second token contract ID */
  tokenB: string;
  /** Amount of token A in user-friendly units (e.g., '50' for 50 tokens) */
  amountA: AmountInput;
  /** Amount of token B in user-friendly units (e.g., '100' for 100 tokens) */
  amountB: AmountInput;
  /** Fee rate identifying the pool (basis points) */
  feeRate: number;
  /**
   * Lock duration in seconds from now.
   * If provided, LP tokens are locked until `now + lockDuration`.
   * Defaults to 60 seconds.
   */
  lockDuration?: number;
}

/**
 * Options for removing liquidity from a pool
 */
export interface RemoveLiquidityOptions {
  /** First token contract ID */
  tokenA: string;
  /** Second token contract ID */
  tokenB: string;
  /** Amount of LP tokens to redeem in user-friendly units (LP tokens always have 9 decimals) */
  lpAmount: AmountInput;
  /** Fee rate identifying the pool (basis points) */
  feeRate: number;
}

/**
 * Options for unlocking LP tokens
 */
export interface UnlockLiquidityOptions {
  /** First token contract ID */
  tokenA: string;
  /** Second token contract ID */
  tokenB: string;
  /** Fee rate identifying the pool (basis points) */
  feeRate: number;
}

/**
 * Options for executing a swap
 * 
 * `amountIn` is user-friendly and auto-converted to smallest units.
 */
export interface SwapOptions {
  /** Token to sell contract ID */
  tokenIn: string;
  /** Token to buy contract ID */
  tokenOut: string;
  /** Amount of tokenIn to swap in user-friendly units (e.g., '5.5' for 5.5 tokens) */
  amountIn: AmountInput;
  /** Fee rate identifying the pool (basis points) */
  feeRate: number;
  /** 
   * Platform fee in basis points (e.g., 100 = 1%).
   * This fee is taken from the output and sent to `platformFeeAddress`.
   * Set to 0 for no platform fee.
   */
  platformFeeBps: number;
  /**
   * Address to receive the platform fee.
   * Required when `platformFeeBps` > 0.
   * If omitted or empty, no platform fee is charged.
   */
  platformFeeAddress?: string;
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Result from DEX transaction builders
 */
export interface DexTransactionResult {
  /** The created transaction (not yet sent) */
  transaction: SmartContractExecuteTXN;
}
