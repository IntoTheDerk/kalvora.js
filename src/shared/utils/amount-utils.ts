/**
 * Amount Utilities for Blockchain Operations
 * Provides exact decimal arithmetic and BigInt support for blockchain amounts
 * 
 * This module handles:
 * - Exact decimal arithmetic using decimal.js
 * - BigInt operations for integer amounts
 * - Conversion between different amount formats
 * - Precision handling for different token decimals
 */

import Decimal from 'decimal.js';

import type { AmountInput } from '../../types/index.js';
import { KALVORA_NATIVE_TOKEN } from '../network/constants.js';

import { getTokenDecimals } from './token-config.js';

// Configure decimal.js for maximum precision
Decimal.set({
  precision: 50,        // High precision for blockchain calculations
  rounding: Decimal.ROUND_DOWN, // Always round down for blockchain safety
  toExpNeg: -50,        // Support very small numbers
  toExpPos: 50,         // Support very large numbers
  maxE: 9e15,           // Maximum exponent
  minE: -9e15           // Minimum exponent
});

/**
 * Convert various amount types to Decimal for exact arithmetic
 */
export function toDecimal(amount: AmountInput): Decimal {
  if (amount instanceof Decimal) {
    return amount;
  }
  if (typeof amount === 'bigint') {
    return new Decimal((amount as bigint).toString());
  }
  if (typeof amount === 'string') {
    // Validate it's a valid number string
    if (!/^-?\d+(\.\d+)?$/.test(amount)) {
      throw new Error(`Invalid amount string: ${amount}`);
    }
    return new Decimal(amount);
  }
  if (typeof amount === 'number') {
    // Convert number to string first to avoid floating point issues
    return new Decimal(amount.toString());
  }
  throw new Error(`Invalid amount type: ${typeof amount}`);
}


/**
 * Add multiple amounts with exact decimal arithmetic
 */
export function addAmounts(...amounts: AmountInput[]): Decimal {
  return amounts.reduce<Decimal>((sum: Decimal, amount: AmountInput) => {
    return sum.add(toDecimal(amount));
  }, new Decimal(0));
}

/**
 * Subtract multiple amounts with exact decimal arithmetic
 */
export function subtractAmounts(minuend: AmountInput, ...subtrahends: AmountInput[]): Decimal {
  const minuendDecimal = toDecimal(minuend);
  return subtrahends.reduce<Decimal>((result: Decimal, subtrahend: AmountInput) => {
    return result.sub(toDecimal(subtrahend));
  }, minuendDecimal);
}

/**
 * Multiply amounts with exact decimal arithmetic
 */
export function multiplyAmounts(...amounts: AmountInput[]): Decimal {
  return amounts.reduce<Decimal>((product: Decimal, amount: AmountInput) => {
    return product.mul(toDecimal(amount));
  }, new Decimal(1));
}

/**
 * Divide amounts with exact decimal arithmetic
 */
export function divideAmounts(dividend: AmountInput, divisor: AmountInput): Decimal {
  const dividendDecimal = toDecimal(dividend);
  const divisorDecimal = toDecimal(divisor);
  
  if (divisorDecimal.isZero()) {
    throw new Error('Division by zero');
  }
  
  return dividendDecimal.div(divisorDecimal);
}

/**
 * Compare two amounts
 * @param {AmountInput} a - First amount
 * @param {AmountInput} b - Second amount
 * @returns {number} -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareAmounts(a: AmountInput, b: AmountInput): number {
  const aDecimal = toDecimal(a);
  const bDecimal = toDecimal(b);
  return aDecimal.comparedTo(bDecimal);
}

/**
 * Check if amount is zero
 */
export function isZeroAmount(amount: AmountInput): boolean {
  return toDecimal(amount).isZero();
}

/**
 * Check if amount is positive
 */
export function isPositiveAmount(amount: AmountInput): boolean {
  return toDecimal(amount).isPositive();
}

/**
 * Check if amount is negative
 */
export function isNegativeAmount(amount: AmountInput): boolean {
  return toDecimal(amount).isNegative();
}

/**
 * Get the absolute value of an amount
 */
export function absAmount(amount: AmountInput): Decimal {
  return toDecimal(amount).abs();
}

/**
 * Round amount to specified decimal places
 */
export function roundAmount(amount: AmountInput, decimalPlaces: number): Decimal {
  return toDecimal(amount).toDecimalPlaces(decimalPlaces);
}

/**
 * Floor amount (round down)
 */
export function floorAmount(amount: AmountInput): Decimal {
  return toDecimal(amount);
}

/**
 * Ceiling amount (round up)
 */
export function ceilAmount(amount: AmountInput): Decimal {
  return toDecimal(amount);
}

/**
 * Validate amount balance (inputs >= outputs)
 */
export function validateAmountBalance(inputAmounts: AmountInput[], outputAmounts: AmountInput[]): boolean {
  const totalInputs = addAmounts(...inputAmounts);
  const totalOutputs = addAmounts(...outputAmounts);
  
  if (totalInputs.lt(totalOutputs)) {
    throw new Error(`Insufficient balance: inputs (${totalInputs.toString()}) < outputs (${totalOutputs.toString()})`);
  }
  
  return true;
}

/**
 * Validate that input amounts exactly equal output amounts for coin transactions
 * 
 * @param inputAmounts - Array of input amounts
 * @param outputAmounts - Array of output amounts
 * @returns true if amounts are exactly equal
 * @throws Error if amounts are not equal
 */
export function validateExactAmountBalance(inputAmounts: AmountInput[], outputAmounts: AmountInput[]): boolean {
  const totalInputs = addAmounts(...inputAmounts);
  const totalOutputs = addAmounts(...outputAmounts);
  
  if (!totalInputs.equals(totalOutputs)) {
    throw new Error(`Amount mismatch in coin transaction: inputs (${totalInputs.toString()}) !== outputs (${totalOutputs.toString()}). Difference: ${totalInputs.sub(totalOutputs).toString()}`);
  }
  
  return true;
}

/**
 * Calculate percentage of an amount
 */
export function calculatePercentage(amount: AmountInput, percentage: AmountInput): Decimal {
  const amountDecimal = toDecimal(amount);
  const percentageDecimal = toDecimal(percentage);
  return amountDecimal.mul(percentageDecimal).div(100);
}

/**
 * Format amount for display with proper decimal places
 */
export function formatAmount(amount: AmountInput, contractId: string = KALVORA_NATIVE_TOKEN, showSymbol: boolean = true): string {
  const amountDecimal = toDecimal(amount);
  const decimals = getTokenDecimals(contractId);
  const formattedAmount = amountDecimal.toFixed(decimals);
  
  if (showSymbol) {
    const symbol = contractId.split('+')[0]?.substring(1); // Extract symbol from contract ID
    if (!symbol) {
      throw new Error(`Invalid contract ID format: ${contractId}`);
    }
    return `${formattedAmount} ${symbol}`;
  }
  
  return formattedAmount;
}

/**
 * Parse amount from string with validation
 */
export function parseAmount(amountString: string): Decimal {
  if (typeof amountString !== 'string') {
    throw new Error('Amount string must be a string');
  }
  
  // Remove any whitespace
  const cleaned = amountString.trim();
  
  // Validate format
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Invalid amount format: ${amountString}`);
  }
  
  return new Decimal(cleaned);
}

/**
 * Convert amount to BigInt (for integer operations)
 */
export function toBigInt(amount: AmountInput): bigint {
  const amountDecimal = toDecimal(amount);
  
  if (!amountDecimal.isInteger()) {
    throw new Error('Amount must be an integer to convert to BigInt');
  }
  
  return BigInt(amountDecimal.toString());
}

/**
 * Convert BigInt to Decimal
 */
export function fromBigInt(bigIntAmount: bigint): Decimal {
  return new Decimal(bigIntAmount.toString());
}

/**
 * Get minimum amount for a contract (1 unit in smallest denomination)
 */
export function getMinimumAmount(contractId: string = KALVORA_NATIVE_TOKEN): Decimal {
  const decimals = getTokenDecimals(contractId);
  return new Decimal(10).pow(-decimals);
}

/**
 * Check if amount meets minimum requirement
 */
export function meetsMinimumAmount(amount: AmountInput, contractId: string = KALVORA_NATIVE_TOKEN): boolean {
  const amountDecimal = toDecimal(amount);
  const minimumAmount = getMinimumAmount(contractId);
  return amountDecimal.gte(minimumAmount);
}

// Re-export Decimal for convenience
export { Decimal };
