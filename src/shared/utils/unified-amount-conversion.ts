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

type DenominationOptions = { denomination?: string; tokenInfoMap?: Map<string, TokenInfo> };

function partsPerToken(contractId: string, options: DenominationOptions, display: boolean): bigint {
  const token = options.tokenInfoMap?.get(contractId);
  const explicit = options.denomination ?? token?.denomination;
  if (explicit !== undefined) {
    if (!/^\d+$/u.test(explicit) || BigInt(explicit) === 0n || BigInt(explicit) >= 1n << 256n) {
      throw new Error(`Invalid denomination for ${contractId}`);
    }
    return BigInt(explicit);
  }
  try {
    return 10n ** BigInt(getTokenDecimals(contractId));
  } catch {
    if (display) return 1n;
    throw new Error(`Token decimals not found for ${contractId}. Are you sure you are using a valid contract ID?`);
  }
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
  options: DenominationOptions = {}
): string {
  if (amount === undefined || amount === null || amount === '') {
    return '';
  }

  const parts = partsPerToken(contractId, options, false);
  const value = toDecimal(amount);
  if (!value.isFinite()) throw new Error('Amount must be finite');
  // The inputs are base ten. This precision preserves the entire product before flooring fractional parts.
  const Exact = Decimal.clone({ precision: Math.max(1, value.precision() + parts.toString().length) });
  return new Exact(value).mul(parts.toString()).floor().toFixed(0);
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
  options: DenominationOptions = {}
): string {
  if (amount === undefined || amount === null || amount === '') {
    return '0';
  }

  const parts = partsPerToken(contractId, options, true);
  const value = toDecimal(amount);
  if (!value.isFinite()) throw new Error('Amount must be finite');
  const Display = Decimal.clone({ precision: Math.max(Decimal.precision, value.precision() + parts.toString().length) });
  return new Display(value).div(parts.toString()).toFixed();
}
