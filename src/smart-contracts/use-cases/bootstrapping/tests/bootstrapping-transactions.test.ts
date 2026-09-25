/**
 * Kalvora Bootstrapping Transaction Builder Tests
 *
 * Unit tests for the bootstrapping transaction builders. Mocks
 * `createSmartContractExecuteTXN` to verify correct action names,
 * parameter formatting, and validation without hitting the network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../execute/index.js', () => ({
  createSmartContractExecuteTXN: vi.fn().mockResolvedValue({ base: { hash: new Uint8Array([1, 2, 3]) } }),
  sendSmartContractExecuteTXN: vi.fn().mockResolvedValue('mock-hash-abc123'),
  ParamType: { STRING: 'string', BYTES: 'bytes', UINT32: 'uint32', UINT64: 'uint64' }
}));

import { ED25519_TEST_KEYS } from '../../../../test-utils/index.js';
import { createSmartContractExecuteTXN, sendSmartContractExecuteTXN } from '../../../execute/index.js';
import { processRewards, processRewardsAndSend } from '../transactions/process-rewards.js';
import { stake, stakeAndSend } from '../transactions/stake.js';
import { updateWallet, updateWalletAndSend } from '../transactions/update-wallet.js';
import {
  BOOTSTRAPPING_CONTRACT_NAME,
  BOOTSTRAPPING_INSTANCE,
  resolveBootstrappingAmount
} from '../utils.js';

// ============================================================================
// SHARED CONSTANTS — Using Alice's test wallet
// ============================================================================

const { publicKey: ALICE_PUBLIC_KEY, privateKey: ALICE_PRIVATE_KEY } = ED25519_TEST_KEYS.alice;
const MOCK_WALLET_ADDRESS = 'Hg6QzYxK1AxfE7Y8PYLzCVwDXvobKiG9RhqQDdog6Hyf';

const mockedCreate = vi.mocked(createSmartContractExecuteTXN);
const mockedSend = vi.mocked(sendSmartContractExecuteTXN);

// ============================================================================
// HELPER
// ============================================================================

function getLastCallParams(): { actionName: string; paramString: string } {
  const lastCall = mockedCreate.mock.lastCall!;
  const parameters = lastCall[3] as Array<{ value: string }>;
  return {
    actionName: parameters[0].value,
    paramString: parameters[1].value
  };
}

function assertBootstrappingContract() {
  const lastCall = mockedCreate.mock.lastCall!;
  expect(lastCall[0]).toBe(BOOTSTRAPPING_CONTRACT_NAME);
  expect(lastCall[1]).toBe(BOOTSTRAPPING_INSTANCE);
  expect(lastCall[2]).toBe('execute');
}

// ============================================================================
// TESTS
// ============================================================================

describe('Kalvora Bootstrapping Transaction Builders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('stake', () => {
    it('should build transaction with correct action name', async () => {
      await stake(
        { amount: '13183.5353144', term: '7_years', lpTokenId: 'dex-ZRA25sol-USDC0000000000' },
        ALICE_PUBLIC_KEY,
        ALICE_PRIVATE_KEY
      );

      assertBootstrappingContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('stake');
    });

    it('should format parameters correctly', async () => {
      await stake(
        { amount: '15000', term: '6_years', lpTokenId: 'solana-8miyE000000' },
        ALICE_PUBLIC_KEY,
        ALICE_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      expect(paramString).toBe('15000000000000,6_years,solana-8miyE000000');
    });

    it('should convert human-friendly decimal amounts to raw parts', async () => {
      await stake(
        { amount: '13183.5353144', term: '7_years', lpTokenId: 'dex-ZRA25sol-USDC0000000000' },
        ALICE_PUBLIC_KEY,
        ALICE_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      expect(paramString).toBe('13183535314400,7_years,dex-ZRA25sol-USDC0000000000');
    });

    it('should expose the raw amount conversion helper', () => {
      expect(resolveBootstrappingAmount('1.5', 'dex-ZRA25sol-USDC0000000000')).toBe('1500000000');
    });

    it('should throw on missing amount', async () => {
      await expect(
        stake(
          { amount: '', term: '6_years', lpTokenId: 'solana-8miyE000000' },
          ALICE_PUBLIC_KEY,
          ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('amount is required');
    });

    it('should throw on missing term', async () => {
      await expect(
        stake(
          { amount: '15000', term: '', lpTokenId: 'solana-8miyE000000' },
          ALICE_PUBLIC_KEY,
          ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('term is required');
    });

    it('should throw on missing lpTokenId', async () => {
      await expect(
        stake(
          { amount: '15000', term: '6_years', lpTokenId: '' },
          ALICE_PUBLIC_KEY,
          ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('lpTokenId is required');
    });

    it('stakeAndSend should build and send', async () => {
      const hash = await stakeAndSend(
        { amount: '15000', term: '6_years', lpTokenId: 'solana-8miyE000000' },
        ALICE_PUBLIC_KEY,
        ALICE_PRIVATE_KEY
      );

      expect(mockedCreate).toHaveBeenCalledOnce();
      expect(mockedSend).toHaveBeenCalledOnce();
      expect(hash).toBe('mock-hash-abc123');
    });
  });

  describe('updateWallet', () => {
    it('should build transaction with correct action name', async () => {
      await updateWallet(
        { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '1' },
        ALICE_PUBLIC_KEY,
        ALICE_PRIVATE_KEY
      );

      assertBootstrappingContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('update_wallet');
    });

    it('should format parameters correctly', async () => {
      await updateWallet(
        { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '1' },
        ALICE_PUBLIC_KEY,
        ALICE_PRIVATE_KEY
      );

      const { paramString } = getLastCallParams();
      expect(paramString).toBe(`${MOCK_WALLET_ADDRESS},1`);
    });

    it('should throw on missing walletAddress', async () => {
      await expect(
        updateWallet(
          { walletAddress: '', bumpId: '1' },
          ALICE_PUBLIC_KEY,
          ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('walletAddress is required');
    });

    it('should throw on missing bumpId', async () => {
      await expect(
        updateWallet(
          { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '' },
          ALICE_PUBLIC_KEY,
          ALICE_PRIVATE_KEY
        )
      ).rejects.toThrow('bumpId is required');
    });

    it('updateWalletAndSend should build and send', async () => {
      const hash = await updateWalletAndSend(
        { walletAddress: MOCK_WALLET_ADDRESS, bumpId: '1' },
        ALICE_PUBLIC_KEY,
        ALICE_PRIVATE_KEY
      );

      expect(mockedCreate).toHaveBeenCalledOnce();
      expect(mockedSend).toHaveBeenCalledOnce();
      expect(hash).toBe('mock-hash-abc123');
    });
  });

  describe('processRewards', () => {
    it('should build transaction with correct action name', async () => {
      await processRewards(ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY);

      assertBootstrappingContract();
      const { actionName } = getLastCallParams();
      expect(actionName).toBe('process_rewards');
    });

    it('should pass an empty parameter string', async () => {
      await processRewards(ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY);

      const { paramString } = getLastCallParams();
      expect(paramString).toBe('');
    });

    it('should throw on missing publicKey', async () => {
      await expect(
        processRewards('', ALICE_PRIVATE_KEY)
      ).rejects.toThrow('publicKeyBase58Identifier is required');
    });

    it('should throw on missing privateKey', async () => {
      await expect(
        processRewards(ALICE_PUBLIC_KEY, '')
      ).rejects.toThrow('privateKeyBase58 is required');
    });

    it('processRewardsAndSend should build and send', async () => {
      const hash = await processRewardsAndSend(ALICE_PUBLIC_KEY, ALICE_PRIVATE_KEY);

      expect(mockedCreate).toHaveBeenCalledOnce();
      expect(mockedSend).toHaveBeenCalledOnce();
      expect(hash).toBe('mock-hash-abc123');
    });
  });
});
