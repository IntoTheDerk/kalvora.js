/**
 * Token Configuration
 * Defines decimal places for different tokens
 * 
 * This file contains the authoritative list of supported tokens
 * and their decimal places. If a token is not in this list,
 * an error will be thrown instead of using a default.
 */

import { KALVORA_NATIVE_TOKEN } from '../network/constants.js';


/**
 * Token decimal places configuration
 * Key: Contract ID (e.g., 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao')
 * Value: Number of decimal places
 */
export const TOKEN_DECIMALS: Record<string, number> = {
  // Kalvora native token
  [KALVORA_NATIVE_TOKEN]: 9
} as const;

/**
 * Get the number of decimal places for a given token
 */
export function getTokenDecimals(contractId: string): number {
  if (!contractId || typeof contractId !== 'string') {
    throw new Error('Contract ID must be a non-empty string');
  }
  
  const decimals = TOKEN_DECIMALS[contractId];
  if (decimals === undefined) {
    throw new Error(`Unsupported token: ${contractId}. Supported tokens: ${Object.keys(TOKEN_DECIMALS).join(', ')}`);
  }
  
  return decimals;
}

/**
 * Add a new token configuration
 */
export function addTokenConfig(contractId: string, decimals: number): void {
  if (!contractId || typeof contractId !== 'string') {
    throw new Error('Contract ID must be a non-empty string');
  }
  
  if (typeof decimals !== 'number' || decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error('Decimals must be a non-negative integer');
  }
  
  (TOKEN_DECIMALS)[contractId] = decimals;
}

/**
 * Check if a token is supported
 */
export function isTokenSupported(contractId: string): boolean {
  return contractId in TOKEN_DECIMALS;
}

/**
 * Get all supported token contract IDs
 */
export function getSupportedTokens(): string[] {
  return Object.keys(TOKEN_DECIMALS);
}



