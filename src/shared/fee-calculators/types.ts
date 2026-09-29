/**
 * Contract Fee Calculator Types
 * 
 * Type definitions for contract fee calculation functionality.
 */

import { Decimal } from 'decimal.js';

/**
 * Contract fee configuration interface
 * Defines the structure for contract fee information
 */
export interface ContractFeeConfig {
  /** Fee type: FIXED, PERCENTAGE, CUR_EQUIVALENT, or NONE */
  feeType: number;
  /** Fee amount or percentage as string */
  feeAmount: string;
  /** Array of contract IDs that can be used to pay the fee */
  allowedFeeIds: string[];
  /** Optional fee percentage (for percentage-based fees) */
  feePercentage?: number;
  /** Optional minimum fee amount */
  minimumFee?: string;
  /** Optional maximum fee amount */
  maximumFee?: string;
  /** Allow additional properties for extensibility */
  [key: string]: unknown;
}

/**
 * Contract fee service options
 */
export interface ContractFeeServiceOptions {
  /** API endpoint for fetching contract fee data */
  apiEndpoint?: string;
  /** Cache timeout in milliseconds */
  cacheTimeout?: number;
}

/**
 * Contract fee calculation parameters
 */
export interface ContractFeeCalculationParams {
  /** Contract ID to calculate fees for */
  contractId: string;
  /** Transaction amount */
  transactionAmount: string | number;
  /** Optional fee contract ID (defaults to first allowed fee ID) */
  feeContractId?: string;
  /** Optional transaction contract ID (defaults to contractId) */
  transactionContractId?: string;
  /** Optional exchange rates map for currency conversion */
  exchangeRates?: Map<string, Decimal>;
}

/**
 * Contract fee calculation result
 */
export interface ContractFeeCalculationResult {
  /** Calculated fee as string */
  fee: string;
  /** Calculated fee as Decimal object */
  feeDecimal: Decimal;
  /** Contract ID */
  contractId: string;
  /** Contract fee type */
  contractFeeType: number;
  /** Contract fee amount */
  contractFeeAmount: string;
  /** Fee contract ID used */
  feeContractId: string;
  /** Allowed fee contract IDs */
  allowedFeeIds: string[];
  /** Detailed breakdown of the calculation */
  breakdown: {
    contractId: string;
    contractFeeType: number;
    contractFeeAmount: string;
    transactionAmount: string;
    calculatedFee: string;
    feeContractId: string;
    allowedFeeIds: string[];
    transactionContractId: string;
  };
}
