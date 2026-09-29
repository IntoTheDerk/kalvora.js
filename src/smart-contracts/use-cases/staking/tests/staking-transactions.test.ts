/**
 * Kalvora Staking Transaction Builder Tests
 * 
 * Unit tests for all staking transaction builders.
 * Mocks `createSmartContractExecuteTXN` to verify correct action names,
 * parameter formatting, and validation without hitting the network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We mock the execute module to capture calls without network
vi.mock('../../../execute/index.js', () => ({
  createSmartContractExecuteTXN: vi.fn().mockResolvedValue({ base: { hash: new Uint8Array([1, 2, 3]) } }),
  sendSmartContractExecuteTXN: vi.fn().mockResolvedValue('mock-hash-abc123'),
  ParamType: { STRING: 'string', BYTES: 'bytes', UINT32: 'uint32', UINT64: 'uint64' }
}));

import { ED25519_TEST_KEYS } from '../../../../test-utils/index.js';
import { createSmartContractExecuteTXN, sendSmartContractExecuteTXN } from '../../../execute/index.js';
import { instantStake, instantStakeAndSend } from '../transactions/instant-stake.js';
import { releaseInstant, releaseInstantAndSend } from '../transactions/release-instant.js';
import { releaseLiquidStake, releaseLiquidStakeAndSend } from '../transactions/release-liquid-stake.js';
import { stake, stakeAndSend } from '../transactions/stake.js';
import { updateInstantWallet, updateInstantWalletAndSend } from '../transactions/update-instant-wallet.js';
import { updateWallet, updateWalletAndSend } from '../transactions/update-wallet.js';
import { STAKING_CONTRACT_NAME, STAKING_INSTANCE } from '../utils.js';

// ============================================================================
// SHARED CONSTANTS — Using Alice's test wallet
// ============================================================================

const { publicKey: ALICE_PUBLIC_KEY, privateKey: ALICE_PRIVATE_KEY } = ED25519_TEST_KEYS.alice;
const MOCK_WALLET_ADDRESS = 'Hg6QzYxK1AxfE7Y8PYLzCVwDXvobKiG9RhqQDdoi4gyf';

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
function assertStakingContract() {
  const lastCall = mockedCreate.mock.lastCall!;
  expect(lastCall[0]).toBe(STAKING_CONTRACT_NAME);
  expect(lastCall[1]).toBe(STAKING_INSTANCE);
  expect(lastCall[2]).toBe('execute');
}

// ============================================================================
// TESTS
// ============================================================================

describe('Kalvora Staking Transaction Builders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // stake
  // --------------------------------------------------------------------------

  describe('stake', () => {
    it('should build transaction with correct action name', async () => {
      await stake(
        { amount: '500000000000', walletAddress: MOCK_WALLET_ADDRESS, term: '6_months' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      assertStakingContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('stake');
    });

    it('should format parameters correctly', async () => {
      await stake(
        { amount: '500000000000', walletAddress: MOCK_WALLET_ADDRESS, term: '6_months' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      expect(paramString).toBe(`500000000000,${MOCK_WALLET_ADDRESS},6_months`);
    });

    it('should throw on missing amount', async () => {
      await expect(
        stake(
          { amount: '', walletAddress: MOCK_WALLET_ADDRESS, term: '6_months' },
          ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('amount is required');
    });

    it('should throw on missing walletAddress', async () => {
      await expect(
        stake(
          { amount: '500000000000', walletAddress: '', term: '6_months' },
          ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('walletAddress is required');
    });

    it('should throw on missing term', async () => {
      await expect(
        stake(
          { amount: '500000000000', walletAddress: MOCK_WALLET_ADDRESS, term: '' },
          ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('term is required');
    });

    it('should throw on missing publicKey', async () => {
      await expect(
        stake(
          { amount: '500000000000', walletAddress: MOCK_WALLET_ADDRESS, term: '6_months' },
          '', ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('publicKeyBase58Identifier is required');
    });

    it('stakeAndSend should build and send', async () => {
      const hash = await stakeAndSend(
        { amount: '500000000000', walletAddress: MOCK_WALLET_ADDRESS, term: '6_months' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      expect(mockedCreate).toHaveBeenCalledOnce();
      expect(mockedSend).toHaveBeenCalledOnce();
      expect(hash).toBe('mock-hash-abc123');
    });
  });

  // --------------------------------------------------------------------------
  // updateWallet
  // --------------------------------------------------------------------------

  describe('updateWallet', () => {
    it('should build transaction with correct action name', async () => {
      await updateWallet(
        { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '28' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      assertStakingContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('update_wallet');
    });

    it('should format parameters correctly', async () => {
      await updateWallet(
        { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '28' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      expect(paramString).toBe(`${MOCK_WALLET_ADDRESS},28`);
    });

    it('should throw on missing walletAddress', async () => {
      await expect(
        updateWallet(
          { walletAddress: '', bumpId: '28' },
          ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('walletAddress is required');
    });

    it('should throw on missing bumpId', async () => {
      await expect(
        updateWallet(
          { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '' },
          ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('bumpId is required');
    });

    it('updateWalletAndSend should build and send', async () => {
      const hash = await updateWalletAndSend(
        { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '28' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      expect(hash).toBe('mock-hash-abc123');
    });
  });

  // --------------------------------------------------------------------------
  // releaseLiquidStake
  // --------------------------------------------------------------------------

  describe('releaseLiquidStake', () => {
    it('should build transaction with correct action name', async () => {
      await releaseLiquidStake(ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY);

      assertStakingContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('release_liquid_stake');
    });

    it('should pass empty parameter string', async () => {
      await releaseLiquidStake(ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY);

      const { paramString } = getLastCallParams();
      expect(paramString).toBe('');
    });

    it('should throw on missing publicKey', async () => {
      await expect(
        releaseLiquidStake('', ALICE_PRIVATE_KEY)
      ).rejects.toThrow('publicKeyBase58Identifier is required');
    });

    it('releaseLiquidStakeAndSend should build and send', async () => {
      const hash = await releaseLiquidStakeAndSend(ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY);

      expect(mockedCreate).toHaveBeenCalledOnce();
      expect(mockedSend).toHaveBeenCalledOnce();
      expect(hash).toBe('mock-hash-abc123');
    });
  });

  // --------------------------------------------------------------------------
  // instantStake
  // --------------------------------------------------------------------------

  describe('instantStake', () => {
    it('should build transaction with correct action name', async () => {
      await instantStake(
        { amount: '500000000000', term: '6_months' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      assertStakingContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('instant_stake');
    });

    it('should format parameters correctly', async () => {
      await instantStake(
        { amount: '500000000000', term: '6_months' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      expect(paramString).toBe('500000000000,6_months');
    });

    it('should throw on missing amount', async () => {
      await expect(
        instantStake(
          { amount: '', term: '6_months' },
          ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('amount is required');
    });

    it('should throw on missing term', async () => {
      await expect(
        instantStake(
          { amount: '500000000000', term: '' },
          ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('term is required');
    });

    it('instantStakeAndSend should build and send', async () => {
      const hash = await instantStakeAndSend(
        { amount: '500000000000', term: '6_months' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      expect(hash).toBe('mock-hash-abc123');
    });
  });

  // --------------------------------------------------------------------------
  // releaseInstant
  // --------------------------------------------------------------------------

  describe('releaseInstant', () => {
    it('should build transaction with correct action name', async () => {
      await releaseInstant(ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY);

      assertStakingContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('release_instant');
    });

    it('should pass empty parameter string', async () => {
      await releaseInstant(ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY);

      const { paramString } = getLastCallParams();
      expect(paramString).toBe('');
    });

    it('should throw on missing publicKey', async () => {
      await expect(
        releaseInstant('', ALICE_PRIVATE_KEY)
      ).rejects.toThrow('publicKeyBase58Identifier is required');
    });

    it('releaseInstantAndSend should build and send', async () => {
      const hash = await releaseInstantAndSend(ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY);

      expect(hash).toBe('mock-hash-abc123');
    });
  });

  // --------------------------------------------------------------------------
  // updateInstantWallet
  // --------------------------------------------------------------------------

  describe('updateInstantWallet', () => {
    it('should build transaction with correct action name', async () => {
      await updateInstantWallet(
        { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '28' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      assertStakingContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('update_instant_wallet');
    });

    it('should format parameters correctly', async () => {
      await updateInstantWallet(
        { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '28' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      expect(paramString).toBe(`${MOCK_WALLET_ADDRESS},28`);
    });

    it('should throw on missing walletAddress', async () => {
      await expect(
        updateInstantWallet(
          { walletAddress: '', bumpId: '28' },
          ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('walletAddress is required');
    });

    it('should throw on missing bumpId', async () => {
      await expect(
        updateInstantWallet(
          { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '' },
          ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('bumpId is required');
    });

    it('updateInstantWalletAndSend should build and send', async () => {
      const hash = await updateInstantWalletAndSend(
        { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '28' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      expect(hash).toBe('mock-hash-abc123');
    });
  });

  // --------------------------------------------------------------------------
  // Cross-cutting concerns
  // --------------------------------------------------------------------------

  describe('Cross-cutting', () => {
    it('should pass custom feeId through options', async () => {
      await stake(
        { amount: '500000000000', walletAddress: MOCK_WALLET_ADDRESS, term: '6_months' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY,
        { feeId: 'LEET1337' }
      );

      const lastCall = mockedCreate.mock.lastCall!;
      const options = lastCall[6] as Record<string, unknown>;
      expect(options.feeId).toBe('LEET1337');
    });

    it('should pass grpcConfig through options', async () => {
      const customConfig = { host: 'custom.grpc.io', port: 50051 };
      await stake(
        { amount: '500000000000', walletAddress: MOCK_WALLET_ADDRESS, term: '6_months' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY,
        { grpcConfig: customConfig }
      );

      const lastCall = mockedCreate.mock.lastCall!;
      const options = lastCall[6] as Record<string, unknown>;
      expect(options.grpcConfig).toEqual(customConfig);
    });

    it('should always use two string parameters', async () => {
      await stake(
        { amount: '500000000000', walletAddress: MOCK_WALLET_ADDRESS, term: '6_months' },
        ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY
      );

      const lastCall = mockedCreate.mock.lastCall!;
      const parameters = lastCall[3] as Array<{ type: string; value: string }>;
      expect(parameters).toHaveLength(2);
      expect(parameters[0].type).toBe('string');
      expect(parameters[1].type).toBe('string');
    });
  });
});
