/**
 * Exchange Rate Service
 * Provides exchange rate functionality without circular dependencies
 */

import { Decimal } from 'decimal.js';

import { logger } from '../monitoring/index.js';

/**
 * Exchange rate cache entry
 */
interface ExchangeRateCacheEntry {
  rate: Decimal;
  timestamp: number;
}

/**
 * Exchange Rate Service
 * Handles exchange rate fetching and caching
 */
export class ExchangeRateService {
  private static cache: Map<string, ExchangeRateCacheEntry> = new Map();
  private static cacheTimeout = 300000; // 5 minutes

  /**
   * Get exchange rate for a contract ID
   */
  static async getExchangeRate(contractId: string): Promise<Decimal> {
    const cached = this.cache.get(contractId);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < this.cacheTimeout) {
      return cached.rate;
    }

    try {
      // Mock exchange rate - in real implementation, this would fetch from API
      const rate = new Decimal('1.0'); // Default to 1:1 for now
      
      this.cache.set(contractId, {
        rate,
        timestamp: now
      });

      return rate;
    } catch (error) {
      logger.warn('Failed to fetch exchange rate', {
        contractId,
        error: (error as Error).message,
        operation: 'fetchExchangeRate'
      });
      return new Decimal('1.0'); // Fallback to 1:1
    }
  }

  /**
   * Clear the exchange rate cache
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cached exchange rates for multiple contract IDs
   */
  static getCachedExchangeRates(contractIds: string[]): Map<string, Decimal> {
    const rates = new Map<string, Decimal>();
    const now = Date.now();

    for (const contractId of contractIds) {
      const cached = this.cache.get(contractId);
      if (cached && (now - cached.timestamp) < this.cacheTimeout) {
        rates.set(contractId, cached.rate);
      }
    }

    return rates;
  }
}
