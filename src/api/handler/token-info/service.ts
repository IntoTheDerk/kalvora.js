/**
 * Token Info Handler Service
 * 
 * Centralized token information handling.
 * Routes directly to validator as indexer integration has been removed.
 * Contains all business logic for token information operations.
 */

import type { TokenFeeInfoResponse } from '../../../../proto/generated/api_pb.js';
import type { GRPCConfig } from '../../../types/index.js';
import { getTokenFeeInfo as getValidatorTokenFeeInfo } from '../../validator/fee-info/index.js';

/**
 * Token info handler options
 */
export interface TokenInfoHandlerOptions {
  /** Enable caching for token information */
  enableCache?: boolean;
  /** Cache timeout in milliseconds */
  cacheTimeout?: number;
}

/**
 * Token information interface
 */
export interface TokenInfo {
  contractId: string;
  denomination: string;
  rate: string;
  authorized: boolean;
  allowedFees?: string;
  usedFees?: string;
  contractFees?: {
    contractFeeType: number;
    feeAmount?: string;
    allowedFeeInstrument?: string[];
  } | undefined;
}

/**
 * Token Info Handler Service
 * Centralized token information handling
 */
export class TokenInfoHandler {
  private cache: Map<string, { data: TokenFeeInfoResponse; timestamp: number }>;
  private cacheTimeout: number;
  private enableCache: boolean;

  constructor(options: TokenInfoHandlerOptions = {}) {
    this.cache = new Map();
    this.cacheTimeout = options.cacheTimeout || 2000; // 2 seconds default
    this.enableCache = options.enableCache !== false; // Default to true
  }

  /**
   * Get comprehensive token fee information
   */
  async getTokenFeeInfo(
    params: { contractIds: string[]; includeRates?: boolean; includeContractFees?: boolean },
    options: GRPCConfig = {}
  ): Promise<TokenFeeInfoResponse> {
    // Input validation
    if (!params.contractIds || params.contractIds.length === 0) {
      throw new Error('Contract IDs array is required and cannot be empty');
    }

    // Create cache key
    const cacheKey = this.createCacheKey(params);
    
    // Check cache first
    if (this.enableCache && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
    }

    try {
      const response = await getValidatorTokenFeeInfo(params, options);
      
      // Cache the result
      if (this.enableCache) {
        this.cache.set(cacheKey, {
          data: response,
          timestamp: Date.now()
        });
      }
      
      return response;
    } catch (error) {
      throw new Error(`Failed to get token fee info: ${(error as Error).message}`);
    }
  }

  /**
   * Get token information for a single contract ID
   */
  async getTokenInfoForSingle(contractId: string, options: GRPCConfig = {}): Promise<TokenInfo> {
    // Input validation
    if (!contractId) {
      throw new Error('Contract ID is required');
    }

    try {
      const response = await this.getTokenFeeInfo({
        contractIds: [contractId],
        includeRates: true,
        includeContractFees: true
      }, options);
      
      const tokenInfo = response.tokens.find((t: { contractId: string }) => t.contractId === contractId);
      
      if (!tokenInfo) {
        throw new Error(`Token information not found for contract ID: ${contractId}`);
      }
      
      return {
        contractId: tokenInfo.contractId,
        denomination: tokenInfo.denomination,
        rate: tokenInfo.rate,
        authorized: tokenInfo.authorized,
        allowedFees: tokenInfo.allowedFees || '0',
        usedFees: tokenInfo.usedFees || '0',
        contractFees: tokenInfo.contractFees || undefined
      };
    } catch (error) {
      throw new Error(`Failed to get token info for ${contractId}: ${(error as Error).message}`);
    }
  }

  /**
   * Check if a token is supported/authorized
   */
  async isTokenSupported(contractId: string, options: GRPCConfig = {}): Promise<boolean> {
    try {
      const tokenInfo = await this.getTokenInfoForSingle(contractId, options);
      return tokenInfo.authorized;
    } catch {
      return false;
    }
  }

  /**
   * Get token denomination
   */
  async getTokenDenomination(contractId: string, options: GRPCConfig = {}): Promise<string> {
    try {
      const tokenInfo = await this.getTokenInfoForSingle(contractId, options);
      return tokenInfo.denomination;
    } catch (error) {
      throw new Error(`Failed to get denomination for ${contractId}: ${(error as Error).message}`);
    }
  }

  /**
   * Get token exchange rate
   */
  async getTokenRate(contractId: string, options: GRPCConfig = {}): Promise<string> {
    try {
      const tokenInfo = await this.getTokenInfoForSingle(contractId, options);
      return tokenInfo.rate;
    } catch (error) {
      throw new Error(`Failed to get exchange rate for ${contractId}: ${(error as Error).message}`);
    }
  }

  /**
   * Get token information map for multiple contract IDs
   */
  async getTokenInfoMap(
    contractId: string,
    additionalContractIds: string[] = [],
    options: GRPCConfig = {}
  ): Promise<Map<string, TokenInfo>> {
    const contractIdsToFetch = new Set<string>();
    contractIdsToFetch.add(contractId); // Main contract is always needed
    
    // Add any additional contract IDs
    additionalContractIds.forEach(id => {
      if (id) {
        contractIdsToFetch.add(id);
      }
    });
    
    // Fetch all required token info in a single call
    const tokensResponse = await this.getTokenFeeInfo({
      contractIds: [...contractIdsToFetch],
      includeRates: true,
      includeContractFees: true
    }, options);
    
    const tokenInfoMap = new Map<string, TokenInfo>();
    tokensResponse.tokens.forEach((token: { contractId: string; denomination: string; rate: string; authorized: boolean; allowedFees?: string; usedFees?: string; contractFees?: { contractFeeType: number; feeAmount?: string; allowedFeeInstrument?: string[] } }) => {
      tokenInfoMap.set(token.contractId, {
        contractId: token.contractId,
        denomination: token.denomination,
        rate: token.rate,
        authorized: token.authorized,
        allowedFees: token.allowedFees || '0',
        usedFees: token.usedFees || '0',
        contractFees: token.contractFees || undefined
      });
    });
    
    return tokenInfoMap;
  }

  /**
   * Create cache key for parameters
   */
  private createCacheKey(params: { contractIds: string[]; includeRates?: boolean; includeContractFees?: boolean }): string {
    const sortedIds = [...params.contractIds].sort();
    return `${sortedIds.join(',')}-${params.includeRates || false}-${params.includeContractFees || false}`;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: Array<{ key: string; age: number }> } {
    const now = Date.now();
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([key, data]) => ({
        key,
        age: now - data.timestamp
      }))
    };
  }
}

/**
 * Default token info handler instance
 */
export const tokenInfoHandler = new TokenInfoHandler();

/**
 * Convenience function to get token fee info
 */
export async function getTokenFeeInfo(
  params: { contractIds: string[]; includeRates?: boolean; includeContractFees?: boolean },
  options: GRPCConfig = {}
): Promise<TokenFeeInfoResponse> {
  return tokenInfoHandler.getTokenFeeInfo(params, options);
}

/**
 * Convenience function to get token info for single contract
 */
export async function getTokenInfoForSingle(contractId: string, options: GRPCConfig = {}): Promise<TokenInfo> {
  return tokenInfoHandler.getTokenInfoForSingle(contractId, options);
}

/**
 * Convenience function to check if token is supported
 */
export async function isTokenSupported(contractId: string, options: GRPCConfig = {}): Promise<boolean> {
  return tokenInfoHandler.isTokenSupported(contractId, options);
}

/**
 * Convenience function to get token denomination
 */
export async function getTokenDenomination(contractId: string, options: GRPCConfig = {}): Promise<string> {
  return tokenInfoHandler.getTokenDenomination(contractId, options);
}

/**
 * Convenience function to get token rate
 */
export async function getTokenRate(contractId: string, options: GRPCConfig = {}): Promise<string> {
  return tokenInfoHandler.getTokenRate(contractId, options);
}

/**
 * Convenience function to get token info map
 */
export async function getTokenInfoMap(
  contractId: string,
  additionalContractIds: string[] = [],
  options: GRPCConfig = {}
): Promise<Map<string, TokenInfo>> {
  return tokenInfoHandler.getTokenInfoMap(contractId, additionalContractIds, options);
}