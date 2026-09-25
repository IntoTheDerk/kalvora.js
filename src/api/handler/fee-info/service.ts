/**
 * Rate Handler Service
 * 
 * Centralized rate handling with safeguards and core logic.
 * This service receives rate data from validator sources
 * and applies business logic, safeguards, and caching.
 */

import { logger } from '../../../shared/monitoring/index.js';
import { KALVORA_NATIVE_TOKEN } from '../../../shared/network/constants.js';
import { Decimal } from '../../../shared/utils/amount-utils.js';
import type { AmountInput } from '../../../types/index.js';
import { getTokenFeeInfo } from '../token-info/service.js';

/**
 * Rate source information
 */
export interface RateSource {
  source: 'validator' | 'fallback';
  timestamp: number;
  contractId: string;
}

/**
 * Rate handler options
 */
export interface RateHandlerOptions {
  cacheTimeout?: number;
  fallbackRates?: Record<string, string>;
  minimumRates?: Record<string, string>;
  enableSafeguards?: boolean;
}

/**
 * Fallback rate information
 */
export interface FallbackRateInfo {
  rate: string;
  source: 'exact_match' | 'symbol_match';
  sourceKey: string;
}

/**
 * Cache entry
 */
interface CacheEntry {
  rate: Decimal;
  timestamp: number;
  source: RateSource;
}

/**
 * Cache information
 */
export interface CacheInfo {
  size: number;
  timeout: number;
  entries: Array<{
    contractId: string;
    rate: string;
    age: number;
    expired: boolean;
    source: RateSource;
  }>;
}

/**
 * Rate Handler Service
 * Centralized rate handling with safeguards and core logic
 */
export class RateHandler {
  private cache: Map<string, CacheEntry>;
  private cacheTimeout: number;
  private fallbackRates: Record<string, string>;
  private minimumRates: Record<string, string>;
  private enableSafeguards: boolean;

  constructor(options: RateHandlerOptions = {}) {
    this.cache = new Map();
    this.cacheTimeout = options.cacheTimeout || 3000; // 3 seconds default
    this.fallbackRates = options.fallbackRates || {
      [KALVORA_NATIVE_TOKEN]: '1.00'
    };
    this.minimumRates = options.minimumRates || {
      [KALVORA_NATIVE_TOKEN]: '1.00'  // Minimum $1.00 per KAL for fee evaluation (network safeguard)
    };
    this.enableSafeguards = options.enableSafeguards !== false; // Default to true
  }

  /**
   * Process rate from external source (validator)
   */
  async processRate(
    contractId: string, 
    rate: string | number, 
    source: 'validator',
    useCache: boolean = true
  ): Promise<Decimal> {
    const rateDecimal = new Decimal(rate);
    const rateSource: RateSource = {
      source,
      timestamp: Date.now(),
      contractId
    };

    // Check cache first
    if (useCache && this.cache.has(contractId)) {
      const cached = this.cache.get(contractId);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return this.applySafeguards(cached.rate, contractId);
      }
    }

    // Cache the new rate
    this.cache.set(contractId, {
      rate: rateDecimal,
      timestamp: Date.now(),
      source: rateSource
    });

    return this.applySafeguards(rateDecimal, contractId);
  }

  /**
   * Get exchange rate with environment-based fallback chain
   * Process: 1) Check cache 2) Try validator 3) Use fallback
   */
  async getExchangeRate(contractId: string, useCache: boolean = true): Promise<Decimal> {
    // Step 1: Check cache first
    if (useCache && this.cache.has(contractId)) {
      const cached = this.cache.get(contractId);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return this.applySafeguards(cached.rate, contractId);
      }
    }

    // Step 2: Try validator
    try {
      const feeInfoResponse = await getTokenFeeInfo({
        contractIds: [contractId],
        includeRates: true,
        includeContractFees: true
      });
      
      if (feeInfoResponse.tokens && feeInfoResponse.tokens.length > 0) {
        const token = feeInfoResponse.tokens[0];
        if (token && token.rate) {
          // Convert from 1e18 scale to decimal
          const rate = new Decimal(token.rate).div(new Decimal(10).pow(18));
          return this.applySafeguards(rate, contractId);
        }
      }
    } catch (error) {
      logger.warn('Validator failed for contract', {
        contractId,
        error: (error as Error).message,
        operation: 'getFeeInfo'
      });
    }

    // Step 3: Use fallback
    const fallbackInfo = this.getFallbackRateInfo(contractId);
    if (!fallbackInfo) {
      throw new Error(`No exchange rate available for "${contractId}" from any source and no fallback rate configured. Please add a fallback rate for this contract ID.`);
    }

    const fallbackRateDecimal = this.applySafeguards(new Decimal(fallbackInfo.rate), contractId);
    
    // Enhanced error message with detailed fallback information
    let sourceDescription: string;
    switch (fallbackInfo.source) {
    case 'exact_match':
      sourceDescription = `exact match for ${fallbackInfo.sourceKey}`;
      break;
    case 'symbol_match':
      sourceDescription = `symbol match using ${fallbackInfo.sourceKey}`;
      break;
    default:
      sourceDescription = 'unknown source';
    }
    
    const errorMessage = `All rate sources failed for "${contractId}". Using fallback rate: ${fallbackRateDecimal.toString()} USD per ${contractId} (source: ${sourceDescription})`;
    logger.warn('Fee info retrieval failed', {
      contractId,
      error: errorMessage,
      operation: 'getFeeInfo'
    });
    
    return fallbackRateDecimal;
  }

  /**
   * Apply rate safeguards (minimum rates, validation, etc.)
   */
  private applySafeguards(rate: Decimal, contractId: string): Decimal {
    if (!this.enableSafeguards) {
      return rate;
    }

    // Apply minimum rate safeguard for fee evaluation
    const minimumRate = this.minimumRates[contractId];
    if (minimumRate && rate.lt(new Decimal(minimumRate))) {
      logger.warn('Rate below minimum, applying safeguard', {
        contractId,
        rate: rate.toString(),
        minimumRate,
        operation: 'applySafeguards'
      });
      return new Decimal(minimumRate);
    }

    // Additional safeguards can be added here
    // - Maximum rate limits
    // - Rate change velocity limits
    // - Sanity checks

    return rate;
  }

  /**
   * Get fallback rate for a contract ID with detailed information
   */
  getFallbackRateInfo(contractId: string): FallbackRateInfo | null {
    // First try to get exact contract ID match
    if (this.fallbackRates[contractId]) {
      return {
        rate: this.fallbackRates[contractId],
        source: 'exact_match',
        sourceKey: contractId
      };
    }
    
    // Extract currency symbol from contract ID as fallback
    const match = contractId.match(/^\$([A-Za-z]+)\+\d{4}$/);
    if (match) {
      const symbol = match[1];
      const symbolKey = `$${symbol}+0000`; // Try with +0000 suffix
      if (this.fallbackRates[symbolKey]) {
        return {
          rate: this.fallbackRates[symbolKey],
          source: 'symbol_match',
          sourceKey: symbolKey
        };
      }
    }
    
    // No fallback available - return null to indicate no fallback
    return null;
  }

  /**
   * Convert USD amount to currency amount
   */
  async convertUSDToCurrency(usdAmount: AmountInput, contractId: string): Promise<Decimal> {
    const usdDecimal = new Decimal(usdAmount);
    const exchangeRate = await this.getExchangeRate(contractId);
    
    // Convert USD to currency: currencyAmount = usdAmount / exchangeRate
    return usdDecimal.div(exchangeRate);
  }

  /**
   * Convert currency amount to USD
   */
  async convertCurrencyToUSD(currencyAmount: AmountInput, contractId: string): Promise<Decimal> {
    const currencyDecimal = new Decimal(currencyAmount);
    const exchangeRate = await this.getExchangeRate(contractId);
    
    // Convert currency to USD: usdAmount = currencyAmount * exchangeRate
    return currencyDecimal.mul(exchangeRate);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cached rates info
   */
  getCacheInfo(): CacheInfo {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([contractId, data]) => ({
      contractId,
      rate: data.rate.toString(),
      age: now - data.timestamp,
      expired: now - data.timestamp >= this.cacheTimeout,
      source: data.source
    }));
    
    return {
      size: this.cache.size,
      timeout: this.cacheTimeout,
      entries
    };
  }

  /**
   * Update fallback rates
   */
  updateFallbackRates(rates: Record<string, string>): void {
    this.fallbackRates = { ...this.fallbackRates, ...rates };
  }

  /**
   * Update minimum rates
   */
  updateMinimumRates(rates: Record<string, string>): void {
    this.minimumRates = { ...this.minimumRates, ...rates };
  }

  /**
   * Enable or disable safeguards
   */
  setSafeguardsEnabled(enabled: boolean): void {
    this.enableSafeguards = enabled;
  }
}

/**
 * Default rate handler instance
 */
export const rateHandler = new RateHandler();

/**
 * Convenience function to process rate from external source
 */
export async function processRate(
  contractId: string, 
  rate: string | number, 
  source: 'validator'
): Promise<Decimal> {
  return rateHandler.processRate(contractId, rate, source);
}

/**
 * Convenience function to get exchange rate
 */
export async function getExchangeRate(contractId: string): Promise<Decimal> {
  return rateHandler.getExchangeRate(contractId);
}

/**
 * Convenience function to convert USD to currency
 */
export async function convertUSDToCurrency(usdAmount: AmountInput, contractId: string): Promise<Decimal> {
  return rateHandler.convertUSDToCurrency(usdAmount, contractId);
}

/**
 * Convenience function to convert currency to USD
 */
export async function convertCurrencyToUSD(currencyAmount: AmountInput, contractId: string): Promise<Decimal> {
  return rateHandler.convertCurrencyToUSD(currencyAmount, contractId);
}
