/**
 * Transaction Integration Tests
 *
 * Comprehensive integration tests for transaction creation and management
 * including validation, error handling, and performance.
 *
 * Note: These tests are mocked to work offline. For true integration testing
 * against the network, remove the mocks below.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { CoinTXN } from '../../../proto/generated/txn_pb.js';
import type { FeeConfig } from '../../shared/fee-calculators/universal-fee-calculator.js';
import {
  ErrorHandler
} from '../../shared/utils/error-handler.js';
import {
  benchmark,
  PerformanceBenchmark
} from '../../shared/utils/performance-benchmark.js';
import {
  validateAmount,
  validateBase58Address,
  isValidContractId
} from '../../shared/utils/validation.js';
import {
  ED25519_TEST_KEYS,
  TEST_WALLET_ADDRESSES
} from '../../test-utils/index.js';
import {
  createCoinTXN,
  sendCoinTXN,
  type CoinTXNInput,
  type CoinTXNOutput
} from '../index.js';

// Mock the network dependencies to enable offline testing
vi.mock('../../api/validator/nonce/service.js', () => ({
  getNonces: vi.fn().mockResolvedValue([
    { toString: () => '1' },
    { toString: () => '2' },
    { toString: () => '3' }
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

describe('Transaction Integration Tests', () => {
  let contractId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    contractId = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
  });

  describe('Basic Transaction Creation', () => {
    it('should create a basic transaction', async () => {
      const inputs: CoinTXNInput[] = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100',
        nonce: '1' // Manual nonce for offline testing
      }];

      const outputs: CoinTXNOutput[] = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0',
        memo: 'Test transaction'
      }];

      const feeConfig: FeeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000' // Manual fee (1 KALV) for offline testing
      };

      const transaction = await createCoinTXN(
        inputs,
        outputs,
        contractId,
        feeConfig,
        'Test transaction'
      );

      expect(transaction).toBeDefined();
      expect(transaction.base).toBeDefined();
      expect(transaction.contractId).toBe(contractId);
      expect(transaction.inputTransfers).toHaveLength(1);
      expect(transaction.outputTransfers).toHaveLength(1);
      expect(transaction.auth).toBeDefined();
    });

    it('should create a transaction with multiple inputs and outputs', async () => {
      const inputs: CoinTXNInput[] = [
        {
          privateKey: ED25519_TEST_KEYS.alice.privateKey,
          publicKey: ED25519_TEST_KEYS.alice.publicKey,
          amount: '5.0',
          feePercent: '50',
          nonce: '1' // Manual nonce
        },
        {
          privateKey: ED25519_TEST_KEYS.bob.privateKey,
          publicKey: ED25519_TEST_KEYS.bob.publicKey,
          amount: '5.0',
          feePercent: '50',
          nonce: '1' // Manual nonce
        }
      ];

      const outputs: CoinTXNOutput[] = [
        {
          to: TEST_WALLET_ADDRESSES.charlie,
          amount: '7.0',
          memo: 'Primary recipient'
        },
        {
          to: TEST_WALLET_ADDRESSES.bob,
          amount: '3.0',
          memo: 'Secondary recipient'
        }
      ];

      const feeConfig: FeeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000' // Manual fee
      };

      const transaction = await createCoinTXN(
        inputs,
        outputs,
        contractId,
        feeConfig,
        'Multi-input/output transaction'
      );

      expect(transaction.inputTransfers).toHaveLength(2);
      expect(transaction.outputTransfers).toHaveLength(2);
      expect(transaction.auth?.publicKey).toHaveLength(2);
      expect(transaction.auth?.signature).toHaveLength(2);
    });

    it('should create a transaction with custom fees', async () => {
      const inputs: CoinTXNInput[] = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100',
        nonce: '1' // Manual nonce
      }];

      const outputs: CoinTXNOutput[] = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0',
        memo: 'Custom fee transaction'
      }];

      const feeConfig: FeeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000', // Manual base fee (0.001 KALV)
        contractFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        contractFee: '500000', // Manual contract fee (0.0005 KALV)
        overestimatePercent: 10.0
      };

      const transaction = await createCoinTXN(
        inputs,
        outputs,
        contractId,
        feeConfig,
        'Custom fee transaction'
      );

      expect(transaction).toBeDefined();
      expect(transaction.base?.feeAmount).toBeDefined();
      expect(transaction.base?.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    });
  });

  describe('Input Validation', () => {
    it('should validate contract ID format', () => {
      const validContractId = isValidContractId('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
      expect(validContractId).toBe(true);

      const invalidContractId = isValidContractId('invalid contract id');
      expect(invalidContractId).toBe(false);
    });

    it('should validate transaction amounts', () => {
      const validAmount = validateAmount('10.5', {
        minAmount: '0.001',
        maxAmount: '1000000',
        allowZero: false
      });
      expect(validAmount.isValid).toBe(true);
      expect(validAmount.value).toBe('10.5');

      const invalidAmount = validateAmount('-10.5');
      expect(invalidAmount.isValid).toBe(false);
      expect(invalidAmount.error).toBeDefined();
    });

    it('should validate wallet addresses', () => {
      const validAddress = validateBase58Address(TEST_WALLET_ADDRESSES.alice);
      expect(validAddress.isValid).toBe(true);
      expect(validAddress.value).toBe(TEST_WALLET_ADDRESSES.alice);

      const invalidAddress = validateBase58Address('invalid-address');
      expect(invalidAddress.isValid).toBe(false);
      expect(invalidAddress.error).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid contract ID', async () => {
      const inputs: CoinTXNInput[] = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100'
      }];

      const outputs: CoinTXNOutput[] = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0'
      }];

      await expect(createCoinTXN(
        inputs,
        outputs,
        'invalid contract id',
        {},
        'Invalid contract ID test'
      )).rejects.toThrow();
    });

    it('should handle invalid inputs array', async () => {
      const outputs: CoinTXNOutput[] = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0'
      }];

      await expect(createCoinTXN(
        [] as any, // Empty inputs
        outputs,
        contractId,
        {},
        'Empty inputs test'
      )).rejects.toThrow();
    });

    it('should handle invalid outputs array', async () => {
      const inputs: CoinTXNInput[] = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100'
      }];

      await expect(createCoinTXN(
        inputs,
        [] as any, // Empty outputs
        contractId,
        {},
        'Empty outputs test'
      )).rejects.toThrow();
    });

    it('should handle invalid amounts', async () => {
      const inputs: CoinTXNInput[] = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '-10.5', // Negative amount
        feePercent: '100'
      }];

      const outputs: CoinTXNOutput[] = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0'
      }];

      await expect(createCoinTXN(
        inputs,
        outputs,
        contractId,
        {},
        'Negative amount test'
      )).rejects.toThrow();
    });

    it('should handle invalid fee percentages', async () => {
      const inputs: CoinTXNInput[] = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '50' // Should be 100% for single input
      }];

      const outputs: CoinTXNOutput[] = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0'
      }];

      await expect(createCoinTXN(
        inputs,
        outputs,
        contractId,
        {},
        'Invalid fee percentage test'
      )).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    it('should create transactions within reasonable time', async () => {
      const inputs: CoinTXNInput[] = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100',
        nonce: '1' // Manual nonce
      }];

      const outputs: CoinTXNOutput[] = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0',
        memo: 'Performance test transaction'
      }];

      const feeConfig: FeeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000' // Manual fee
      };

      const result = await benchmark(
        'Transaction Creation Performance',
        async () => {
          return await createCoinTXN(
            inputs,
            outputs,
            contractId,
            feeConfig,
            'Performance test'
          );
        },
        {
          iterations: 10,
          warmupIterations: 2
        }
      );

      expect(result.averageTime).toBeLessThan(5000); // Should be under 5 seconds
      expect(result.iterations).toBe(10);
    });

    it('should handle multiple transaction creation efficiently', async () => {
      const benchmark = new PerformanceBenchmark();

      const inputs: CoinTXNInput[] = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100',
        nonce: '1' // Manual nonce
      }];

      const outputs: CoinTXNOutput[] = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0',
        memo: 'Batch transaction'
      }];

      const feeConfig: FeeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000' // Manual fee
      };

      const result = await benchmark.benchmark(
        'Batch Transaction Creation',
        async () => {
          const transactions: CoinTXN[] = [];
          for (let i = 0; i < 5; i++) {
            const transaction = await createCoinTXN(
              inputs,
              outputs,
              contractId,
              feeConfig,
              `Batch transaction ${i}`
            );
            transactions.push(transaction);
          }
          return transactions;
        },
        {
          iterations: 3,
          warmupIterations: 1
        }
      );

      expect(result.averageTime).toBeLessThan(15000); // Should be under 15 seconds
      expect(result.iterations).toBe(3);
    });
  });

  describe('Transaction Signing', () => {
    it('should sign transactions correctly', async () => {
      const inputs: CoinTXNInput[] = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100',
        nonce: '1' // Manual nonce
      }];

      const outputs: CoinTXNOutput[] = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0',
        memo: 'Signed transaction'
      }];

      const feeConfig: FeeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000' // Manual fee
      };

      const transaction = await createCoinTXN(
        inputs,
        outputs,
        contractId,
        feeConfig,
        'Signed transaction'
      );

      expect(transaction.auth?.signature).toBeDefined();
      expect(transaction.auth?.signature).toHaveLength(1);
      expect(transaction.auth?.publicKey).toBeDefined();
      expect(transaction.auth?.publicKey).toHaveLength(1);
      expect(transaction.base?.hash).toBeDefined();
    });

    it('should sign multiple input transactions correctly', async () => {
      const inputs: CoinTXNInput[] = [
        {
          privateKey: ED25519_TEST_KEYS.alice.privateKey,
          publicKey: ED25519_TEST_KEYS.alice.publicKey,
          amount: '5.0',
          feePercent: '50',
          nonce: '1' // Manual nonce
        },
        {
          privateKey: ED25519_TEST_KEYS.bob.privateKey,
          publicKey: ED25519_TEST_KEYS.bob.publicKey,
          amount: '5.0',
          feePercent: '50',
          nonce: '1' // Manual nonce
        }
      ];

      const outputs: CoinTXNOutput[] = [{
        to: TEST_WALLET_ADDRESSES.charlie,
        amount: '10.0',
        memo: 'Multi-signed transaction'
      }];

      const feeConfig: FeeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000' // Manual fee
      };

      const transaction = await createCoinTXN(
        inputs,
        outputs,
        contractId,
        feeConfig,
        'Multi-signed transaction'
      );

      expect(transaction.auth?.signature).toHaveLength(2);
      expect(transaction.auth?.publicKey).toHaveLength(2);
      expect(transaction.base?.hash).toBeDefined();
    });
  });

  describe('Transaction Submission', () => {
    it('should handle transaction submission errors gracefully', async () => {
      const inputs: CoinTXNInput[] = [{
        privateKey: ED25519_TEST_KEYS.alice.privateKey,
        publicKey: ED25519_TEST_KEYS.alice.publicKey,
        amount: '10.0',
        feePercent: '100',
        nonce: '1' // Manual nonce
      }];

      const outputs: CoinTXNOutput[] = [{
        to: TEST_WALLET_ADDRESSES.bob,
        amount: '10.0',
        memo: 'Submission test transaction'
      }];

      const feeConfig: FeeConfig = {
        baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        baseFee: '1000000000' // Manual fee
      };

      const transaction = await createCoinTXN(
        inputs,
        outputs,
        contractId,
        feeConfig,
        'Submission test transaction'
      );

      // Since we are mocking the network, this should succeed
      const result = await sendCoinTXN(transaction);
      expect(result).toBeDefined();
    });
  });
});
