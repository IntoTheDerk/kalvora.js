/**
 * Transaction Validation Tests
 * 
 * Unit tests for transaction validation functions
 * without any gRPC dependencies.
 */

import { describe, it, expect } from 'vitest';

import { 
  validateAmountBalance,
  validateExactAmountBalance,
  addAmounts,
  toDecimal
} from '../../shared/utils/amount-utils.js';
import { 
  InputValidator
} from '../../shared/utils/validation.js';
import { TEST_WALLET_ADDRESSES } from '../../test-utils/keys.test.js';

describe('Transaction Validation Tests', () => {
  describe('Amount Validation', () => {
    it('should validate valid amounts', () => {
      const validAmounts = [
        '1000000000', // 1 KALV in zerite
        '5000000000', // 5 KALV
        '1000000000000', // 1000 KALV
        '1' // Minimum amount
      ];

      validAmounts.forEach(amount => {
        const result = InputValidator.validateAmount(amount);
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
        const result = InputValidator.validateAmount(amount);
        expect(result.isValid).toBe(false);
      });
    });
  });

  describe('Address Validation', () => {
    it('should validate valid Base58 addresses', () => {
      const validAddresses = [
        TEST_WALLET_ADDRESSES.alice,
        TEST_WALLET_ADDRESSES.bob
      ];

      validAddresses.forEach(address => {
        const result = InputValidator.validateBase58Address(address);
        expect(result.isValid).toBe(true);
      });
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
        const result = InputValidator.validateBase58Address(address);
        expect(result.isValid).toBe(false);
      });
    });
  });

  describe('Balance Validation', () => {
    describe('validateAmountBalance (inputs >= outputs)', () => {
      it('should pass when inputs equal outputs', () => {
        const inputAmounts = ['100.50', '200.25'];
        const outputAmounts = ['300.75'];
        
        expect(() => {
          validateAmountBalance(inputAmounts, outputAmounts);
        }).not.toThrow();
      });

      it('should pass when inputs exceed outputs', () => {
        const inputAmounts = ['100.00', '200.00'];
        const outputAmounts = ['250.00'];
        
        expect(() => {
          validateAmountBalance(inputAmounts, outputAmounts);
        }).not.toThrow();
      });

      it('should throw when inputs are less than outputs', () => {
        const inputAmounts = ['100.00', '200.00'];
        const outputAmounts = ['350.00'];
        
        expect(() => {
          validateAmountBalance(inputAmounts, outputAmounts);
        }).toThrow('Insufficient balance: inputs (300) < outputs (350)');
      });

      it('should handle multiple inputs and outputs correctly', () => {
        const inputAmounts = ['50.25', '75.75', '100.00'];
        const outputAmounts = ['125.50', '100.50'];
        
        expect(() => {
          validateAmountBalance(inputAmounts, outputAmounts);
        }).not.toThrow();
      });

      it('should handle decimal precision correctly', () => {
        const inputAmounts = ['0.1', '0.2'];
        const outputAmounts = ['0.3'];
        
        expect(() => {
          validateAmountBalance(inputAmounts, outputAmounts);
        }).not.toThrow();
      });
    });

    describe('validateExactAmountBalance (inputs === outputs)', () => {
      it('should pass when inputs exactly equal outputs', () => {
        const inputAmounts = ['100.50', '200.25'];
        const outputAmounts = ['300.75'];
        
        expect(() => {
          validateExactAmountBalance(inputAmounts, outputAmounts);
        }).not.toThrow();
      });

      it('should throw when inputs exceed outputs', () => {
        const inputAmounts = ['100.00', '200.00'];
        const outputAmounts = ['250.00'];
        
        expect(() => {
          validateExactAmountBalance(inputAmounts, outputAmounts);
        }).toThrow('Amount mismatch in coin transaction: inputs (300) !== outputs (250). Difference: 50');
      });

      it('should throw when inputs are less than outputs', () => {
        const inputAmounts = ['100.00', '150.00'];
        const outputAmounts = ['300.00'];
        
        expect(() => {
          validateExactAmountBalance(inputAmounts, outputAmounts);
        }).toThrow('Amount mismatch in coin transaction: inputs (250) !== outputs (300). Difference: -50');
      });

      it('should handle multiple inputs and outputs correctly', () => {
        const inputAmounts = ['50.25', '75.75', '100.00'];
        const outputAmounts = ['225.50', '0.50'];
        
        expect(() => {
          validateExactAmountBalance(inputAmounts, outputAmounts);
        }).not.toThrow();
      });

      it('should handle exact decimal precision', () => {
        const inputAmounts = ['0.1', '0.2'];
        const outputAmounts = ['0.3'];
        
        expect(() => {
          validateExactAmountBalance(inputAmounts, outputAmounts);
        }).not.toThrow();
      });

      it('should handle zero amounts correctly', () => {
        const inputAmounts = ['0'];
        const outputAmounts = ['0'];
        
        expect(() => {
          validateExactAmountBalance(inputAmounts, outputAmounts);
        }).not.toThrow();
      });

      it('should handle large numbers correctly', () => {
        const inputAmounts = ['1000000.50', '2000000.50'];
        const outputAmounts = ['3000001.00'];
        
        expect(() => {
          validateExactAmountBalance(inputAmounts, outputAmounts);
        }).not.toThrow();
      });

      it('should provide detailed error information', () => {
        const inputAmounts = ['100.0000000001', '200.0000000001'];
        const outputAmounts = ['300.0'];
        
        expect(() => {
          validateExactAmountBalance(inputAmounts, outputAmounts);
        }).toThrow(/Amount mismatch in coin transaction.*inputs.*!=.*outputs.*Difference:/);
      });
    });

    describe('Add Amounts Utility', () => {
      it('should correctly add multiple amounts', () => {
        const amounts = ['100.50', '200.25', '150.75'];
        const result = addAmounts(...amounts);
        expect(result.toString()).toBe('451.5');
      });

      it('should handle single amount', () => {
        const amounts = ['100.50'];
        const result = addAmounts(...amounts);
        expect(result.toString()).toBe('100.5');
      });

      it('should handle zero amounts', () => {
        const amounts = ['0', '100', '0'];
        const result = addAmounts(...amounts);
        expect(result.toString()).toBe('100');
      });
    });

    describe('Decimal Conversion', () => {
      it('should convert string amounts to Decimal', () => {
        const decimal = toDecimal('123.456');
        expect(decimal.toString()).toBe('123.456');
        expect(decimal.isFinite()).toBe(true);
      });

      it('should convert number amounts to Decimal', () => {
        const decimal = toDecimal(123.456);
        expect(decimal.toString()).toBe('123.456');
      });

      it('should handle very small amounts', () => {
        const decimal = toDecimal('0.000000001');
        expect(decimal.toString()).toBe('0.000000001');
      });

      it('should handle very large amounts', () => {
        const decimal = toDecimal('999999999999999.999999999999999');
        expect(decimal.toString()).toBe('999999999999999.999999999999999');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid amount gracefully', () => {
      expect(() => {
        InputValidator.validateAmount('invalid');
      }).not.toThrow();
    });

    it('should handle invalid address gracefully', () => {
      expect(() => {
        InputValidator.validateBase58Address('invalid');
      }).not.toThrow();
    });
  });
});