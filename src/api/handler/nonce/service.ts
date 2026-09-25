/**
 * Nonce Handler Service
 * 
 * Centralized nonce handling.
 * Routes directly to validator as indexer integration has been removed.
 * Contains all business logic for nonce operations.
 */

import Decimal from 'decimal.js';

import type { NonceResponse as _NonceResponse } from '../../../../proto/generated/api_pb.js';
import type { GRPCConfig } from '../../../types/index.js';
import { getNonce as getValidatorNonce, getNonces as getValidatorNonces } from '../../validator/nonce/service.js';


/**
 * Nonce Handler Service
 * Centralized nonce handling
 */
export class NonceHandler {
  constructor() {
    // Some sort of sequential caching could be done here, but most use cases will not benefit from it. Only would typically benefit for > 1 txn per block.
  }

  /**
   * Get a single nonce for an address
   */
  async getNonce(address: string, options: GRPCConfig = {}): Promise<Decimal> {
    // Input validation
    if (!address || typeof address !== 'string' || address.trim() === '') {
      throw new Error('Address must be a non-empty string');
    }

    try {
      return await getValidatorNonce(address, options);
    } catch (error) {
      throw new Error(`Failed to get nonce: ${(error as Error).message}`);
    }
  }

  /**
   * Get nonces for multiple addresses
   */
  async getNonces(addresses: string[], options: GRPCConfig = {}): Promise<Decimal[]> {
    // Input validation
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new Error('Addresses must be a non-empty array');
    }

    try {
      return await getValidatorNonces(addresses, options);
    } catch (error) {
      throw new Error(`Failed to get nonces: ${(error as Error).message}`);
    }
  }
}

/**
 * Default nonce handler instance
 */
export const nonceHandler = new NonceHandler();

/**
 * Convenience function to get a single nonce
 */
export async function getNonce(address: string, options: GRPCConfig = {}): Promise<Decimal> {
  return nonceHandler.getNonce(address, options);
}

/**
 * Convenience function to get multiple nonces
 */
export async function getNonces(addresses: string[], options: GRPCConfig = {}): Promise<Decimal[]> {
  return nonceHandler.getNonces(addresses, options);
}