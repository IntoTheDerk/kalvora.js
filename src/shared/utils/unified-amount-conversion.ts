/**
 * Unified Amount Conversion Utilities
 * 
 * Single smart function that handles all amount conversion scenarios:
 * 1. Uses cached token info if available (most efficient)
 * 2. Falls back to hardcoded cache if token exists there
 * 3. Defaults to 1:1 conversion with warning for unknown tokens
 */

import { Decimal } from 'decimal.js';

import type { AmountInput } from '../../types/index.js';
import { getDecimalPlacesFromDenomination } from '../fee-calculators/denomination-fallback.js';

import { getTokenDecimals } from './token-config.js';
import { type TokenInfo } from './token-info.js';

/**
 * Convert various amount types to Decimal for exact arithmetic
 */
function toDecimal(amount: AmountInput): Decimal {
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
 * Unified function to convert user-friendly amount to smallest units
 * 
 * This smart function tries multiple approaches in order of preference:
 * 1. Uses provided denomination if available (most efficient for transaction flows)
 * 2. Falls back to hardcoded token cache
 * 3. Defaults to 1:1 conversion with warning for unknown tokens
 * 
 * @param amount - Amount to convert
 * @param contractId - Contract ID for the token
 * @param options - Optional configuration
 * @param options.denomination - Pre-fetched denomination: smallest units per whole token, e.g. `'1000000000'`
 * @param options.tokenInfoMap - Pre-fetched token info map (efficient when available)
 * @returns string - Amount in smallest units
 * 
 * @example
 * ```typescript
 * import { toSmallestUnits, KALVORA_NATIVE_TOKEN } from 'kalvora.js';
 * 
 * // With denomination (most efficient for transaction code)
 * const amount = toSmallestUnits('1.5', KALVORA_NATIVE_TOKEN, { denomination: '1000000000' }); // '1500000000'
 * 
 * // With token info map
 * const amount = toSmallestUnits('1.5', KALVORA_NATIVE_TOKEN, { tokenInfoMap });
 * 
 * // Simple case (falls back to cache or 1:1)
 * const amount = toSmallestUnits('1.5', KALVORA_NATIVE_TOKEN);
 * ```
 */
export function toSmallestUnits(
  amount: AmountInput,
  contractId: string,
  options: {
    denomination?: string;
    tokenInfoMap?: Map<string, TokenInfo>;
  } = {}
): string {
  if (amount === undefined || amount === null || amount === '') {
    return '';
  }

  const { denomination, tokenInfoMap } = options;
  const decimalAmount = toDecimal(amount);
  
  let decimals: number;

  // Approach 1: Use provided denomination (most efficient for transaction flows)
  if (denomination) {
    decimals = getDecimalPlacesFromDenomination(denomination);
  }
  // Approach 2: Use token info map if available
  else if (tokenInfoMap && tokenInfoMap.has(contractId)) {
    const tokenInfo = tokenInfoMap.get(contractId);
    if (tokenInfo && tokenInfo.denomination) {
      decimals = getDecimalPlacesFromDenomination(tokenInfo.denomination);
    } else {
      throw new Error(`Token info found but missing denomination for ${contractId}`);
    }
  }
  // Approach 3: Fall back to hardcoded cache
  else {
    try {
      decimals = getTokenDecimals(contractId);
    } catch {
      throw new Error(`Token decimals not found for ${contractId}. Are you sure you are using a valid contract ID?`);
    }
  }

  const multiplier = new Decimal(10).pow(decimals);
  const result = decimalAmount.mul(multiplier);

  return result.floor().toString();
}

/**
 * Convert smallest units to user-friendly amount using the same unified approach
 * 
 * @param amount - Amount in smallest units
 * @param contractId - Contract ID for the token
 * @param options - Optional configuration
 * @param options.denomination - Pre-fetched denomination: smallest units per whole token, e.g. `'1000000000'`
 * @param options.tokenInfoMap - Pre-fetched token info map (efficient when available)
 * @returns string - User-friendly amount
 * 
 * @example
 * ```typescript
 * import { fromSmallestUnits } from 'kalvora.js';
 * 
 * const userAmount = fromSmallestUnits('1500000000', 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
 * ```
 */
export function fromSmallestUnits(
  amount: AmountInput,
  contractId: string,
  options: {
    denomination?: string;
    tokenInfoMap?: Map<string, TokenInfo>;
  } = {}
): string {
  if (amount === undefined || amount === null || amount === '') {
    return '0';
  }

  const { denomination, tokenInfoMap } = options;
  const decimalAmount = toDecimal(amount);
  
  let decimals: number;

  // Same unified approach as toSmallestUnits
  if (denomination) {
    decimals = getDecimalPlacesFromDenomination(denomination);
  }
  else if (tokenInfoMap && tokenInfoMap.has(contractId)) {
    const tokenInfo = tokenInfoMap.get(contractId);
    if (tokenInfo && tokenInfo.denomination) {
      decimals = getDecimalPlacesFromDenomination(tokenInfo.denomination);
    } else {
      throw new Error(`Token info found but missing denomination for ${contractId}`);
    }
  }
  else {
    try {
      decimals = getTokenDecimals(contractId);
    } catch {
      decimals = 0;
    }
  }

  const divisor = new Decimal(10).pow(decimals);
  return decimalAmount.div(divisor).toString();
}
