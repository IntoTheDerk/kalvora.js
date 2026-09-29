/**
 * Contract Fee Service
 * Handles contract fee lookup with API-first approach and hardcoded fallback
 * API calls are currently placeholders - will be implemented later
 */

import { KALVORA_NATIVE_TOKEN } from '../network/constants.js';
import { CONTRACT_FEE_TYPE } from '../protobuf/index.js';

import { 
  getContractFeeConfig, 
  DEFAULT_CONTRACT_FEE_CONFIG
} from './contract-fee-constants.js';
import type { 
  ContractFeeConfig,
  ContractFeeServiceOptions
} from './types.js';


/**
 * Cache entry
 */
interface CacheEntry {
  data: ContractFeeConfig;
  timestamp: number;
}

/**
 * Contract Fee Service
 * Provides contract fee information with API-first lookup and fallback to hardcoded values
 */
export class ContractFeeService {
  private cacheTimeout: number;
  private cache: Map<string, CacheEntry>;
  private lastCacheCleanup: number;

  constructor(options: ContractFeeServiceOptions = {}) {
    // The direct API integration is intentionally not enabled until Kalvora
    // exposes a stable contract-fee endpoint. Callers may still provide the
    // option for forward compatibility with the service interface.
    void options.apiEndpoint;
    this.cacheTimeout = options.cacheTimeout || 300000; // 5 minutes
    this.cache = new Map();
    this.lastCacheCleanup = Date.now();
  }

  /**
   * Get contract fee information for a given contract ID
   */
  async getContractFeeInfo(contractId: string): Promise<ContractFeeConfig> {
    if (!contractId) {
      return DEFAULT_CONTRACT_FEE_CONFIG;
    }

    // Clean cache periodically
    this.cleanupCache();

    // Check cache first
    const cacheKey = `contract_fee_${contractId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // Try API first
      const apiData = await this.fetchContractFeeFromAPI(contractId);
      if (apiData) {
        // Cache the API result
        this.cache.set(cacheKey, {
          data: apiData,
          timestamp: Date.now()
        });
        return apiData;
      }
    } catch {
      // Fallback to hardcoded configuration on API failure
    }

    // Fallback to hardcoded configuration
    const fallbackData = getContractFeeConfig(contractId);
    
    // Cache the fallback result (with shorter timeout)
    this.cache.set(cacheKey, {
      data: fallbackData,
      timestamp: Date.now()
    });

    return fallbackData;
  }

  /**
   * Get contract fee amount for a given contract ID
   * This is a simplified version that returns just the fee amount
   */
  async getContractFee(contractId: string): Promise<string> {
    const feeInfo = await this.getContractFeeInfo(contractId);
    return feeInfo.feeAmount || '0';
  }

  /**
   * Fetch contract fee information from API
   */
  async fetchContractFeeFromAPI(_contractId: string): Promise<ContractFeeConfig | null> {
    try {
      // NOTE: This method is intentionally unimplemented as contract fee data
      // is currently retrieved via the validator API in the fee calculation flow.
      // This placeholder exists for future direct contract fee API integration.
      
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Always return null to use fallback for now
      return null;
    } catch (error) {
      throw new Error(`API fetch failed: ${(error as Error).message}`);
    }
  }

  /**
   * Normalize API response data to standard format
   */
  normalizeAPIData(apiData: Record<string, unknown>): ContractFeeConfig {
    const result: ContractFeeConfig = {
      feeType: this.normalizeFeeType(apiData.feeType || apiData.fee_type),
      feeAmount: String(apiData.feeAmount || apiData.fee_amount || '0'),
      allowedFeeIds: Array.isArray(apiData.allowedFeeIds) ? apiData.allowedFeeIds as string[] : 
        Array.isArray(apiData.allowed_fee_ids) ? apiData.allowed_fee_ids as string[] : 
          [KALVORA_NATIVE_TOKEN]
    };

    // Only add optional properties if they have valid values
    if (typeof apiData.feePercentage === 'number') {
      result.feePercentage = apiData.feePercentage;
    }
    if (typeof apiData.minimumFee === 'string') {
      result.minimumFee = apiData.minimumFee;
    }
    if (typeof apiData.maximumFee === 'string') {
      result.maximumFee = apiData.maximumFee;
    }

    return result;
  }

  /**
   * Normalize fee type from API response
   */
  normalizeFeeType(feeType: unknown): number {
    if (typeof feeType === 'number') {
      return feeType;
    }

    const typeMap: Record<string, number> = {
      'FIXED': CONTRACT_FEE_TYPE.FIXED,
      'PERCENTAGE': CONTRACT_FEE_TYPE.PERCENTAGE,
      'CUR_EQUIVALENT': CONTRACT_FEE_TYPE.CUR_EQUIVALENT,
      'NONE': CONTRACT_FEE_TYPE.NONE,
      'fixed': CONTRACT_FEE_TYPE.FIXED,
      'percentage': CONTRACT_FEE_TYPE.PERCENTAGE,
      'cur_equivalent': CONTRACT_FEE_TYPE.CUR_EQUIVALENT,
      'none': CONTRACT_FEE_TYPE.NONE
    };

    return typeMap[String(feeType).toUpperCase()] || CONTRACT_FEE_TYPE.FIXED;
  }

  /**
   * Check if a fee contract ID is allowed for a given contract
   */
  async isFeeContractIdAllowed(contractId: string, feeContractId: string): Promise<boolean> {
    const feeInfo = await this.getContractFeeInfo(contractId);
    return (feeInfo.allowedFeeIds).includes(feeContractId);
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache(): void {
    const now = Date.now();
    if (now - this.lastCacheCleanup < 60000) { // Clean up every minute
      return;
    }

    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.cache.delete(key);
      }
    }

    this.lastCacheCleanup = now;
  }

  /**
   * Clear all cache entries
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; timeout: number; lastCleanup: number } {
    return {
      size: this.cache.size,
      timeout: this.cacheTimeout,
      lastCleanup: this.lastCacheCleanup
    };
  }
}

// Create a default instance
export const contractFeeService = new ContractFeeService();

export default contractFeeService;
