/**
 * Kalvora Bootstrapping Transaction Types
 *
 * Type definitions for the Kalvora LP bootstrapping protocol via the
 * `bootstrapping_proxy` smart contract.
 */

import type { SmartContractExecuteTXN } from '../../../../proto/generated/txn_pb.js';
import type { AmountInput, GRPCConfig } from '../../../types/index.js';
import type { CreateSmartContractExecuteOptions } from '../../execute/index.js';

// ============================================================================
// BASE OPTIONS
// ============================================================================

/**
 * Base options for all Kalvora bootstrapping transactions.
 */
export interface BootstrappingOptions extends Omit<CreateSmartContractExecuteOptions, 'feeId' | 'feeAmountParts'> {
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
// STAKE OPTIONS
// ============================================================================

/**
 * Options for locking LP tokens into the bootstrapping rewards contract.
 *
 * Parameter format expected by the contract:
 * `amount,term,lpTokenId`
 */
export interface StakeOptions {
  /** Amount to lock in user-friendly token units (SDK converts to 1e9 parts) */
  amount: AmountInput;
  /**
   * Lock term string.
   *
   * Supported values:
   * `30_days`, `90_days`, `6_months`, `1_year`, `2_years`,
   * `3_years`, `4_years`, `5_years`, `6_years`, `7_years`
   */
  term: string;
  /** Eligible LP token / pool token contract identifier */
  lpTokenId: string;
}

// ============================================================================
// UPDATE WALLET OPTIONS
// ============================================================================

/**
 * Options for updating the payout wallet associated with a bootstrapping LP position.
 */
export interface UpdateWalletOptions {
  /** New payout wallet address */
  walletAddress: string;
  /** Position identifier emitted by the contract */
  bumpId: AmountInput;
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Result from bootstrapping transaction builders.
 */
export interface BootstrappingTransactionResult {
  /** The created transaction (not yet sent) */
  transaction: SmartContractExecuteTXN;
}
