/**
 * Kalvora DEX Transaction Builder Tests
 * 
 * Unit tests for all DEX transaction builders.
 * Mocks `createSmartContractExecuteTXN` and `resolveAmount` to verify correct
 * action names, parameter formatting, and validation without hitting the network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We mock the execute module to capture calls without network
vi.mock('../../../execute/index.js', () => ({
  createSmartContractExecuteTXN: vi.fn().mockResolvedValue({ base: { hash: new Uint8Array([1, 2, 3]) } }),
  sendSmartContractExecuteTXN: vi.fn().mockResolvedValue('mock-hash-abc123'),
  ParamType: { STRING: 'string', BYTES: 'bytes', UINT32: 'uint32', UINT64: 'uint64' }
}));

// Mock resolveAmount — the single function that wraps token info lookup + conversion.
// Simulates a GIGA (10^9) denomination for all tokens.
vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>();
  return {
    ...actual,
    resolveAmount: vi.fn(async (amount: unknown, _contractId: string) => {
      const val = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
      return String(Math.floor(val * 1_000_000_000));
    })
  };
});

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { createSmartContractExecuteTXN, sendSmartContractExecuteTXN } from '../../../execute/index.js';
import { addLiquidity, addLiquidityAndSend } from '../transactions/add-liquidity.js';
import { createLiquidityPool, createLiquidityPoolAndSend } from '../transactions/create-pool.js';
import { removeLiquidity, removeLiquidityAndSend } from '../transactions/remove-liquidity.js';
import { swap, swapAndSend } from '../transactions/swap.js';
import { unlockLiquidity, unlockLiquidityAndSend } from '../transactions/unlock-liquidity.js';
import { DEX_CONTRACT_NAME, DEX_INSTANCE } from '../utils.js';

// ============================================================================
// SHARED CONSTANTS
// ============================================================================

const MOCK_PUBLIC_KEY = 'A_AKpo7NMd3JhGAonxXJXuG8XgDXA8jZGikK6UaHDYxksU';
const MOCK_PRIVATE_KEY = 'Akyo231kUTYfC9AXokfUVhq7XoL6gri7zVfFi8WSG5Kt';

const mockedCreate = vi.mocked(createSmartContractExecuteTXN);
const mockedSend = vi.mocked(sendSmartContractExecuteTXN);

// ============================================================================
// HELPER
// ============================================================================

/** Extract the action name and parameter string from the mocked call */
function getLastCallParams(): { actionName: string; paramString: string } {
  const lastCall = mockedCreate.mock.lastCall!;
  // params are: contractName, instance, functionName, parameters, pubKey, privKey, options
  const parameters = lastCall[3] as Array<{ value: string }>;
  return {
    actionName: parameters[0].value,
    paramString: parameters[1].value
  };
}

/** Verify the contract, instance, and function are always correct */
function assertDexContract() {
  const lastCall = mockedCreate.mock.lastCall!;
  expect(lastCall[0]).toBe(DEX_CONTRACT_NAME);
  expect(lastCall[1]).toBe(DEX_INSTANCE);
  expect(lastCall[2]).toBe('execute');
}

// ============================================================================
// TESTS
// ============================================================================

describe('Kalvora DEX Transaction Builders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // createLiquidityPool
  // --------------------------------------------------------------------------

  describe('createLiquidityPool', () => {
    it('should build transaction with correct action name', async () => {
      await createLiquidityPool(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-USDC000000', amountA: '100', amountB: '12', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      assertDexContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('create_liquidity_pool');
    });

    it('should auto-convert user-friendly amounts to smallest units', async () => {
      await createLiquidityPool(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-USDC000000', amountA: '100', amountB: '12', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      const parts = paramString.split(',');
      expect(parts[0]).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
      expect(parts[1]).toBe('solana-USDC000000');
      // 100 * 10^9 = 100000000000
      expect(parts[2]).toBe('100000000000');
      // 12 * 10^9 = 12000000000
      expect(parts[3]).toBe('12000000000');
      expect(parts[4]).toBe('25');
      // parts[5] is the lock timestamp — just verify it's a number
      expect(Number(parts[5])).toBeGreaterThan(0);
    });

    it('should accept decimal amounts', async () => {
      await createLiquidityPool(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-USDC000000', amountA: '1.5', amountB: '0.5', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      const parts = paramString.split(',');
      // 1.5 * 10^9 = 1500000000
      expect(parts[2]).toBe('1500000000');
      // 0.5 * 10^9 = 500000000
      expect(parts[3]).toBe('500000000');
    });

    it('should use custom lock duration', async () => {
      const before = Math.floor(Date.now() / 1000);
      await createLiquidityPool(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-USDC000000', amountA: '10', amountB: '20', feeRate: 25, lockDuration: 3600 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      const lockTs = Number(paramString.split(',')[5]);
      expect(lockTs).toBeGreaterThanOrEqual(before + 3600);
      expect(lockTs).toBeLessThanOrEqual(before + 3600 + 5); // within 5s tolerance
    });

    it('should throw on missing tokenA', async () => {
      await expect(
        createLiquidityPool(
          { tokenA: '', tokenB: 'solana-USDC000000', amountA: '10', amountB: '20', feeRate: 25 },
          MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
        )
      ).rejects.toThrow('tokenA is required');
    });

    it('should throw on missing tokenB', async () => {
      await expect(
        createLiquidityPool(
          { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: '', amountA: '10', amountB: '20', feeRate: 25 },
          MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
        )
      ).rejects.toThrow('tokenB is required');
    });

    it('should throw on missing publicKey', async () => {
      await expect(
        createLiquidityPool(
          { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-USDC000000', amountA: '10', amountB: '20', feeRate: 25 },
          '', MOCK_PRIVATE_KEY
        )
      ).rejects.toThrow('publicKeyBase58Identifier is required');
    });

    it('createLiquidityPoolAndSend should build and send', async () => {
      const hash = await createLiquidityPoolAndSend(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-USDC000000', amountA: '10', amountB: '20', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      expect(mockedCreate).toHaveBeenCalledOnce();
      expect(mockedSend).toHaveBeenCalledOnce();
      expect(hash).toBe('mock-hash-abc123');
    });
  });

  // --------------------------------------------------------------------------
  // addLiquidity
  // --------------------------------------------------------------------------

  describe('addLiquidity', () => {
    it('should build transaction with correct action name', async () => {
      await addLiquidity(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-SOL000000', amountA: '50', amountB: '100', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      assertDexContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('add_liquidity');
    });

    it('should auto-convert amounts to smallest units', async () => {
      await addLiquidity(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-SOL000000', amountA: '50', amountB: '100', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      const parts = paramString.split(',');
      expect(parts[0]).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
      expect(parts[1]).toBe('solana-SOL000000');
      expect(parts[2]).toBe('50000000000');
      expect(parts[3]).toBe('100000000000');
      expect(parts[4]).toBe('25');
      expect(Number(parts[5])).toBeGreaterThan(0);
    });

    it('should throw on missing fields', async () => {
      await expect(
        addLiquidity(
          { tokenA: '', tokenB: 'solana-SOL000000', amountA: '50', amountB: '100', feeRate: 25 },
          MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
        )
      ).rejects.toThrow('tokenA is required');
    });

    it('addLiquidityAndSend should build and send', async () => {
      const hash = await addLiquidityAndSend(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-SOL000000', amountA: '50', amountB: '100', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      expect(hash).toBe('mock-hash-abc123');
    });
  });

  // --------------------------------------------------------------------------
  // removeLiquidity
  // --------------------------------------------------------------------------

  describe('removeLiquidity', () => {
    it('should build transaction with correct action name', async () => {
      await removeLiquidity(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-SOL000000', lpAmount: '197.64235376', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      assertDexContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('remove_liquidity');
    });

    it('should pass LP amount converted with 9 decimals', async () => {
      await removeLiquidity(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-SOL000000', lpAmount: '197.64235376', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      // 197.64235376 * 10^9 = 197642353760
      expect(paramString).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao,solana-SOL000000,197642353760,25');
    });

    it('should throw on missing lpAmount', async () => {
      await expect(
        removeLiquidity(
          { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-SOL000000', lpAmount: '', feeRate: 25 },
          MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
        )
      ).rejects.toThrow('lpAmount is required');
    });

    it('removeLiquidityAndSend should build and send', async () => {
      const hash = await removeLiquidityAndSend(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-SOL000000', lpAmount: '100', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      expect(hash).toBe('mock-hash-abc123');
    });
  });

  // --------------------------------------------------------------------------
  // unlockLiquidity
  // --------------------------------------------------------------------------

  describe('unlockLiquidity', () => {
    it('should build transaction with correct action name', async () => {
      await unlockLiquidity(
        { tokenA: 'solana-SOL000000', tokenB: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      assertDexContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('unlock_liquidity_pool_tokens');
    });

    it('should format parameters correctly', async () => {
      await unlockLiquidity(
        { tokenA: 'solana-SOL000000', tokenB: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      expect(paramString).toBe('solana-SOL000000,KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao,25');
    });

    it('should throw on missing feeRate', async () => {
      await expect(
        unlockLiquidity(
          { tokenA: 'solana-SOL000000', tokenB: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', feeRate: undefined as unknown as number },
          MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
        )
      ).rejects.toThrow('feeRate is required');
    });

    it('unlockLiquidityAndSend should build and send', async () => {
      const hash = await unlockLiquidityAndSend(
        { tokenA: 'solana-SOL000000', tokenB: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      expect(hash).toBe('mock-hash-abc123');
    });
  });

  // --------------------------------------------------------------------------
  // swap
  // --------------------------------------------------------------------------

  describe('swap', () => {
    it('should build transaction with correct action name', async () => {
      await swap(
        { tokenIn: 'solana-SOL000000', tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', amountIn: '5.5', feeRate: 25, platformFeeBps: 100 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      assertDexContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('swap');
    });

    it('should auto-convert amount and include platform fee address', async () => {
      await swap(
        {
          tokenIn: 'solana-SOL000000', tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', amountIn: '5',
          feeRate: 25, platformFeeBps: 100,
          platformFeeAddress: 'EW9iaR8AvFVRt4MHDqzqxGVFEu12Djtuht8FfmtL7vMZ'
        },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      // 5 * 10^9 = 5000000000
      expect(paramString).toBe(
        'solana-SOL000000,KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao,5000000000,25,100,EW9iaR8AvFVRt4MHDqzqxGVFEu12Djtuht8FfmtL7vMZ'
      );
    });

    it('should default platformFeeAddress to empty string', async () => {
      await swap(
        { tokenIn: 'solana-SOL000000', tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', amountIn: '1', feeRate: 25, platformFeeBps: 0 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      expect(paramString).toBe('solana-SOL000000,KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao,1000000000,25,0,');
    });

    it('should allow zero platform fee', async () => {
      await swap(
        { tokenIn: 'solana-SOL000000', tokenOut: 'LEET1337', amountIn: '1', feeRate: 25, platformFeeBps: 0 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      const parts = paramString.split(',');
      expect(parts[4]).toBe('0');
    });

    it('should throw on missing platformFeeBps', async () => {
      await expect(
        swap(
          { tokenIn: 'solana-SOL000000', tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', amountIn: '10', feeRate: 25, platformFeeBps: undefined as unknown as number },
          MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
        )
      ).rejects.toThrow('platformFeeBps is required');
    });

    it('swapAndSend should build and send', async () => {
      const hash = await swapAndSend(
        { tokenIn: 'solana-SOL000000', tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', amountIn: '10', feeRate: 25, platformFeeBps: 100 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      expect(hash).toBe('mock-hash-abc123');
    });
  });

  // --------------------------------------------------------------------------
  // Cross-cutting concerns
  // --------------------------------------------------------------------------

  describe('Cross-cutting', () => {
    it('should pass custom feeId through options', async () => {
      await swap(
        { tokenIn: 'solana-SOL000000', tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', amountIn: '10', feeRate: 25, platformFeeBps: 100 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY,
        { feeId: 'LEET1337' }
      );

      const lastCall = mockedCreate.mock.lastCall!;
      const options = lastCall[6] as Record<string, unknown>;
      expect(options.feeId).toBe('LEET1337');
    });

    it('should pass grpcConfig through options', async () => {
      const customConfig = { host: 'custom.grpc.io', port: 50051 };
      await swap(
        { tokenIn: 'solana-SOL000000', tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', amountIn: '10', feeRate: 25, platformFeeBps: 100 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY,
        { grpcConfig: customConfig }
      );

      const lastCall = mockedCreate.mock.lastCall!;
      const options = lastCall[6] as Record<string, unknown>;
      expect(options.grpcConfig).toEqual(customConfig);
    });

    it('should always use two string parameters', async () => {
      await createLiquidityPool(
        { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-USDC000000', amountA: '10', amountB: '20', feeRate: 25 },
        MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY
      );

      const lastCall = mockedCreate.mock.lastCall!;
      const parameters = lastCall[3] as Array<{ type: string; value: string }>;
      expect(parameters).toHaveLength(2);
      expect(parameters[0].type).toBe('string');
      expect(parameters[1].type).toBe('string');
    });
  });
});
