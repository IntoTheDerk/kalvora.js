/**
 * Kalvora Bridge Transaction Types
 * 
 * Type definitions for all Kalvora-side bridge operations.
 */

import type { ZeraPayload } from '../../../../../proto/generated/guardian_pb.js';
import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import type { GRPCConfig } from '../../../../types/index.js';
import type { CreateSmartContractExecuteOptions } from '../../../execute/index.js';

// ============================================================================
// BASE OPTIONS
// ============================================================================

/**
 * Base options for all Kalvora bridge transactions
 */
export interface BridgeKalvoraOptions extends Omit<CreateSmartContractExecuteOptions, 'feeId'> {
  /** gRPC configuration for network communication */
  grpcConfig?: GRPCConfig;
  /** Optional fee ID (defaults to the token being bridged) */
  feeId?: string;
}

/**
 * Options for burning wrapped SOL tokens on Kalvora
 */
export interface BurnSolOptions extends BridgeKalvoraOptions {
  /** Token denomination for amount conversion (e.g., 'SOL', 'USDC') */
  denomination?: string;
}

// ============================================================================
// RELEASE OPTIONS (Solana → Kalvora)
// ============================================================================

/**
 * Options for releasing Kalvora tokens (from Solana lock)
 */
export interface ReleaseKalvoraOptions extends BridgeKalvoraOptions {
  /** Guardian-signed payload from the Guardian service */
  payload: ZeraPayload;
}

/**
 * Options for minting wrapped SOL on Kalvora
 */
export interface MintSolOptions extends BridgeKalvoraOptions {
  /** Guardian-signed payload from the Guardian service */
  payload: ZeraPayload;
}

/**
 * Options for creating wrapped SOL token on Kalvora (first time)
 */
export interface CreateSolOptions extends BridgeKalvoraOptions {
  /** Guardian-signed payload from the Guardian service */
  payload: ZeraPayload;
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Result from lock operations
 */
export interface LockKalvoraResult {
  /** The created transaction */
  transaction: SmartContractExecuteTXN;
}

/**
 * Result from release operations
 */
export interface ReleaseKalvoraResult {
  /** The created transaction */
  transaction: SmartContractExecuteTXN;
}

/**
 * Result from mint operations
 */
export interface MintSolResult {
  /** The created transaction */
  transaction: SmartContractExecuteTXN;
}

/**
 * Result from create operations
 */
export interface CreateSolResult {
  /** The created transaction */
  transaction: SmartContractExecuteTXN;
}

/**
 * Result from burn operations
 */
export interface BurnSolResult {
  /** The created transaction */
  transaction: SmartContractExecuteTXN;
}
