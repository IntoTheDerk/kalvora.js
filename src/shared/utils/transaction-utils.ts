/**
 * Shared Transaction Utilities for Kalvora JS SDK
 * Common utilities for transaction operations (transfer, mint, etc.)
 */

// Import protobuf enums directly
import Decimal from 'decimal.js';

import { 
  TRANSACTION_TYPE, 
  CONTRACT_FEE_TYPE,
  TXN_STATUS,
  GOVERNANCE_TYPE,
  CONTRACT_TYPE,
  LANGUAGE,
  PROPOSAL_PERIOD,
  VARIABLE_TYPE
} from '../../../proto/generated/txn_pb.js';

import { toDecimal } from './amount-utils.js';

// Re-export for external use
export { 
  TRANSACTION_TYPE, 
  CONTRACT_FEE_TYPE,
  TXN_STATUS,
  GOVERNANCE_TYPE,
  CONTRACT_TYPE,
  LANGUAGE,
  PROPOSAL_PERIOD,
  VARIABLE_TYPE
};

// ============================================================================
// TRANSACTION INTERFACES
// ============================================================================

/**
 * Base transaction interface
 */
export interface BaseTransaction {
  id: string;
  type: string;
  from: string;
  to: string;
  amount: number;
  memo?: string;
  fee?: number;
  status: string;
  timestamp: number;
  createdAt: string;
}

/**
 * Transaction with signature
 */
export interface SignedTransaction extends BaseTransaction {
  signature: string;
  signedAt: string;
}

/**
 * Transaction with metadata
 */
export interface TransactionWithMetadata extends BaseTransaction {
  updatedAt: string;
  [key: string]: unknown;
}

/**
 * Transaction validation utilities
 */
export class TransactionValidator {
  /**
   * Validate transaction amount
   * @param amount - Transaction amount
   * @param options - Validation options
   * @returns Validation result
   */
  static validateAmount(amount: number | string, options: {
    minAmount?: number;
    maxAmount?: number;
    decimals?: number;
  } = {}): { valid: boolean; error?: string; amount?: number } {
    const { minAmount = 0, maxAmount = Number.MAX_SAFE_INTEGER, decimals = 18 } = options;
    
    // Convert to Decimal for precise comparison
    const decimalAmount = typeof amount === 'string' ? toDecimal(amount) : new Decimal(amount);
    
    if (decimalAmount.isNaN()) {
      return { valid: false, error: 'Amount must be a valid number' };
    }
    
    if (decimalAmount.lte(0)) {
      return { valid: false, error: 'Amount must be greater than zero' };
    }
    
    if (decimalAmount.lt(minAmount)) {
      return { valid: false, error: `Amount must be at least ${minAmount}` };
    }
    
    if (decimalAmount.gt(maxAmount)) {
      return { valid: false, error: `Amount must not exceed ${maxAmount}` };
    }
    
    // Check decimal precision
    const decimalPlaces = decimalAmount.decimalPlaces();
    if (decimalPlaces > decimals) {
      return { valid: false, error: `Amount cannot have more than ${decimals} decimal places` };
    }
    
    return { valid: true, amount: decimalAmount.toNumber() };
  }


  /**
   * Validate transaction memo/note
   * @param memo - Transaction memo
   * @param options - Validation options
   * @returns Validation result
   */
  static validateMemo(memo: string, options: {
    maxLength?: number;
    allowEmpty?: boolean;
  } = {}): { valid: boolean; error?: string; memo?: string } {
    const { maxLength = 256, allowEmpty = true } = options;
    
    if (!memo && allowEmpty) {
      return { valid: true };
    }
    
    if (!memo && !allowEmpty) {
      return { valid: false, error: 'Memo is required' };
    }
    
    if (typeof memo !== 'string') {
      return { valid: false, error: 'Memo must be a string' };
    }
    
    if (memo.length > maxLength) {
      return { valid: false, error: `Memo cannot exceed ${maxLength} characters` };
    }
    
    return { valid: true, memo: memo.trim() };
  }

  /**
   * Validate transaction fee
   * @param fee - Transaction fee
   * @param options - Validation options
   * @returns Validation result
   */
  static validateFee(fee: number | string, options: {
    minFee?: number;
    maxFee?: number;
    decimals?: number;
  } = {}): { valid: boolean; error?: string; fee?: number } {
    const { minFee = 0, maxFee = Number.MAX_SAFE_INTEGER } = options;
    
    const decimalFee = typeof fee === 'string' ? toDecimal(fee) : new Decimal(fee);
    
    if (decimalFee.isNaN()) {
      return { valid: false, error: 'Fee must be a valid number' };
    }
    
    if (decimalFee.lt(minFee)) {
      return { valid: false, error: `Fee must be at least ${minFee}` };
    }
    
    if (decimalFee.gt(maxFee)) {
      return { valid: false, error: `Fee must not exceed ${maxFee}` };
    }
    
    return { valid: true, fee: decimalFee.toNumber() };
  }
}

/**
 * Transaction formatting utilities
 */
export class TransactionFormatter {
  /**
   * Format amount with proper decimal places
   * @param amount - Amount to format
   * @param options - Formatting options
   * @returns Formatted amount
   */
  static formatAmount(amount: number | string, options: {
    decimals?: number;
    showSymbol?: boolean;
    symbol?: string;
  } = {}): string {
    const { decimals = 18, showSymbol = false, symbol = 'KAL' } = options;
    
    const decimalAmount = typeof amount === 'string' ? toDecimal(amount) : new Decimal(amount);
    
    if (decimalAmount.isNaN()) {
      return '0';
    }
    
    const formatted = decimalAmount.toFixed(decimals).replace(/\.?0+$/, '');
    return showSymbol ? `${formatted} ${symbol}` : formatted;
  }

  /**
   * Format transaction ID for display
   * @param txId - Transaction ID
   * @param options - Formatting options
   * @returns Formatted transaction ID
   */
  static formatTransactionId(txId: string, options: {
    showFull?: boolean;
    prefixLength?: number;
    suffixLength?: number;
  } = {}): string {
    const { showFull = false, prefixLength = 8, suffixLength = 8 } = options;
    
    if (!txId || typeof txId !== 'string') {
      return 'Unknown';
    }
    
    if (showFull || txId.length <= prefixLength + suffixLength) {
      return txId;
    }
    
    return `${txId.substring(0, prefixLength)}...${txId.substring(txId.length - suffixLength)}`;
  }

  /**
   * Format timestamp for display
   * @param timestamp - Timestamp to format
   * @param options - Formatting options
   * @returns Formatted timestamp
   */
  static formatTimestamp(timestamp: number | Date, options: {
    format?: 'relative' | 'iso' | 'local';
    locale?: string;
  } = {}): string {
    const { format = 'relative', locale = 'en-US' } = options;
    
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    
    switch (format) {
    case 'relative':
      return this.getRelativeTime(date);
    case 'iso':
      return date.toISOString();
    case 'local':
      return date.toLocaleString(locale);
    default:
      return date.toString();
    }
  }

  /**
   * Get relative time string
   * @param date - Date to compare
   * @returns Relative time string
   */
  static getRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSeconds < 60) {
      return 'just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }
}


/**
 * Transaction builder utilities
 */
export class TransactionBuilder {
  /**
   * Build base transaction object
   * @param params - Transaction parameters
   * @returns Base transaction object
   */
  static buildBaseTransaction(params: {
    from: string;
    to: string;
    amount: number;
    memo?: string;
    fee?: number;
    type?: string;
  }): BaseTransaction {
    const {
      from,
      to,
      amount,
      memo = '',
      fee = 0,
      type = TRANSACTION_TYPE.COIN_TYPE
    } = params;
    
    return {
      id: this.generateTransactionId(),
      type: String(type),
      from,
      to,
      amount,
      memo,
      fee,
      status: String(TXN_STATUS.OK),
      timestamp: Date.now(),
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Generate unique transaction ID
   * @returns Transaction ID
   */
  static generateTransactionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2);
    return `tx_${timestamp}_${random}`;
  }

  /**
   * Add signature to transaction
   * @param transaction - Transaction object
   * @param signature - Transaction signature
   * @returns Transaction with signature
   */
  static addSignature(transaction: BaseTransaction, signature: string): SignedTransaction {
    return {
      ...transaction,
      signature,
      signedAt: new Date().toISOString()
    };
  }

  /**
   * Update transaction status
   * @param transaction - Transaction object
   * @param status - New status
   * @param metadata - Additional metadata
   * @returns Updated transaction
   */
  static updateStatus(transaction: BaseTransaction, status: string, metadata: Record<string, unknown> = {}): TransactionWithMetadata {
    return {
      ...transaction,
      status,
      updatedAt: new Date().toISOString(),
      ...metadata
    };
  }
}

/**
 * Transaction serialization utilities
 */
export class TransactionSerializer {
  /**
   * Serialize transaction for network transmission
   * @param transaction - Transaction object
   * @param options - Serialization options
   * @returns Serialized transaction
   */
  static serialize(transaction: BaseTransaction, options: {
    format?: 'json' | 'base64';
    includeSignature?: boolean;
  } = {}): string {
    const { format = 'json', includeSignature = true } = options;
    
    const serializable = { ...transaction };
    
    if (!includeSignature) {
      delete (serializable as Record<string, unknown>).signature;
    }
    
    switch (format) {
    case 'json':
      return JSON.stringify(serializable);
    case 'base64':
      return Buffer.from(JSON.stringify(serializable)).toString('base64');
    default:
      throw new Error(`Unsupported serialization format: ${format}`);
    }
  }

  /**
   * Deserialize transaction from network data
   * @param data - Serialized transaction data
   * @param options - Deserialization options
   * @returns Deserialized transaction
   */
  static deserialize(data: string, options: {
    format?: 'json' | 'base64';
  } = {}): BaseTransaction {
    const { format = 'json' } = options;
    
    let parsed: unknown;
    
    switch (format) {
    case 'json':
      parsed = JSON.parse(data);
      break;
    case 'base64':
      parsed = JSON.parse(Buffer.from(data, 'base64').toString());
      break;
    default:
      throw new Error(`Unsupported deserialization format: ${format}`);
    }
    
    return parsed as BaseTransaction;
  }
}

// Export all utilities (classes are already exported above)

export default {
  TXN_STATUS,
  TRANSACTION_TYPE,
  CONTRACT_FEE_TYPE,
  TransactionValidator,
  TransactionFormatter,
  TransactionBuilder,
  TransactionSerializer
};
