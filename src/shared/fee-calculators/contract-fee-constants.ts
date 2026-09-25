/**
 * Contract Fee Constants
 * Production fallback values for contract fees when API is unavailable
 * 
 * This file contains only production-ready contract fee configurations.
 */

import { KALVORA_NATIVE_TOKEN } from '../network/constants.js';
import { CONTRACT_FEE_TYPE } from '../protobuf/index.js';

import type { ContractFeeConfig } from './types.js';

/**
 * Production contract fee configuration fallback data
 * This serves as a fallback when the API is unavailable
 * 
 * Note: This should only contain real, production contract configurations.
 * Only used for production fallbacks when the data is unavailable.
 */
export const CONTRACT_FEE_CONFIG: Record<string, ContractFeeConfig> = {
  // Production contract configurations will be added here as needed
  // Currently empty - all contract fees should be fetched from API
};

/**
 * Default contract fee configuration for unknown contracts
 */
export const DEFAULT_CONTRACT_FEE_CONFIG: ContractFeeConfig = {
  feeType: CONTRACT_FEE_TYPE.NONE,
  feeAmount: '0',
  allowedFeeIds: [KALVORA_NATIVE_TOKEN]
};

/**
 * Get contract fee configuration by contract ID
 * @param contractId - Contract ID (e.g., 'BTC1234')
 * @returns Contract fee configuration
 */
export function getContractFeeConfig(contractId: string): ContractFeeConfig {
  if (!contractId) {
    return DEFAULT_CONTRACT_FEE_CONFIG;
  }
  
  return CONTRACT_FEE_CONFIG[contractId] || DEFAULT_CONTRACT_FEE_CONFIG;
}

/**
 * Check if a fee contract ID is allowed for a given contract
 * @param contractId - The contract ID
 * @param feeContractId - The fee contract ID to check
 * @returns True if the fee contract ID is allowed
 */
export function isFeeContractIdAllowed(contractId: string, feeContractId: string): boolean {
  const config = getContractFeeConfig(contractId);
  return config.allowedFeeIds.includes(feeContractId);
}

/**
 * Get all allowed fee contract IDs for a given contract
 * @param contractId - Contract ID
 * @returns Array of allowed fee contract IDs
 */
export function getAllowedFeeContractIds(contractId: string): string[] {
  const config = getContractFeeConfig(contractId);
  return [...config.allowedFeeIds]; // Return a copy
}

/**
 * Get all configured contract IDs
 * @returns Array of all configured contract IDs
 */
export function getAllConfiguredContractIds(): string[] {
  return Object.keys(CONTRACT_FEE_CONFIG);
}

export default {
  CONTRACT_FEE_CONFIG,
  DEFAULT_CONTRACT_FEE_CONFIG,
  getContractFeeConfig,
  isFeeContractIdAllowed,
  getAllowedFeeContractIds,
  getAllConfiguredContractIds
};
