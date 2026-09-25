/**
 * New Token Balance Fee Tests
 * 
 * Tests for the needsInitialization override on FeeConfig, which controls
 * whether the $0.20 per-address initialization fee is added to CoinTXN base fees.
 * 
 * Three modes:
 * - undefined (default): calls getBalance() API to auto-detect
 * - true: always adds the fee (skips API call)
 * - false: never adds the fee (skips API call)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import { 
  ED25519_TEST_KEYS,
  TEST_WALLET_ADDRESSES
} from '../../test-utils/index.js';
import { createCoinTXN } from '../transaction.js';

// Track whether getBalance was called
const getBalanceMock = vi.fn().mockResolvedValue({
  balance: '0',
  rate: '1000000000000000000',
  denomination: '1000000000'
});

// Mock the gRPC dependencies
vi.mock('../../api/validator/nonce/service.js', () => ({
  getNonces: vi.fn().mockResolvedValue([
    { toString: () => '1' },
    { toString: () => '2' }
  ])
}));

vi.mock('../../api/validator/balance/service.js', () => ({
  getBalance: (...args: unknown[]) => getBalanceMock(...args)
}));

vi.mock('../../shared/fee-calculators/universal-fee-calculator.js', () => ({
  UniversalFeeCalculator: {
    calculateFee: vi.fn().mockImplementation(async (options: {
      protoObject: { base?: { feeAmount?: string; feeId?: string } };
      baseFeeId?: string;
      baseFee?: string;
      needsInitialization?: boolean;
    }) => {
      // Simulate base fee calculation
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

describe('New Token Balance Fee - needsInitialization Override', () => {
  const defaultInputs = [{
    privateKey: ED25519_TEST_KEYS.alice.privateKey,
    publicKey: ED25519_TEST_KEYS.alice.publicKey,
    amount: '10',
    nonce: '1'
  }];

  const defaultOutputs = [{
    to: TEST_WALLET_ADDRESSES.bob,
    amount: '10'
  }];

  const contractId = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('needsInitialization = undefined (default)', () => {
    it('should create transaction successfully with default behavior', async () => {
      const txn = await createCoinTXN(
        defaultInputs,
        defaultOutputs,
        contractId,
        { baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' },
        '',
        PROTONET_GRPC_CONFIG
      );

      expect(txn).toBeDefined();
      expect(txn.base?.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    });

    it('should pass needsInitialization as undefined to fee calculator', async () => {
      const { UniversalFeeCalculator } = await import('../../shared/fee-calculators/universal-fee-calculator.js');

      await createCoinTXN(
        defaultInputs,
        defaultOutputs,
        contractId,
        { baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' },
        '',
        PROTONET_GRPC_CONFIG
      );

      expect(UniversalFeeCalculator.calculateFee).toHaveBeenCalledWith(
        expect.not.objectContaining({
          needsInitialization: expect.anything()
        })
      );
    });
  });

  describe('needsInitialization = true', () => {
    it('should create transaction with needsInitialization=true', async () => {
      const txn = await createCoinTXN(
        defaultInputs,
        defaultOutputs,
        contractId,
        { baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', needsInitialization: true },
        '',
        PROTONET_GRPC_CONFIG
      );

      expect(txn).toBeDefined();
      expect(txn.base?.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    });

    it('should pass needsInitialization=true to fee calculator', async () => {
      const { UniversalFeeCalculator } = await import('../../shared/fee-calculators/universal-fee-calculator.js');

      await createCoinTXN(
        defaultInputs,
        defaultOutputs,
        contractId,
        { baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', needsInitialization: true },
        '',
        PROTONET_GRPC_CONFIG
      );

      expect(UniversalFeeCalculator.calculateFee).toHaveBeenCalledWith(
        expect.objectContaining({
          needsInitialization: true
        })
      );
    });
  });

  describe('needsInitialization = false', () => {
    it('should create transaction with needsInitialization=false', async () => {
      const txn = await createCoinTXN(
        defaultInputs,
        defaultOutputs,
        contractId,
        { baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', needsInitialization: false },
        '',
        PROTONET_GRPC_CONFIG
      );

      expect(txn).toBeDefined();
      expect(txn.base?.feeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    });

    it('should pass needsInitialization=false to fee calculator', async () => {
      const { UniversalFeeCalculator } = await import('../../shared/fee-calculators/universal-fee-calculator.js');

      await createCoinTXN(
        defaultInputs,
        defaultOutputs,
        contractId,
        { baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', needsInitialization: false },
        '',
        PROTONET_GRPC_CONFIG
      );

      expect(UniversalFeeCalculator.calculateFee).toHaveBeenCalledWith(
        expect.objectContaining({
          needsInitialization: false
        })
      );
    });
  });

  describe('FeeConfig type compatibility', () => {
    it('should accept FeeConfig without needsInitialization', async () => {
      const txn = await createCoinTXN(
        defaultInputs,
        defaultOutputs,
        contractId,
        { baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', overestimatePercent: 5 },
        '',
        PROTONET_GRPC_CONFIG
      );

      expect(txn).toBeDefined();
    });

    it('should accept FeeConfig with needsInitialization alongside other options', async () => {
      const txn = await createCoinTXN(
        defaultInputs,
        defaultOutputs,
        contractId,
        {
          baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
          overestimatePercent: 10,
          needsInitialization: true
        },
        '',
        PROTONET_GRPC_CONFIG
      );

      expect(txn).toBeDefined();
    });

    it('should work with manual baseFee even when needsInitialization is set', async () => {
      // When baseFee is manually specified, STEP 4 is skipped entirely
      // so needsInitialization is unused (but still accepted without error)
      const txn = await createCoinTXN(
        defaultInputs,
        defaultOutputs,
        contractId,
        {
          baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
          baseFee: '5000000000',
          needsInitialization: true
        },
        '',
        PROTONET_GRPC_CONFIG
      );

      expect(txn).toBeDefined();
    });
  });
});
