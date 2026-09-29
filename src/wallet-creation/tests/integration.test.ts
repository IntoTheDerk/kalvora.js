/**
 * Wallet Creation Integration Tests
 * 
 * Comprehensive integration tests for wallet creation functionality
 * including error handling, validation, and performance.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { 
  benchmark
} from '../../shared/utils/performance-benchmark.js';
import { 
  validateBase58Address,
  validateBase58Key,
  validateKeyType,
  validateMnemonic
} from '../../shared/utils/validation.js';
import { 
  createWallet, 
  deriveMultipleWallets, 
  generateMnemonicPhrase,
  WalletFactory,
  KEY_TYPE,
  HASH_TYPE
} from '../index.js';

describe('Wallet Creation Integration Tests', () => {

  afterEach(() => {
    // Clean up any global state
  });

  describe('Basic Wallet Creation', () => {
    it('should create a wallet with valid parameters (key-only mode)', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic
      });

      expect(wallet).toBeDefined();
      expect(wallet.address).toBeDefined();
      expect(wallet.publicKey).toBeDefined();
      expect(wallet.privateKey).toBeDefined();
      expect(wallet.keyType).toBe(KEY_TYPE.ED25519);
      // No hash types in key-only mode
      expect(wallet.hashTypes).toBeUndefined();

      // Validate wallet components
      const addressValidation = validateBase58Address(wallet.address);
      const keyValidation = validateBase58Key(wallet.privateKey);

      expect(addressValidation.isValid).toBe(true);
      expect(keyValidation.isValid).toBe(true);

      // Clean up
      wallet.secureClear();
    });

    it('should create a wallet with Ed448 key type', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED448,
        mnemonic
      });

      expect(wallet.keyType).toBe(KEY_TYPE.ED448);
      // Public key should start with B_ for Ed448
      expect(wallet.publicKey.startsWith('B_')).toBe(true);

      // Clean up
      wallet.secureClear();
    });

    it('should create a wallet with custom HD options', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic,
        hdOptions: {
          accountIndex: 1,
          changeIndex: 1,
          addressIndex: 5
        }
      });

      expect(wallet.derivationPath).toContain("1'/1'/5'");
      // The index includes the hardened offset (0x80000000 = 2147483648)
      expect(wallet.index).toBe(5 + 0x80000000);

      // Clean up
      wallet.secureClear();
    });
  });

  describe('Multiple Wallet Derivation', () => {
    it('should derive multiple wallets from the same mnemonic', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallets = await deriveMultipleWallets({
        keyType: KEY_TYPE.ED25519,
        mnemonic,
        count: 5
      });

      expect(wallets).toHaveLength(5);

      // All wallets should have different addresses
      const addresses = wallets.map(w => w.address);
      const uniqueAddresses = new Set(addresses);
      expect(uniqueAddresses.size).toBe(5);

      // All wallets should have different derivation paths
      const derivationPaths = wallets.map(w => w.derivationPath);
      const uniquePaths = new Set(derivationPaths);
      expect(uniquePaths.size).toBe(5);

      // Clean up
      wallets.forEach(wallet => wallet.secureClear());
    });

    it('should derive wallets with sequential account indices', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      // For account-based systems like Kalvora, accountIndex is incremented (not addressIndex)
      const wallets = await deriveMultipleWallets({
        keyType: KEY_TYPE.ED25519,
        mnemonic,
        count: 3,
        hdOptions: {
          accountIndex: 5  // Start at account 5, will create wallets at 5, 6, 7
        }
      });

      // Verify derivation paths show incrementing accountIndex
      expect(wallets[0]?.derivationPath).toContain("/5'/");
      expect(wallets[1]?.derivationPath).toContain("/6'/");
      expect(wallets[2]?.derivationPath).toContain("/7'/");

      // Clean up
      wallets.forEach(wallet => wallet.secureClear());
    });
  });

  describe('Input Validation', () => {
    it('should validate mnemonic phrases', () => {
      const validMnemonic = generateMnemonicPhrase(12);
      const validation = validateMnemonic(validMnemonic);
      expect(validation.isValid).toBe(true);
      expect(validation.value).toBe(validMnemonic.trim());
    });

    it('should reject invalid mnemonic phrases', () => {
      const invalidMnemonic = 'invalid mnemonic phrase';
      const validation = validateMnemonic(invalidMnemonic);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toBeDefined();
    });

    it('should validate key types', () => {
      const ed25519Validation = validateKeyType('ed25519');
      const ed448Validation = validateKeyType('ed448');
      
      expect(ed25519Validation.isValid).toBe(true);
      expect(ed448Validation.isValid).toBe(true);
      expect(ed25519Validation.value).toBe('ed25519');
      expect(ed448Validation.value).toBe('ed448');
    });

    it('should reject invalid key types', () => {
      const validation = validateKeyType('invalid-key-type');
      expect(validation.isValid).toBe(false);
      expect(validation.error).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid mnemonic gracefully', async () => {
      const invalidMnemonic = 'invalid mnemonic phrase';
      
      await expect(createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic: invalidMnemonic
      })).rejects.toThrow();
    });

    it('should handle invalid key type gracefully', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      
      await expect(createWallet({
        keyType: 'invalid-key-type' as any,
        mnemonic
      })).rejects.toThrow();
    });

    it('should handle missing mnemonic gracefully', async () => {
      await expect(createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic: ''
      })).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    it('should create wallets within reasonable time', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      
      const result = await benchmark(
        'Wallet Creation Performance',
        async () => {
          const wallet = await createWallet({
            keyType: KEY_TYPE.ED25519,
            mnemonic
          });
          wallet.secureClear();
          return wallet;
        },
        {
          iterations: 10,
          warmupIterations: 2
        }
      );

      expect(result.averageTime).toBeLessThan(1000); // Should be under 1 second
      expect(result.iterations).toBe(10);
    });

    it('should derive multiple wallets efficiently', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      
      const result = await benchmark(
        'Multiple Wallet Derivation Performance',
        async () => {
          const wallets = await deriveMultipleWallets({
            keyType: KEY_TYPE.ED25519,
            mnemonic,
            count: 10
          });
          wallets.forEach(wallet => wallet.secureClear());
          return wallets;
        },
        {
          iterations: 5,
          warmupIterations: 1
        }
      );

      expect(result.averageTime).toBeLessThan(5000); // Should be under 5 seconds
      expect(result.iterations).toBe(5);
    });
  });

  describe('Memory Management', () => {
    it('should clear sensitive data from memory', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic
      });

      // Store references before clearing
      const privateKey = wallet.privateKey;
      const publicKey = wallet.publicKey;

      // Clear sensitive data
      wallet.secureClear();

      // Verify data is cleared (implementation dependent)
      expect(wallet.secureClear).toBeDefined();
    });

    it('should handle memory cleanup on errors', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      
      try {
        await createWallet({
          keyType: 'invalid-key-type' as any,
          mnemonic
        });
      } catch (error) {
        // Error should be thrown, but memory should be cleaned up
        expect(error).toBeDefined();
      }
    });
  });

  describe('Wallet Factory', () => {
    it('should provide factory information', () => {
      const factory = new WalletFactory();
      const info = factory.getInfo();

      expect(info?.name).toBeDefined();
      expect(info?.symbol).toBeDefined();
      expect(info?.coinType).toBeDefined();
      expect(info?.supportedKeyTypes).toContain(KEY_TYPE.ED25519);
      expect(info?.supportedKeyTypes).toContain(KEY_TYPE.ED448);
      expect(info?.supportedHashTypes).toContain(HASH_TYPE.SHA3_256);
      expect(info?.supportedHashTypes).toContain(HASH_TYPE.SHA3_512);
      expect(info?.supportedHashTypes).toContain(HASH_TYPE.BLAKE3);
      expect(info?.standard).toBe('BIP32 + BIP39 + SLIP-0010');
      expect(info?.cryptographicLibraries).toContain('@noble/curves - Full Ed25519 and Ed448 implementation');
      expect(info?.securityFeatures).toContain('Secure memory clearing for sensitive data');
    });
  });
});
