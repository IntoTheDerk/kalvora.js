import { ERROR_MESSAGES } from './constants.js';

/**
 * Base error class for wallet creation operations
 */
export class WalletCreationError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown> | null;
  public readonly timestamp: string;

  constructor(message: string, code: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'WalletCreationError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Error for invalid key types
 */
export class InvalidKeyTypeError extends WalletCreationError {
  constructor(keyType: string, supportedTypes: readonly string[] = ['ed25519', 'ed448']) {
    super(
      `${ERROR_MESSAGES.INVALID_KEY_TYPE} (received: ${keyType})`,
      'INVALID_KEY_TYPE',
      { received: keyType, supported: supportedTypes }
    );
    this.name = 'InvalidKeyTypeError';
  }
}

/**
 * Error for invalid hash types
 */
export class InvalidHashTypeError extends WalletCreationError {
  constructor(hashType: string, supportedTypes: readonly string[] = ['sha3-256', 'sha3-512', 'blake3']) {
    super(
      `${ERROR_MESSAGES.INVALID_HASH_TYPE} (received: ${hashType})`,
      'INVALID_HASH_TYPE',
      { received: hashType, supported: supportedTypes }
    );
    this.name = 'InvalidHashTypeError';
  }
}

/**
 * Error for invalid mnemonic lengths
 */
export class InvalidMnemonicLengthError extends WalletCreationError {
  constructor(length: number, supportedLengths: readonly number[] = [12, 15, 18, 21, 24]) {
    super(
      `${ERROR_MESSAGES.INVALID_MNEMONIC_LENGTH} (received: ${length})`,
      'INVALID_MNEMONIC_LENGTH',
      { received: length, supported: supportedLengths }
    );
    this.name = 'InvalidMnemonicLengthError';
  }
}

/**
 * Error for invalid mnemonic phrases
 */
export class InvalidMnemonicError extends WalletCreationError {
  constructor(_mnemonic: string, reason: string = 'Invalid BIP39 format') {
    super(
      `${ERROR_MESSAGES.INVALID_MNEMONIC}: ${reason}`,
      'INVALID_MNEMONIC',
      { reason }
    );
    this.name = 'InvalidMnemonicError';
  }
}

/**
 * Error for invalid derivation paths
 */
export class InvalidDerivationPathError extends WalletCreationError {
  constructor(path: string, reason: string = 'Invalid format') {
    super(
      `${ERROR_MESSAGES.INVALID_DERIVATION_PATH}: ${reason}`,
      'INVALID_DERIVATION_PATH',
      { path, reason }
    );
    this.name = 'InvalidDerivationPathError';
  }
}

/**
 * Error for invalid HD wallet parameters
 */
export class InvalidHDParameterError extends WalletCreationError {
  constructor(parameter: string, value: string | number, reason: string) {
    super(
      `Invalid HD parameter '${parameter}': ${reason}`,
      'INVALID_HD_PARAMETER',
      { parameter, value, reason }
    );
    this.name = 'InvalidHDParameterError';
  }
}

/**
 * Error for missing required parameters
 */
export class MissingParameterError extends WalletCreationError {
  constructor(parameter: string, context: string = '') {
    const message = context 
      ? `${ERROR_MESSAGES[`${parameter.toUpperCase()}_REQUIRED` as keyof typeof ERROR_MESSAGES]} in ${context}`
      : ERROR_MESSAGES[`${parameter.toUpperCase()}_REQUIRED` as keyof typeof ERROR_MESSAGES];
    
    super(message, 'MISSING_PARAMETER', { parameter, context });
    this.name = 'MissingParameterError';
  }
}

/**
 * Error for cryptographic operations
 */
export class CryptographicError extends WalletCreationError {
  constructor(operation: string, reason: string) {
    super(
      `Cryptographic operation '${operation}' failed: ${reason}`,
      'CRYPTOGRAPHIC_ERROR',
      { operation, reason }
    );
    this.name = 'CryptographicError';
  }
}
