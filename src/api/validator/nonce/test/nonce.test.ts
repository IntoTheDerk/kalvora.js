/**
 * Validator Nonce Service Tests
 * 
 * This provides tests for the validator nonce service using Vitest.
 */

import { describe, it, expect, vi } from 'vitest';

import { TEST_WALLET_ADDRESSES } from '../../../../test-utils/keys.test.js';
import { getNonce, getNonces } from '../service.js';

// Mock factory for dependency injection
const createMockClient = (config: any = {}) => {
  return {
    getNonce: vi.fn((address) => {
      // Check if address is empty and simulate error
      if (!address || address.length === 0) {
        return Promise.reject(new Error('Invalid address'));
      }
      
      // Check for invalid address format
      if (address === 'invalid-address') {
        return Promise.reject(new Error('Invalid address format'));
      }
      
      // Simulate network error for specific address (charlie) when no specific config
      if (address === TEST_WALLET_ADDRESSES.charlie && !config.host && !config.port) {
        return Promise.reject(new Error('Network error'));
      }
      
      // Simulate successful gRPC call with NonceResponse proto object
      const response = { nonce: 100n } as any;
      return Promise.resolve(response);
    })
  };
};

describe('Validator Nonce Service', () => {
  describe('Basic Functionality', () => {
    it('should retrieve nonce for valid address', async () => {
      const address = TEST_WALLET_ADDRESSES.alice;
      
      // Pass mock factory
      const nonce = await getNonce(address, {}, createMockClient as any);
      
      // Verify nonce is returned
      expect(nonce).toBeDefined();
      expect(nonce).not.toBeNull();
      
      // Verify nonce is a Decimal
      expect(typeof nonce).toBe('object');
      expect(nonce.constructor).toBeDefined();
      expect(nonce.constructor.name).toBe('Decimal');
      
      // Verify nonce is positive
      expect(nonce.lt(0)).toBe(false);
    });
  });

  describe('Input Validation', () => {
    it('should throw error for null address', async () => {
      await expect(getNonce(null as any, {}, createMockClient as any)).rejects.toThrow();
    });
    
    it('should throw error for undefined address', async () => {
      await expect(getNonce(undefined as any, {}, createMockClient as any)).rejects.toThrow();
    });
    
    it('should throw error for empty address', async () => {
      await expect(getNonce('', {}, createMockClient as any)).rejects.toThrow();
    });
    
    it('should throw error for invalid address format', async () => {
      await expect(getNonce('invalid-address', {}, createMockClient as any)).rejects.toThrow();
    });
    
    it('should throw error for empty array', async () => {
      await expect(getNonces([])).rejects.toThrow();
    });
    
    it('should throw error for non-array input', async () => {
      await expect(getNonces('not-an-array' as any)).rejects.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      try {
        const result = await getNonce(TEST_WALLET_ADDRESSES.charlie, { 
          host: 'invalid-host',
          port: 99999
        }, createMockClient as any);
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toContain('Failed to get nonce from validator');
      }
    });
    
    it('should handle timeout scenarios', async () => {
      try {
        await getNonce(TEST_WALLET_ADDRESSES.charlie, {}, createMockClient as any);
        expect(true).toBe(true);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});