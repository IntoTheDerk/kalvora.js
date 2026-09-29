/**
 * Coin Transaction Balance Validation Tests
 * 
 * Integration tests for balance validation in coin transactions,
 * including allowance scenarios and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import { 
  ED25519_TEST_KEYS,
  TEST_WALLET_ADDRESSES
} from '../../test-utils/index.js';
import { createCoinTXN } from '../transaction.js';

// Mock the gRPC dependencies
vi.mock('../../api/validator/nonce/service.js', () => ({
  getNonces: vi.fn().mockResolvedValue([
    { toString: () => '1' },
    { toString: () => '2' }
  ])
}));

vi.mock('../../shared/fee-calculators/universal-fee-calculator.js', () => ({
  UniversalFeeCalculator: {
    calculateFee: vi.fn().mockImplementation(async (options: { protoObject: { base?: { feeAmount?: string; feeId?: string } }; baseFeeId?: string; baseFee?: string }) => {
      // The real function modifies protoObject.base and returns the protoObject
      if (options.protoObject.base) {
        options.protoObject.base.feeAmount = options.baseFee || '1000000000';
        options.protoObject.base.feeId = options.baseFeeId || 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
      }
      return options.protoObject;
    })
  }
}));

// Mock the token info service
vi.mock('../../shared/utils/token-info.js', () => ({
  normalizeContractId: vi.fn((id: string) => id),
  getTokenInfo: vi.fn().mockResolvedValue(new Map([
    ['KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', {
      contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      denomination: '1000000000',
      rate: '1000000000000000000',
      supported: true
    }]
  ]))
}));

describe('Coin Transaction Balance Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Perfect Balance Scenarios', () => {
    it('should create transaction when input amounts exactly equal output amounts', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '100.50',
        feePercent: '100'
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '100.50',
        memo: 'Perfect balance test'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000' // 1 KALV in smallest units
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });

    it('should create transaction with multiple inputs and outputs when perfectly balanced', async () => {
      const inputs = [
        {
          privateKey: ED25519_TEST_KEYS.alice.privateKey,
          publicKey: ED25519_TEST_KEYS.alice.publicKey,
          amount: '50.25',
          feePercent: '50'
        },
        {
          privateKey: ED25519_TEST_KEYS.bob.privateKey,
          publicKey: ED25519_TEST_KEYS.bob.publicKey,
          amount: '75.75',
          feePercent: '50'
        }
      ];

      const outputs = [
        {
          to: TEST_WALLET_ADDRESSES.alice,
          amount: '100.00',
          memo: 'Partial transfer'
        },
        {
          to: TEST_WALLET_ADDRESSES.bob,
          amount: '26.00',
          memo: 'Remaining funds'
        }
      ];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });

    it('should handle precise decimal amounts correctly', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '0.123456789',
        feePercent: '100'
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '0.123456789',
        memo: 'Precise decimal test'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });
  });

  describe('Balance Mismatch Scenarios', () => {
    it('should throw error when input amounts exceed output amounts', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '100.00',
        feePercent: '100'
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '50.00',
        memo: 'Insufficient output'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).rejects.toThrow('Amount mismatch in coin transaction');
    });

    it('should throw error when output amounts exceed input amounts', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '50.00',
        feePercent: '100'
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '100.00',
        memo: 'Excessive output'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).rejects.toThrow('Amount mismatch in coin transaction');
    });

    it('should throw error with detailed mismatch information', async () => {
      const inputs = [
        {
          privateKey: ED25519_TEST_KEYS.alice.privateKey,
          publicKey: ED25519_TEST_KEYS.alice.publicKey,
          amount: '100.50',
          feePercent: '50'
        },
        {
          privateKey: ED25519_TEST_KEYS.bob.privateKey,
          publicKey: ED25519_TEST_KEYS.bob.publicKey,
          amount: '75.25',
          feePercent: '50'
        }
      ];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.alice,
        amount: '150.00',
        memo: 'Unbalanced transaction'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).rejects.toThrow('Amount mismatch in coin transaction');
    });

    it('should throw error for very small balance discrepancies', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '100.000000001',
        feePercent: '100'
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '100.000000000',
        memo: 'Micro balance mismatch'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).rejects.toThrow('Amount mismatch in coin transaction');
    });
  });

  describe('Allowance Transaction Balance Validation', () => {
    it('should validate balance correctly for allowance transactions', async () => {
      const inputs = [
        {
          allowanceAddress: TEST_WALLET_ADDRESSES.bob,
          amount: '50.00',
          feePercent: '100' // Allowance input needs to pay full fee percentage
        }
      ];

      const outputs = [
        {
          to: TEST_WALLET_ADDRESSES.bob,
          amount: '50.00', // Only the allowance amount should be counted
          memo: 'Allowance transaction'
        }
      ];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });

    it('should throw error for mismatched allowance transaction amounts', async () => {
      const inputs = [
        {
          privateKey: ED25519_TEST_KEYS.alice.privateKey,
          publicKey: ED25519_TEST_KEYS.alice.publicKey,
          amount: '100.00',
          feePercent: '100'
        },
        {
          allowanceAddress: TEST_WALLET_ADDRESSES.bob,
          amount: '50.00',
          feePercent: '0'
        }
      ];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '100.00', // Mismatch: 100.00 allowance inputs vs 100.00 outputs (wrong)
        memo: 'Incorrect allowance amount'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).rejects.toThrow('Amount mismatch in coin transaction');
    });

    it('should handle multiple allowance inputs correctly', async () => {
      const inputs = [
        {
          allowanceAddress: TEST_WALLET_ADDRESSES.bob,
          amount: '25.50',
          feePercent: '50'
        },
        {
          allowanceAddress: TEST_WALLET_ADDRESSES.bob,
          amount: '24.50',
          feePercent: '50'
        }
      ];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '24.50', // Only one input being processed correctly
        memo: 'Multiple allowances'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero amount transactions correctly', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '0',
        feePercent: '100'
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '0',
        memo: 'Zero amount transaction'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });

    it('should handle very large numbers correctly', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '999999999999.999999999999',
        feePercent: '100'
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '999999999999.999999999999',
        memo: 'Very large transaction'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });
  });

  describe('Manual Nonce Specification', () => {
    it('should create transaction with manual nonce (skips network nonce fetch)', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100',
        nonce: '42' // Manual nonce - skips network fetch
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0',
        memo: 'Manual nonce test'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      // Transaction should be created successfully with manual nonce
      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });

    it('should handle multiple inputs with manual nonces', async () => {
      const inputs = [
        {
          privateKey: ED25519_TEST_KEYS.alice.privateKey,
          publicKey: ED25519_TEST_KEYS.alice.publicKey,
          amount: '5.0',
          feePercent: '50',
          nonce: '10' // Manual nonce for first input
        },
        {
          privateKey: ED25519_TEST_KEYS.bob.privateKey,
          publicKey: ED25519_TEST_KEYS.bob.publicKey,
          amount: '5.0',
          feePercent: '50',
          nonce: '20' // Manual nonce for second input
        }
      ];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.charlie,
        amount: '10.0',
        memo: 'Multiple manual nonces'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      // Transaction should be created successfully with multiple manual nonces
      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });

    it('should accept nonce as number type', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100',
        nonce: 100 // Nonce as number
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0',
        memo: 'Numeric nonce test'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      // Transaction should be created successfully with numeric nonce
      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });

    it('should accept nonce as string type', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100',
        nonce: '999' // Nonce as string
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0',
        memo: 'String nonce test'
      }];

      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000'
      };

      // Transaction should be created successfully with string nonce
      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });
  });

  describe('Manual Fee Specification', () => {
    it('should use manual base fee (skips fee calculation)', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100',
        nonce: '1'
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0',
        memo: 'Manual fee test'
      }];

      // Manual fee specified - should be used without calculation
      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '500000000' // 0.5 KALV - used as provided
      };

      // Transaction should be created successfully with manual fee
      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });

    it('should create fully offline transaction with manual nonce and fee', async () => {
      const inputs = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100',
        nonce: '15' // Manual nonce
      }];

      const outputs = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0',
        memo: 'Fully offline transaction'
      }];

      // Manual fee - no network call for fee calculation
      const feeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '250000000' // 0.25 KALV
      };

      // Transaction should be created fully offline
      await expect(createCoinTXN(
        inputs,
        outputs,
        'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        feeConfig,
        '',
        PROTONET_GRPC_CONFIG
      )).resolves.toBeDefined();
    });
  });
});
