/**
 * Transaction Unit Tests
 * 
 * Unit tests for transaction creation and validation
 * without gRPC dependencies.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { 
  validateAmount,
  validateBase58Address
} from '../../shared/utils/validation.js';
import { 
  isValidContractId
} from '../../shared/utils/validation.js';
import { 
  ED25519_TEST_KEYS,
  TEST_WALLET_ADDRESSES
} from '../../test-utils/index.js';

describe('Transaction Unit Tests', () => {
  let contractId: string;

  beforeEach(async () => {
    contractId = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
  });

  describe('Contract ID Validation', () => {
    it('should validate valid contract IDs', () => {
      const validContractIds = [
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        'KAL000001',
        'KAL009999',
        'KAL001234'
      ];

      validContractIds.forEach(id => {
        const result = isValidContractId(id);
        expect(result).toBe(true);
      });
    });

    it('should reject invalid contract IDs', () => {
      const invalidContractIds = [
        'KALV 0000', // Whitespace is not canonical
        '$KALV+', // Missing number
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao ', // Whitespace is not canonical
        '$KALV+abc', // Non-numeric
        '$KALV+000', // Too few digits
        'KAL 111112', // Whitespace is not canonical
        '', // Empty
        null as any, // Null
        undefined as any // Undefined
      ];

      invalidContractIds.forEach(id => {
        const result = isValidContractId(id);
        expect(result).toBe(false);
      });
    });
  });

  describe('Amount Validation', () => {
    it('should validate valid amounts', () => {
      const validAmounts = [
        '1000000000', // 1 KAL in smallest units
        '5000000000', // 5 KAL
        '1000000000000', // 1000 KALV
        '1' // Minimum amount
      ];

      validAmounts.forEach(amount => {
        const result = validateAmount(amount);
        expect(result.isValid).toBe(true);
      });
    });

    it('should reject invalid amounts', () => {
      const invalidAmounts = [
        '0', // Zero amount
        '-1000000', // Negative amount
        'abc', // Non-numeric
        '', // Empty
        null as any, // Null
        undefined as any // Undefined
      ];

      invalidAmounts.forEach(amount => {
        const result = validateAmount(amount);
        expect(result.isValid).toBe(false);
      });
    });
  });

  describe('Address Validation', () => {
    it('should validate valid addresses', () => {
      const senderResult = validateBase58Address(TEST_WALLET_ADDRESSES.alice);
      const recipientResult = validateBase58Address(TEST_WALLET_ADDRESSES.bob);
      expect(senderResult.isValid).toBe(true);
      expect(recipientResult.isValid).toBe(true);
    });

    it('should reject invalid addresses', () => {
      const invalidAddresses = [
        'invalid-address',
        'too-short',
        '0', // Too short
        '', // Empty
        null as any, // Null
        undefined as any // Undefined
      ];

      invalidAddresses.forEach(address => {
        const result = validateBase58Address(address);
        expect(result.isValid).toBe(false);
      });
    });
  });

  describe('Wallet Integration', () => {
    it('should have different addresses', () => {
      expect(TEST_WALLET_ADDRESSES.alice).toBeDefined();
      expect(TEST_WALLET_ADDRESSES.bob).toBeDefined();
      expect(TEST_WALLET_ADDRESSES.alice).not.toBe(TEST_WALLET_ADDRESSES.bob);
    });

    it('should have valid addresses', () => {
      expect(TEST_WALLET_ADDRESSES.alice).toMatch(/^[A-Za-z0-9]+$/);
      expect(TEST_WALLET_ADDRESSES.bob).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('should have valid public keys', () => {
      expect(ED25519_TEST_KEYS.alice.publicKey).toBeDefined();
      expect(ED25519_TEST_KEYS.bob.publicKey).toBeDefined();
      expect(ED25519_TEST_KEYS.alice.publicKey).not.toBe(ED25519_TEST_KEYS.bob.publicKey);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid contract ID gracefully', () => {
      expect(() => {
        isValidContractId('invalid');
      }).not.toThrow();
    });

    it('should handle invalid amount gracefully', () => {
      expect(() => {
        validateAmount('invalid');
      }).not.toThrow();
    });

    it('should handle invalid address gracefully', () => {
      expect(() => {
        validateBase58Address('invalid');
      }).not.toThrow();
    });
  });
});
