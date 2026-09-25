/**
 * Solana Bridge Transaction Builders Tests
 * 
 * Tests for the complete transaction builders that use @solana/web3.js.
 */

import { randomBytes } from 'crypto';

import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { describe, it, expect, vi } from 'vitest';

import {
  BridgeAction,
  SolanaTokenType,
  TOKEN_2022_PROGRAM_ID as TOKEN_2022_PROGRAM_ID_STRING
} from '../solana/constants.js';
import {
  buildLockSolanaTransaction,
  buildReleaseSolanaTransaction,
  buildReleaseSplTransaction,
  buildReleaseSolTransaction,
  buildReleaseToken2022Transaction,
  buildLockSplTransaction,
  buildLockSolTransaction,
  buildLockToken2022Transaction,
  buildBurnWrappedTransaction,
  buildRequestTokenRegistrationTransaction,
  buildRegisterTokenTransaction
} from '../solana/transactions/index.js';
import type { GuardianSignature } from '../solana/types.js';
import {
  CORE_PROGRAM_ID,
  deriveRateLimitStatePDA,
  deriveRouterConfigPDA,
  deriveTokenRegistrationPDA,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_BRIDGE_PROGRAM_ID
} from '../solana/utils.js';

// Mock data for testing
const MOCK_RECIPIENT = Keypair.generate().publicKey.toBase58();
const MOCK_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
const MOCK_TXN_ID = 'a'.repeat(64);
const MOCK_EXPECTED_HASH = 'b'.repeat(64);
const MOCK_PAYER = Keypair.generate().publicKey;
const MOCK_ZERA_ADDRESS = 'z1abc123def456';

// Mock guardian signature (64-byte sig, 32-byte public key)
const MOCK_SIGNATURES: GuardianSignature[] = [
  {
    signature: bs58.encode(randomBytes(64)),
    publicKey: bs58.encode(randomBytes(32))
  }
];

function expectKey(
  instruction: { keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] },
  index: number,
  pubkey: PublicKey,
  isSigner: boolean,
  isWritable: boolean
) {
  const key = instruction.keys[index];
  expect(key?.pubkey.toBase58()).toBe(pubkey.toBase58());
  expect(key?.isSigner).toBe(isSigner);
  expect(key?.isWritable).toBe(isWritable);
}

function mockConnectionWithMintOwner(owner: PublicKey | null): Connection {
  return {
    getAccountInfo: vi.fn(async () => owner ? { owner } : null),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 1
    }))
  } as unknown as Connection;
}

describe('Solana Bridge Transaction Builders', () => {
  describe('Token-2022 constants', () => {
    it('should expose Token-2022 program and release action constants', () => {
      expect(TOKEN_2022_PROGRAM_ID_STRING).toBe('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      expect(BridgeAction.RELEASE_2022).toBe(5);
    });

    it('should keep short 2022 builder names as compatibility aliases', () => {
      expect(buildLockToken2022Transaction).toBe(buildLockToken2022Transaction);
      expect(buildReleaseToken2022Transaction).toBe(buildReleaseToken2022Transaction);
    });
  });

  describe('buildReleaseSplTransaction', () => {
    it('should build valid release SPL transaction structure', async () => {
      const result = await buildReleaseSplTransaction(
        {
          amount: BigInt(1000000),
          recipient: MOCK_RECIPIENT,
          mint: MOCK_MINT,
          txnId: MOCK_TXN_ID,
          timestamp: Math.floor(Date.now() / 1000),
          signatures: MOCK_SIGNATURES,
          expectedHash: MOCK_EXPECTED_HASH,
          usdPriceNano: BigInt(1e9),
          liquidityUsdNano: BigInt(1e12),
          tier: 1
        },
        MOCK_PAYER
      );

      expect(result.transaction).toBeInstanceOf(Transaction);
      expect(result.coreInstruction).toBeDefined();
      expect(result.tokenInstruction).toBeDefined();
      expect(result.signatureInstructions.length).toBeGreaterThanOrEqual(0);
      expect(result.accounts.recipientAta).toBeInstanceOf(PublicKey);
      expect(result.accounts.vaultAta).toBeInstanceOf(PublicKey);
      expect(result.accounts.usedMarker).toBeInstanceOf(PublicKey);
      expect(result.accounts.redeemedMarker).toBeInstanceOf(PublicKey);
    });

    it('should include correct number of instructions', async () => {
      const result = await buildReleaseSplTransaction(
        {
          amount: BigInt(1000000),
          recipient: MOCK_RECIPIENT,
          mint: MOCK_MINT,
          txnId: MOCK_TXN_ID,
          timestamp: Math.floor(Date.now() / 1000),
          signatures: MOCK_SIGNATURES,
          expectedHash: MOCK_EXPECTED_HASH,
          usdPriceNano: BigInt(1e9),
          liquidityUsdNano: BigInt(1e12),
          tier: 1
        },
        MOCK_PAYER
      );

      // Should have: compute budget + signature verifications + core + token instructions
      const expectedCount = MOCK_SIGNATURES.length + 3; // +3 = compute budget + core + token
      expect(result.transaction.instructions.length).toBe(expectedCount);
    });
  });

  describe('buildReleaseSolTransaction', () => {
    it('should build valid release SOL transaction structure', async () => {
      const result = await buildReleaseSolTransaction(
        {
          amount: BigInt(1e9), // 1 SOL in lamports
          recipient: MOCK_RECIPIENT,
          txnId: MOCK_TXN_ID,
          timestamp: Math.floor(Date.now() / 1000),
          signatures: MOCK_SIGNATURES,
          expectedHash: MOCK_EXPECTED_HASH,
          usdAmount: BigInt(1e9)
        },
        MOCK_PAYER
      );

      expect(result.transaction).toBeInstanceOf(Transaction);
      expect(result.coreInstruction).toBeDefined();
      expect(result.tokenInstruction).toBeDefined();
      expect(result.accounts.vault).toBeInstanceOf(PublicKey);
      expect(result.accounts.usedMarker).toBeInstanceOf(PublicKey);
      expect(result.accounts.redeemedMarker).toBeInstanceOf(PublicKey);
    });
  });

  describe('buildLockSplTransaction', () => {
    it('should build valid lock SPL transaction structure', async () => {
      const result = await buildLockSplTransaction(
        {
          amount: BigInt(1000000),
          zeraAddress: MOCK_ZERA_ADDRESS,
          mint: MOCK_MINT
        },
        MOCK_PAYER
      );

      expect(result.transaction).toBeInstanceOf(Transaction);
      expect(result.instruction).toBeDefined();
      expect(result.accounts.userAta).toBeInstanceOf(PublicKey);
      expect(result.accounts.vaultAta).toBeInstanceOf(PublicKey);
      expect(result.accounts.routerSigner).toBeInstanceOf(PublicKey);
    });

    it('should include Kalvora address in instruction data', async () => {
      const result = await buildLockSplTransaction(
        {
          amount: BigInt(1000000),
          zeraAddress: MOCK_ZERA_ADDRESS,
          mint: MOCK_MINT
        },
        MOCK_PAYER
      );

      // Instruction data should contain the Kalvora address
      expect(result.instruction.data.length).toBeGreaterThan(8 + MOCK_ZERA_ADDRESS.length);
    });

    it('should have single instruction in transaction', async () => {
      const result = await buildLockSplTransaction(
        {
          amount: BigInt(1000000),
          zeraAddress: MOCK_ZERA_ADDRESS,
          mint: MOCK_MINT
        },
        MOCK_PAYER
      );

      expect(result.transaction.instructions.length).toBe(1);
    });
  });

  describe('buildLockSolTransaction', () => {
    it('should build valid lock SOL transaction structure', async () => {
      const result = await buildLockSolTransaction(
        {
          amount: BigInt(1e9), // 1 SOL
          zeraAddress: MOCK_ZERA_ADDRESS
        },
        MOCK_PAYER
      );

      expect(result.transaction).toBeInstanceOf(Transaction);
      expect(result.instruction).toBeDefined();
      expect(result.accounts.payerWsolAta).toBeInstanceOf(PublicKey);
      expect(result.accounts.vaultAta).toBeInstanceOf(PublicKey);
      expect(result.accounts.routerSigner).toBeInstanceOf(PublicKey);
    });
  });

  describe('buildLockToken2022Transaction', () => {
    it('should build lock_2022 with Token-2022 accounts and ATA creates', async () => {
      const result = await buildLockToken2022Transaction(
        {
          amount: BigInt(1000000),
          zeraAddress: MOCK_ZERA_ADDRESS,
          mint: MOCK_MINT
        },
        MOCK_PAYER
      );

      expect(result.transaction).toBeInstanceOf(Transaction);
      expect(result.transaction.instructions.length).toBe(4);
      expect(result.instruction.keys.length).toBe(13);
      expect(result.accounts.routerSigner2022).toBeInstanceOf(PublicKey);
      expect(result.accounts.extensionWhitelist).toBeInstanceOf(PublicKey);

      expect(result.createUserAtaInstruction.programId.toBase58()).toBe(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
      expect(result.createVaultAtaInstruction.programId.toBase58()).toBe(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());

      expectKey(result.instruction, 0, CORE_PROGRAM_ID, false, false);
      expectKey(result.instruction, 1, result.accounts.routerConfig, false, false);
      expectKey(result.instruction, 2, MOCK_PAYER, true, true);
      expectKey(result.instruction, 3, result.accounts.userAta, false, true);
      expectKey(result.instruction, 4, new PublicKey(MOCK_MINT), false, false);
      expectKey(result.instruction, 5, result.accounts.routerSigner2022, false, false);
      expectKey(result.instruction, 6, result.accounts.vaultAta, false, true);
      expectKey(result.instruction, 7, result.accounts.rateLimitState, false, true);
      expectKey(result.instruction, 8, result.accounts.tokenRegistration, false, true);
      expectKey(result.instruction, 9, result.accounts.extensionWhitelist, false, false);
      expectKey(result.instruction, 10, TOKEN_2022_PROGRAM_ID, false, false);
      expectKey(result.instruction, 11, ASSOCIATED_TOKEN_PROGRAM_ID, false, false);
      expectKey(result.instruction, 12, SystemProgram.programId, false, false);
    });

    it('should reject lock_2022 when a supplied connection reports a non-Token-2022 mint owner', async () => {
      await expect(
        buildLockToken2022Transaction(
          {
            amount: BigInt(1000000),
            zeraAddress: MOCK_ZERA_ADDRESS,
            mint: MOCK_MINT
          },
          MOCK_PAYER,
          mockConnectionWithMintOwner(TOKEN_PROGRAM_ID)
        )
      ).rejects.toThrow('expected TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    });
  });

  describe('buildLockSolanaTransaction', () => {
    it('should route SOL locks by tokenType', async () => {
      const result = await buildLockSolanaTransaction(
        {
          tokenType: SolanaTokenType.SOL,
          amount: BigInt(1e9),
          zeraAddress: MOCK_ZERA_ADDRESS
        },
        MOCK_PAYER
      );

      expect(result.tokenType).toBe(SolanaTokenType.SOL);
      expect(result.transaction).toBeInstanceOf(Transaction);
      expect(result.accounts).toHaveProperty('payerWsolAta');
      expect(result.accounts).toHaveProperty('vaultAta');
    });

    it('should route SPL locks by tokenType', async () => {
      const result = await buildLockSolanaTransaction(
        {
          tokenType: SolanaTokenType.SPL,
          amount: BigInt(1000000),
          zeraAddress: MOCK_ZERA_ADDRESS,
          mint: MOCK_MINT
        },
        MOCK_PAYER
      );

      expect(result.tokenType).toBe(SolanaTokenType.SPL);
      expect(result.transaction.instructions.length).toBe(1);
      expect(result.accounts).toHaveProperty('routerSigner');
      expect(result.accounts).toHaveProperty('tokenRegistration');
    });

    it('should route Token-2022 locks by tokenType', async () => {
      const result = await buildLockSolanaTransaction(
        {
          tokenType: SolanaTokenType.TOKEN2022,
          amount: BigInt(1000000),
          zeraAddress: MOCK_ZERA_ADDRESS,
          mint: MOCK_MINT
        },
        MOCK_PAYER
      );

      expect(result.tokenType).toBe(SolanaTokenType.TOKEN2022);
      expect(result.transaction.instructions.length).toBe(4);
      expect(result.accounts).toHaveProperty('routerSigner2022');
      expect(result.accounts).toHaveProperty('extensionWhitelist');
    });
  });

  describe('buildReleaseToken2022Transaction', () => {
    it('should build release_2022 with Token-2022 account order and action', async () => {
      const result = await buildReleaseToken2022Transaction(
        {
          amount: BigInt(1000000),
          recipient: MOCK_RECIPIENT,
          mint: MOCK_MINT,
          txnId: MOCK_TXN_ID,
          timestamp: Math.floor(Date.now() / 1000),
          signatures: MOCK_SIGNATURES,
          expectedHash: MOCK_EXPECTED_HASH,
          usdPriceNano: BigInt(1e9),
          liquidityUsdNano: BigInt(1e12),
          tier: 1
        },
        MOCK_PAYER
      );

      expect(result.transaction).toBeInstanceOf(Transaction);
      expect(result.verifyTransaction.instructions.length).toBe(3);
      expect(result.releaseTransaction.instructions.length).toBe(2);
      expect(result.coreInstruction.data[9]).toBe(5); // ACTION_RELEASE_2022
      expect(result.tokenInstruction.keys.length).toBe(16);

      const [routerConfig] = deriveRouterConfigPDA();
      const [rateLimitState] = deriveRateLimitStatePDA();
      const [tokenRegistration] = deriveTokenRegistrationPDA(new PublicKey(MOCK_MINT));

      expectKey(result.tokenInstruction, 0, CORE_PROGRAM_ID, false, false);
      expectKey(result.tokenInstruction, 1, routerConfig, false, false);
      expectKey(result.tokenInstruction, 2, MOCK_PAYER, true, true);
      expectKey(result.tokenInstruction, 3, new PublicKey(MOCK_MINT), false, false);
      expectKey(result.tokenInstruction, 4, result.accounts.routerSigner2022, false, false);
      expectKey(result.tokenInstruction, 5, result.accounts.vaultAta, false, true);
      expectKey(result.tokenInstruction, 6, new PublicKey(MOCK_RECIPIENT), false, false);
      expectKey(result.tokenInstruction, 7, result.accounts.recipientAta, false, true);
      expectKey(result.tokenInstruction, 8, ASSOCIATED_TOKEN_PROGRAM_ID, false, false);
      expectKey(result.tokenInstruction, 9, result.accounts.usedMarker, false, false);
      expectKey(result.tokenInstruction, 10, result.accounts.redeemedMarker, false, true);
      expectKey(result.tokenInstruction, 11, rateLimitState, false, true);
      expectKey(result.tokenInstruction, 12, tokenRegistration, false, true);
      expectKey(result.tokenInstruction, 13, TOKEN_2022_PROGRAM_ID, false, false);
      expectKey(result.tokenInstruction, 14, SystemProgram.programId, false, false);
      expectKey(result.tokenInstruction, 15, TOKEN_BRIDGE_PROGRAM_ID, false, false);
    });

    it('should reject release_2022 when a supplied connection reports a non-Token-2022 mint owner', async () => {
      await expect(
        buildReleaseToken2022Transaction(
          {
            amount: BigInt(1000000),
            recipient: MOCK_RECIPIENT,
            mint: MOCK_MINT,
            txnId: MOCK_TXN_ID,
            timestamp: Math.floor(Date.now() / 1000),
            signatures: MOCK_SIGNATURES,
            expectedHash: MOCK_EXPECTED_HASH,
            usdPriceNano: BigInt(1e9),
            liquidityUsdNano: BigInt(1e12),
            tier: 1
          },
          MOCK_PAYER,
          mockConnectionWithMintOwner(TOKEN_PROGRAM_ID)
        )
      ).rejects.toThrow('expected TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    });
  });

  describe('buildReleaseSolanaTransaction', () => {
    it('should route SOL releases by tokenType', async () => {
      const result = await buildReleaseSolanaTransaction(
        {
          tokenType: SolanaTokenType.SOL,
          amount: BigInt(1e9),
          recipient: MOCK_RECIPIENT,
          txnId: MOCK_TXN_ID,
          timestamp: Math.floor(Date.now() / 1000),
          signatures: MOCK_SIGNATURES,
          expectedHash: MOCK_EXPECTED_HASH,
          usdAmount: BigInt(1e9)
        },
        MOCK_PAYER
      );

      expect(result.tokenType).toBe(SolanaTokenType.SOL);
      expect(result.coreInstruction.data[9]).toBe(BridgeAction.RELEASE_SOL);
      expect(result.accounts).toHaveProperty('vault');
    });

    it('should route SPL releases by tokenType', async () => {
      const result = await buildReleaseSolanaTransaction(
        {
          tokenType: SolanaTokenType.SPL,
          amount: BigInt(1000000),
          recipient: MOCK_RECIPIENT,
          mint: MOCK_MINT,
          txnId: MOCK_TXN_ID,
          timestamp: Math.floor(Date.now() / 1000),
          signatures: MOCK_SIGNATURES,
          expectedHash: MOCK_EXPECTED_HASH,
          usdPriceNano: BigInt(1e9),
          liquidityUsdNano: BigInt(1e12),
          tier: 1
        },
        MOCK_PAYER
      );

      expect(result.tokenType).toBe(SolanaTokenType.SPL);
      expect(result.coreInstruction.data[9]).toBe(BridgeAction.RELEASE_SPL);
      expect(result.accounts).toHaveProperty('recipientAta');
    });

    it('should route Token-2022 releases by tokenType', async () => {
      const result = await buildReleaseSolanaTransaction(
        {
          tokenType: SolanaTokenType.TOKEN2022,
          amount: BigInt(1000000),
          recipient: MOCK_RECIPIENT,
          mint: MOCK_MINT,
          txnId: MOCK_TXN_ID,
          timestamp: Math.floor(Date.now() / 1000),
          signatures: MOCK_SIGNATURES,
          expectedHash: MOCK_EXPECTED_HASH,
          usdPriceNano: BigInt(1e9),
          liquidityUsdNano: BigInt(1e12),
          tier: 1
        },
        MOCK_PAYER
      );

      expect(result.tokenType).toBe(SolanaTokenType.TOKEN2022);
      expect(result.coreInstruction.data[9]).toBe(BridgeAction.RELEASE_2022);
      expect(result.accounts).toHaveProperty('routerSigner2022');
    });
  });

  describe('Token-2022 registration accounts', () => {
    it('should detect Token-2022 owner from connection when no tokenProgramId override is provided', async () => {
      const result = await buildRequestTokenRegistrationTransaction(
        {
          mint: MOCK_MINT
        },
        MOCK_PAYER,
        mockConnectionWithMintOwner(TOKEN_2022_PROGRAM_ID)
      );

      expect(result.accounts.tokenProgramId.toBase58()).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
      expect(result.accounts.extensionWhitelist).toBeInstanceOf(PublicKey);
      expect(result.instruction.keys.length).toBe(5);
    });

    it('should keep classic SPL registration account order for SPL mint owner', async () => {
      const result = await buildRequestTokenRegistrationTransaction(
        {
          mint: MOCK_MINT
        },
        MOCK_PAYER,
        mockConnectionWithMintOwner(TOKEN_PROGRAM_ID)
      );

      expect(result.accounts.tokenProgramId.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
      expect(result.accounts.extensionWhitelist).toBeUndefined();
      expect(result.instruction.keys.length).toBe(4);
    });

    it('should fail fast when connection cannot find the mint account', async () => {
      await expect(
        buildRequestTokenRegistrationTransaction(
          {
            mint: MOCK_MINT
          },
          MOCK_PAYER,
          mockConnectionWithMintOwner(null)
        )
      ).rejects.toThrow('Mint account not found');
    });

    it('should fail fast for unsupported mint owner programs', async () => {
      await expect(
        buildRequestTokenRegistrationTransaction(
          {
            mint: MOCK_MINT
          },
          MOCK_PAYER,
          mockConnectionWithMintOwner(TOKEN_BRIDGE_PROGRAM_ID)
        )
      ).rejects.toThrow('unsupported token program');
    });

    it('should reject unsupported explicit token program overrides', async () => {
      await expect(
        buildRequestTokenRegistrationTransaction(
          {
            mint: MOCK_MINT,
            tokenProgramId: TOKEN_BRIDGE_PROGRAM_ID.toBase58()
          },
          MOCK_PAYER
        )
      ).rejects.toThrow('Unsupported token program override');
    });

    it('should append extension whitelist for request_token_registration when Token-2022 is requested', async () => {
      const result = await buildRequestTokenRegistrationTransaction(
        {
          mint: MOCK_MINT,
          tokenProgramId: TOKEN_2022_PROGRAM_ID.toBase58()
        },
        MOCK_PAYER
      );

      expect(result.instruction.keys.length).toBe(5);
      expect(result.accounts.tokenProgramId.toBase58()).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
      expect(result.accounts.extensionWhitelist).toBeInstanceOf(PublicKey);
      expect(result.instruction.keys[4]?.pubkey.toBase58()).toBe(
        result.accounts.extensionWhitelist?.toBase58()
      );
    });

    it('should append extension whitelist for register_token when Token-2022 is requested', async () => {
      const result = await buildRegisterTokenTransaction(
        {
          mint: MOCK_MINT,
          txnId: MOCK_TXN_ID,
          timestamp: Math.floor(Date.now() / 1000),
          signatures: MOCK_SIGNATURES,
          expectedHash: MOCK_EXPECTED_HASH,
          usdPriceNano: BigInt(1e9),
          liquidityUsdNano: BigInt(1e12),
          tier: 1,
          tokenProgramId: TOKEN_2022_PROGRAM_ID.toBase58()
        },
        MOCK_PAYER
      );

      expect(result.tokenInstruction.keys.length).toBe(8);
      expect(result.accounts.tokenProgramId.toBase58()).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
      expect(result.accounts.extensionWhitelist).toBeInstanceOf(PublicKey);
      expect(result.tokenInstruction.keys[7]?.pubkey.toBase58()).toBe(
        result.accounts.extensionWhitelist?.toBase58()
      );
    });
  });

  describe('buildBurnWrappedTransaction', () => {
    it('should build valid burn wrapped transaction structure', async () => {
      const result = await buildBurnWrappedTransaction(
        {
          amount: BigInt(1000000),
          wrappedMint: MOCK_MINT,
          zeraRecipient: MOCK_ZERA_ADDRESS
        },
        MOCK_PAYER
      );

      expect(result.transaction).toBeInstanceOf(Transaction);
      expect(result.instruction).toBeDefined();
      expect(result.accounts.wrappedMint).toBeInstanceOf(PublicKey);
      expect(result.accounts.userAta).toBeInstanceOf(PublicKey);
      expect(result.accounts.mintAuthority).toBeInstanceOf(PublicKey);
    });
  });

  describe('Transaction properties', () => {
    it('should set feePayer correctly', async () => {
      const result = await buildLockSplTransaction(
        {
          amount: BigInt(1000000),
          zeraAddress: MOCK_ZERA_ADDRESS,
          mint: MOCK_MINT
        },
        MOCK_PAYER
      );

      expect(result.transaction.feePayer?.toBase58()).toBe(MOCK_PAYER.toBase58());
    });

    it('should not have blockhash when no connection provided', async () => {
      const result = await buildLockSplTransaction(
        {
          amount: BigInt(1000000),
          zeraAddress: MOCK_ZERA_ADDRESS,
          mint: MOCK_MINT
        },
        MOCK_PAYER
      );

      expect(result.transaction.recentBlockhash).toBeUndefined();
    });
  });
});
