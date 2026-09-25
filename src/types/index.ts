/**
 * Core Type Definitions for Kalvora JS SDK
 * 
 * Simple, practical TypeScript types focused on real benefits:
 * - Better error handling with Result types
 * - Proper generics instead of 'any'
 * - Basic utility types for common patterns
 */

import type { Transport } from '@connectrpc/connect';
import { Decimal } from 'decimal.js';

import {
  HASH_TYPE,
  KEY_TYPE,
  VALID_HASH_TYPES,
  VALID_KEY_TYPES,
  isValidHashType,
  isValidKeyType,
  type HashType,
  type KeyType
} from '../shared/crypto/constants.js';
import {
  MNEMONIC_LENGTHS,
  isValidMnemonicLength,
  type MnemonicLength
} from '../wallet-creation/constants.js';

// Simple error types
export class KalvoraError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'KalvoraError';
  }
}

export class ValidationError extends KalvoraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NetworkError extends KalvoraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', details);
    this.name = 'NetworkError';
  }
}

export class CryptoError extends KalvoraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CRYPTO_ERROR', details);
    this.name = 'CryptoError';
  }
}

export class TransactionError extends KalvoraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'TRANSACTION_ERROR', details);
    this.name = 'TransactionError';
  }
}

// Simple Result type for better error handling
export type Result<T, E = Error> = 
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: E };

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

// Simple utility functions
export function createSuccess<T>(data: T): Result<T, never> {
  return { success: true, data };
}

export function createError<E>(error: E): Result<never, E> {
  return { success: false, error };
}

export function isSuccess<T, E>(result: Result<T, E>): result is { success: true; data: T } {
  return result.success;
}

export function isError<T, E>(result: Result<T, E>): result is { success: false; error: E } {
  return !result.success;
}

// Enhanced error handling utilities
export function unwrapResult<T, E>(result: Result<T, E>): T {
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

export function unwrapResultOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.success) {
    return result.data;
  }
  return defaultValue;
}

export function mapResult<T, U, E>(
  result: Result<T, E>,
  mapper: (data: T) => U
): Result<U, E> {
  if (result.success) {
    return createSuccess(mapper(result.data));
  }
  return result;
}

export function mapError<T, E, F>(
  result: Result<T, E>,
  mapper: (error: E) => F
): Result<T, F> {
  if (result.success) {
    return result;
  }
  return createError(mapper(result.error));
}

// Async result utilities
export async function asyncMapResult<T, U, E>(
  result: AsyncResult<T, E>,
  mapper: (data: T) => Promise<U>
): Promise<Result<U, E>> {
  const resolved = await result;
  if (resolved.success) {
    try {
      const mapped = await mapper(resolved.data);
      return createSuccess(mapped);
    } catch (error) {
      return createError(error as E);
    }
  }
  return resolved;
}

// Error context utilities
export function withContext<T, E extends Error>(
  result: Result<T, E>,
  context: string
): Result<T, E> {
  if (result.success) {
    return result;
  }
  
  const error = result.error;
  if (error instanceof Error) {
    error.message = `${context}: ${error.message}`;
  }
  
  return result;
}

// ============================================================================
// ENUMS AND CONSTANTS
// ============================================================================


// Re-export for external use
export type { KeyType, HashType, MnemonicLength };
export { KEY_TYPE, HASH_TYPE, VALID_KEY_TYPES, VALID_HASH_TYPES, MNEMONIC_LENGTHS };

// ============================================================================
// WALLET TYPES
// ============================================================================

/**
 * HD wallet derivation options
 */
export interface HDOptions {
  /** Account index (default: 0) */
  accountIndex?: number;
  /** Change index - 0 for external, 1 for internal (default: 0) */
  changeIndex?: 0 | 1;
  /** Address index (default: 0) */
  addressIndex?: number;
}

/**
 * Wallet creation options
 */
export interface WalletOptions {
  /** Key type from KEY_TYPE enum */
  keyType: KeyType;
  /** Array of hash types from HASH_TYPE enum (optional, defaults to key-only mode) */
  hashTypes?: HashType[];
  /** BIP39 mnemonic phrase (required) */
  mnemonic: string;
  /** Optional passphrase for additional security */
  passphrase?: string;
  /** HD wallet derivation options */
  hdOptions?: HDOptions;
  /**
   * Optional pre-computed seed (64 bytes). When provided, skips the internal
   * mnemonicToSeedSync PBKDF2 derivation. This allows callers (e.g., React Native)
   * to provide a seed derived via native crypto without blocking the JS thread.
   */
  seed?: Uint8Array;
}

/**
 * Wallet object returned from createWallet
 */
export interface Wallet {
  /** Wallet type identifier */
  type: 'hd';
  /** BIP39 mnemonic phrase */
  mnemonic: string;
  /** Private key in base58 format */
  privateKey: string;
  /** Wallet address */
  address: string;
  /** Public key identifier */
  publicKey: string;
  /** Public key package (comprehensive binary format) */
  publicKeyPackage: string;
  /** Coin type identifier */
  coinType: number;
  /** Currency symbol */
  symbol: string;
  /** Currency name */
  name: string;
  /** SLIP-0010 derivation path */
  derivationPath: string;
  /** Key type used */
  keyType: KeyType;
  /** Hash types used (empty/undefined for key-only format) */
  hashTypes?: HashType[];
  /** Extended private key */
  extendedPrivateKey: string;
  /** Extended public key */
  extendedPublicKey: string;
  /** Fingerprint */
  fingerprint: string;
  /** HD depth */
  depth: number;
  /** HD index */
  index: number;
  /** Secure memory clearing method */
  secureClear: () => void;
}

/**
 * Multiple wallet derivation options
 */
export interface MultipleWalletOptions extends WalletOptions {
  /** Number of wallets to derive (default: 1) */
  count?: number;
}

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

/**
 * CoinTXN input object
 */
export interface CoinTXNInput {
  /** Private key in base58 format */
  privateKey?: string; // should be specifed if not an allowance
  /** Public key identifier */
  publicKey?: string; // should be specifed if not an allowance
  /** Amount to spend (user-friendly format) */
  amount?: AmountInput; // should be specifed if not an allowance
  /** Fee percentage (default: '100') */
  feePercent?: string;
  /** Key type (optional, auto-detected if not provided) */
  keyType?: KeyType;
  /** Allowance address (for allowance transactions) */
  allowanceAddress?: string;
  /**
   * Optional nonce override. When provided, skips network nonce fetch for this input.
   * WARNING: Manually specified nonces are not validated. Incorrect nonces will cause transaction failure.
   */
  nonce?: string | number | bigint;
}

/**
 * CoinTXN output object
 */
export interface CoinTXNOutput {
  /** Recipient address */
  to: string;
  /** Amount to send (user-friendly format) */
  amount: AmountInput;
  /** Optional memo for this output */
  memo?: string;
}


/**
 * gRPC configuration options
 */
export interface GRPCConfig {
  /** Full endpoint URL (overrides host/port if provided) */
  endpoint?: string;
  /** Host address (default: 'kal-protonet.visiondynamics.ch') */
  host?: string;
  /** Port number */
  port?: number;
  /** Protocol to use (default: 'https') */
  protocol?: 'http' | 'https';
  /** Additional Node.js options for the transport */
  nodeOptions?: Record<string, unknown>;
  /** Connection timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Retry delay in milliseconds (default: 1000) */
  retryDelay?: number;
  /** Custom ConnectRPC transport */
  transport?: Transport;
  /** Custom fetch implementation (e.g. for node-fetch with custom agent) */
  fetch?: typeof globalThis.fetch;
  /** Whether to reject unauthorized SSL certificates (default: true). Set to false for self-signed certs. */
  rejectUnauthorized?: boolean;
  /** Whether to fallback to HTTP if HTTPS fails (default: false; loopback/private development hosts only) */
  fallbackToHttp?: boolean;
  /** Port to use for fallback HTTP connection (default: 8080) */
  fallbackPort?: number;
}


// ============================================================================
// API TYPES
// ============================================================================

/**
 * Exchange rate options
 */
export interface ExchangeRateOptions {
  /** Host for the exchange rate service */
  host?: string;
  /** Port for the exchange rate service */
  port?: number;
  /** Protocol to use */
  protocol?: 'http' | 'https';
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base error interface for wallet creation operations
 */
export interface WalletCreationErrorInterface extends Error {
  /** Error code */
  code: string;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** Error timestamp */
  timestamp: string;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Type for amounts that can be converted to Decimal
 */
export type AmountInput = string | number | Decimal;

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Validation result interface
 */
export interface ValidationResult {
  /** Whether the validation passed */
  isValid: boolean;
  /** Error message if validation failed */
  error?: string;
  /** Additional validation details */
  details?: Record<string, unknown>;
}


// Re-export for external use
export { isValidKeyType, isValidHashType, isValidMnemonicLength };
