/**
 * Comprehensive Input Validation Utilities
 * 
 * Provides standardized validation functions for all SDK inputs
 * with consistent error handling and type safety.
 */

import type { 
  AmountInput, 
  KeyType,
  HashType
} from '../../types/index.js';
import { isKalvoraMintId, KALVORA_MINT_ID_ERROR } from '../network/constants.js';
import { Decimal } from '../utils/amount-utils.js';

import { 
  createValidationError,
  createErrorContext
} from './error-handler.js';

/**
 * Validation result interface
 */
export interface ValidationResult<T = unknown> {
  /** Whether the validation passed */
  isValid: boolean;
  /** Validated and potentially transformed value */
  value?: T;
  /** Error message if validation failed */
  error?: string;
  /** Additional validation details */
  details?: Record<string, unknown> | undefined;
}

/**
 * Validation options
 */
export interface ValidationOptions {
  /** Whether to throw on validation failure */
  throwOnError?: boolean;
  /** Custom error context */
  context?: string;
  /** Additional validation details */
  details?: Record<string, unknown>;
}

/**
 * Comprehensive input validator
 */
export class InputValidator {
  /** Validate a Kalvora mint ID. */
  static validateContractId(
    contractId: unknown,
    options: ValidationOptions = {}
  ): ValidationResult<string> {
    const context = options.context || 'validateContractId';
    
    if (!contractId) {
      const error = createValidationError(
        'Contract ID is required',
        createErrorContext(context, 'validation', { contractId })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    if (typeof contractId !== 'string') {
      const error = createValidationError(
        'Contract ID must be a string',
        createErrorContext(context, 'validation', { contractId, type: typeof contractId })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    if (!isKalvoraMintId(contractId)) {
      const error = createValidationError(
        `Invalid Kalvora mint ID: ${contractId}. Expected ${KALVORA_MINT_ID_ERROR}`,
        createErrorContext(context, 'validation', { contractId })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    return {
      isValid: true,
      value: contractId,
      details: options.details
    };
  }

  /**
   * Validate amount input
   */
  static validateAmount(
    amount: unknown,
    options: ValidationOptions & {
      minAmount?: AmountInput;
      maxAmount?: AmountInput;
      allowZero?: boolean;
      contractId?: string;
    } = {}
  ): ValidationResult<AmountInput> {
    const context = options.context || 'validateAmount';
    
    if (amount === undefined || amount === null || amount === '') {
      const error = createValidationError(
        'Amount is required',
        createErrorContext(context, 'validation', { amount })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    let decimalAmount: Decimal;
    
    try {
      if (amount instanceof Decimal) {
        decimalAmount = amount;
      } else if (typeof amount === 'string') {
        if (!/^-?\d+(\.\d+)?$/.test(amount)) {
          throw new Error('Invalid number format');
        }
        decimalAmount = new Decimal(amount);
      } else if (typeof amount === 'number') {
        decimalAmount = new Decimal(amount.toString());
      } else if (typeof amount === 'bigint') {
        decimalAmount = new Decimal(amount.toString());
      } else {
        throw new Error(`Invalid amount type: ${typeof amount}`);
      }
    } catch (error) {
      const validationError = createValidationError(
        `Invalid amount: ${error instanceof Error ? error.message : 'Unknown error'}`,
        createErrorContext(context, 'validation', { amount, type: typeof amount })
      );
      
      if (options.throwOnError) {
        throw validationError;
      }
      
      return {
        isValid: false,
        error: validationError.message,
        details: options.details
      };
    }
    
    // Check for zero
    if (decimalAmount.isZero() && !options.allowZero) {
      const error = createValidationError(
        'Amount cannot be zero',
        createErrorContext(context, 'validation', { amount: decimalAmount.toString() })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    // Check for negative amounts
    if (decimalAmount.isNegative()) {
      const error = createValidationError(
        'Amount cannot be negative',
        createErrorContext(context, 'validation', { amount: decimalAmount.toString() })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    // Check minimum amount
    if (options.minAmount !== undefined) {
      const minDecimal = new Decimal(options.minAmount.toString());
      if (decimalAmount.lt(minDecimal)) {
        const error = createValidationError(
          `Amount ${decimalAmount.toString()} is less than minimum ${minDecimal.toString()}`,
          createErrorContext(context, 'validation', { 
            amount: decimalAmount.toString(), 
            minAmount: minDecimal.toString() 
          })
        );
        
        if (options.throwOnError) {
          throw error;
        }
        
        return {
          isValid: false,
          error: error.message,
          details: options.details
        };
      }
    }
    
    // Check maximum amount
    if (options.maxAmount !== undefined) {
      const maxDecimal = new Decimal(options.maxAmount.toString());
      if (decimalAmount.gt(maxDecimal)) {
        const error = createValidationError(
          `Amount ${decimalAmount.toString()} is greater than maximum ${maxDecimal.toString()}`,
          createErrorContext(context, 'validation', { 
            amount: decimalAmount.toString(), 
            maxAmount: maxDecimal.toString() 
          })
        );
        
        if (options.throwOnError) {
          throw error;
        }
        
        return {
          isValid: false,
          error: error.message,
          details: options.details
        };
      }
    }
    
    return {
      isValid: true,
      value: amount as AmountInput,
      details: options.details
    };
  }

  /**
   * Validate base58 address
   */
  static validateBase58Address(
    address: unknown,
    options: ValidationOptions = {}
  ): ValidationResult<string> {
    const context = options.context || 'validateBase58Address';
    
    if (!address) {
      const error = createValidationError(
        'Address is required',
        createErrorContext(context, 'validation', { address })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    if (typeof address !== 'string') {
      const error = createValidationError(
        'Address must be a string',
        createErrorContext(context, 'validation', { address, type: typeof address })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    // Basic base58 validation
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) {
      const error = createValidationError(
        'Invalid base58 address format',
        createErrorContext(context, 'validation', { address })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    // Check reasonable length (base58 addresses are typically 20-50 characters)
    if (address.length < 20 || address.length > 50) {
      const error = createValidationError(
        `Address length ${address.length} is invalid. Expected 20-50 characters`,
        createErrorContext(context, 'validation', { address, length: address.length })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    return {
      isValid: true,
      value: address,
      details: options.details
    };
  }

  /**
   * Validate base58 key
   */
  static validateBase58Key(
    key: unknown,
    options: ValidationOptions = {}
  ): ValidationResult<string> {
    const context = options.context || 'validateBase58Key';
    
    if (!key) {
      const error = createValidationError(
        'Key is required',
        createErrorContext(context, 'validation', { key })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    if (typeof key !== 'string') {
      const error = createValidationError(
        'Key must be a string',
        createErrorContext(context, 'validation', { key, type: typeof key })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    // Basic base58 validation
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(key)) {
      const error = createValidationError(
        'Invalid base58 key format',
        createErrorContext(context, 'validation', { key })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    return {
      isValid: true,
      value: key,
      details: options.details
    };
  }

  /**
   * Validate key type
   */
  static validateKeyType(
    keyType: unknown,
    options: ValidationOptions = {}
  ): ValidationResult<KeyType> {
    const context = options.context || 'validateKeyType';
    
    if (!keyType) {
      const error = createValidationError(
        'Key type is required',
        createErrorContext(context, 'validation', { keyType })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    if (typeof keyType !== 'string') {
      const error = createValidationError(
        'Key type must be a string',
        createErrorContext(context, 'validation', { keyType, type: typeof keyType })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    const validKeyTypes = ['ed25519', 'ed448'];
    
    if (!validKeyTypes.includes(keyType.toLowerCase())) {
      const error = createValidationError(
        `Invalid key type: ${keyType}. Valid types: ${validKeyTypes.join(', ')}`,
        createErrorContext(context, 'validation', { keyType, validKeyTypes })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    return {
      isValid: true,
      value: keyType.toLowerCase() as KeyType,
      details: options.details
    };
  }

  /**
   * Validate hash types array
   */
  static validateHashTypes(
    hashTypes: unknown,
    options: ValidationOptions = {}
  ): ValidationResult<HashType[]> {
    const context = options.context || 'validateHashTypes';
    
    if (!hashTypes) {
      const error = createValidationError(
        'Hash types are required',
        createErrorContext(context, 'validation', { hashTypes })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    if (!Array.isArray(hashTypes)) {
      const error = createValidationError(
        'Hash types must be an array',
        createErrorContext(context, 'validation', { hashTypes, type: typeof hashTypes })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    if (hashTypes.length === 0) {
      const error = createValidationError(
        'Hash types array cannot be empty',
        createErrorContext(context, 'validation', { hashTypes })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    const validHashTypes = ['sha3_256', 'sha3_512', 'blake3'];
    const validatedHashTypes: HashType[] = [];
    
    for (let i = 0; i < hashTypes.length; i++) {
      const hashType = hashTypes[i];
      
      if (typeof hashType !== 'string') {
        const error = createValidationError(
          `Hash type at index ${i} must be a string`,
          createErrorContext(context, 'validation', { hashType, index: i })
        );
        
        if (options.throwOnError) {
          throw error;
        }
        
        return {
          isValid: false,
          error: error.message,
          details: options.details
        };
      }
      
      if (!validHashTypes.includes(hashType.toLowerCase())) {
        const error = createValidationError(
          `Invalid hash type at index ${i}: ${hashType}. Valid types: ${validHashTypes.join(', ')}`,
          createErrorContext(context, 'validation', { hashType, index: i, validHashTypes })
        );
        
        if (options.throwOnError) {
          throw error;
        }
        
        return {
          isValid: false,
          error: error.message,
          details: options.details
        };
      }
      
      validatedHashTypes.push(hashType.toLowerCase() as HashType);
    }
    
    return {
      isValid: true,
      value: validatedHashTypes,
      details: options.details
    };
  }

  /**
   * Validate mnemonic phrase
   */
  static validateMnemonic(
    mnemonic: unknown,
    options: ValidationOptions = {}
  ): ValidationResult<string> {
    const context = options.context || 'validateMnemonic';
    
    if (!mnemonic) {
      const error = createValidationError(
        'Mnemonic phrase is required',
        createErrorContext(context, 'validation', { mnemonic })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    if (typeof mnemonic !== 'string') {
      const error = createValidationError(
        'Mnemonic phrase must be a string',
        createErrorContext(context, 'validation', { mnemonic, type: typeof mnemonic })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    const words = mnemonic.trim().split(/\s+/);
    const validLengths = [12, 15, 18, 21, 24];
    
    if (!validLengths.includes(words.length)) {
      const error = createValidationError(
        `Invalid mnemonic length: ${words.length} words. Valid lengths: ${validLengths.join(', ')}`,
        createErrorContext(context, 'validation', { mnemonic, wordCount: words.length, validLengths })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    return {
      isValid: true,
      value: mnemonic.trim(),
      details: options.details
    };
  }

  /**
   * Validate multiple inputs at once
   */
  static validateMultiple(
    validations: Array<() => ValidationResult>,
    options: ValidationOptions = {}
  ): ValidationResult<unknown[]> {
    const context = options.context || 'validateMultiple';
    const results: unknown[] = [];
    const errors: string[] = [];
    
    for (let i = 0; i < validations.length; i++) {
      try {
        const result = validations[i]?.();
        if (!result?.isValid) {
          errors.push(`Validation ${i}: ${result?.error}`);
        } else {
          results.push(result.value);
        }
      } catch (error) {
        errors.push(`Validation ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    if (errors.length > 0) {
      const error = createValidationError(
        `Multiple validation errors: ${errors.join('; ')}`,
        createErrorContext(context, 'validation', { errors })
      );
      
      if (options.throwOnError) {
        throw error;
      }
      
      return {
        isValid: false,
        error: error.message,
        details: options.details
      };
    }
    
    return {
      isValid: true,
      value: results,
      details: options.details
    };
  }
}

/**
 * Convenience validation functions
 */
export const validateContractId = (contractId: unknown, options?: ValidationOptions) =>
  InputValidator.validateContractId(contractId, options);

/**
 * Simple boolean Kalvora mint-ID validation.
 * 
 * @param contractId - The contract ID to validate
 * @returns `true` if the contract ID format is valid, `false` otherwise
 * 
 * @example
 * ```typescript
 * isValidContractId('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');      // true
 * isValidContractId('solana:EPjFWdd5...'); // true
 * isValidContractId('');               // false
 * ```
 * 
 * @since 1.0.0
 */
export const isValidContractId = (contractId: string): boolean => {
  return isKalvoraMintId(contractId);
};

/**
 * Simple boolean address validation for Kalvora addresses
 * 
 * Validates that the address is properly base58 encoded and has reasonable length.
 * This is a lightweight validation for quick checks.
 * 
 * @param address - Address to validate
 * @returns `true` if valid, `false` otherwise
 * 
 * @example
 * ```typescript
 * isValidAddress('5KJvsngHeMby884zrh6A5u6b4SqzZzAb'); // true
 * isValidAddress('invalid'); // false
 * ```
 */
export const isValidAddress = (address: string): boolean => {
  if (!address || typeof address !== 'string') {
    return false;
  }

  try {
    // Basic base58 validation
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) {
      return false;
    }
    
    // Check reasonable length (base58 addresses are typically 20-50 characters)
    if (address.length < 20 || address.length > 50) {

      // Burn address is valid (base 58 encoded of :burn:)
      if (address === 'W5jE3KNH'){
        return true;
      }
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

export const validateAmount = (amount: unknown, options?: ValidationOptions & {
  minAmount?: AmountInput;
  maxAmount?: AmountInput;
  allowZero?: boolean;
  contractId?: string;
}) => InputValidator.validateAmount(amount, options);

export const validateBase58Address = (address: unknown, options?: ValidationOptions) =>
  InputValidator.validateBase58Address(address, options);

export const validateBase58Key = (key: unknown, options?: ValidationOptions) =>
  InputValidator.validateBase58Key(key, options);

export const validateKeyType = (keyType: unknown, options?: ValidationOptions) =>
  InputValidator.validateKeyType(keyType, options);

export const validateHashTypes = (hashTypes: unknown, options?: ValidationOptions) =>
  InputValidator.validateHashTypes(hashTypes, options);

export const validateMnemonic = (mnemonic: unknown, options?: ValidationOptions) =>
  InputValidator.validateMnemonic(mnemonic, options);
