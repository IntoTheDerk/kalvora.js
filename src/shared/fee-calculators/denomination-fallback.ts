/**
 * Denomination Fallback Constants
 * Fallback denomination values for tokens when not available from validator
 * These are used for precision calculations in fee computations
 */

import { KALVORA_NATIVE_TOKEN } from '../network/constants.js';

/**
 * Fallback denomination values for different contract IDs
 * Key: Contract ID (e.g., 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao')
 * Value: Denomination string (e.g., '1000000000' for 1e9)
 */
export const DENOMINATION_FALLBACKS: Record<string, string> = {
  [KALVORA_NATIVE_TOKEN]: '1000000000'
} as const;

/**
 * Get fallback denomination for a contract ID
 * @param contractId - The contract ID to get denomination for
 * @returns The denomination string or throws error if not found
 */
export function getDenominationFallback(contractId: string): string {
  if (!contractId || typeof contractId !== 'string') {
    throw new Error('Contract ID must be a non-empty string');
  }
  
  const denomination = DENOMINATION_FALLBACKS[contractId];
  if (!denomination) {
    throw new Error(`No denomination fallback configured for contract ID: ${contractId}. Please add a denomination fallback for this contract.`);
  }
  
  return denomination;
}

/**
 * Check if a contract ID has a denomination fallback
 * @param contractId - The contract ID to check
 * @returns True if fallback exists, false otherwise
 */
export function hasDenominationFallback(contractId: string): boolean {
  return contractId in DENOMINATION_FALLBACKS;
}

/**
 * Add a new denomination fallback
 * @param contractId - The contract ID
 * @param denomination - The denomination string
 */
export function addDenominationFallback(contractId: string, denomination: string): void {
  if (!contractId || typeof contractId !== 'string') {
    throw new Error('Contract ID must be a non-empty string');
  }
  
  if (!denomination || typeof denomination !== 'string') {
    throw new Error('Denomination must be a non-empty string');
  }
  
  // Validate denomination is a valid number string
  if (!/^\d+$/.test(denomination)) {
    throw new Error('Denomination must be a valid number string');
  }
  
  (DENOMINATION_FALLBACKS)[contractId] = denomination;
}

/**
 * Get all supported contract IDs with denomination fallbacks
 * @returns Array of contract IDs
 */
export function getSupportedstrings(): string[] {
  return Object.keys(DENOMINATION_FALLBACKS);
}

/**
 * Get decimal places from denomination string
 * @param denomination - The denomination string (e.g., '1000000000')
 * @returns Number of decimal places (e.g., 9)
 */
export function getDecimalPlacesFromDenomination(denomination: string): number {
  if (!denomination || typeof denomination !== 'string') {
    throw new Error('Denomination must be a non-empty string');
  }
  
  // Validate denomination is a valid number string
  if (!/^\d+$/.test(denomination)) {
    throw new Error('Denomination must be a valid number string');
  }
  
  // Calculate decimal places: log10(denomination)
  const denominationNum = parseInt(denomination, 10);
  if (denominationNum <= 0) {
    throw new Error('Denomination must be greater than 0');
  }
  
  return Math.floor(Math.log10(denominationNum));
}
