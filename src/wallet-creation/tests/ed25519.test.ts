import { describe, it, expect } from 'vitest';

import {
  createWallet,
  deriveMultipleWallets,
  generateMnemonicPhrase,
  KEY_TYPE
} from '../index.js';

describe('Ed25519 Implementation', () => {
  describe('Basic Ed25519 wallet creation', () => {
    it('should create a valid Ed25519 wallet', async () => {
      const words = generateMnemonicPhrase(12);
      
      const ed25519Wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic: words
      });
      
      expect(ed25519Wallet.keyType).toBe('ed25519');
      expect(typeof ed25519Wallet.address).toBe('string');
      expect(typeof ed25519Wallet.derivationPath).toBe('string');
      expect(ed25519Wallet.address).toBeTruthy();
      expect(ed25519Wallet.derivationPath).toBeTruthy();
      // New format: public key should start with A_ (no hash prefix)
      expect(ed25519Wallet.publicKey.startsWith('A_')).toBe(true);
      // Address should equal the base58 public key (no hashing)
      const base58Part = ed25519Wallet.publicKey.substring(2); // Remove "A_"
      expect(ed25519Wallet.address).toBe(base58Part);
    });

    it('should create wallets without hash types (key-only mode)', async () => {
      const words = generateMnemonicPhrase(12);
      
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic: words
      });
      
      expect(typeof wallet.address).toBe('string');
      expect(wallet.address).toBeTruthy();
      // No hash types in key-only mode
      expect(wallet.hashTypes).toBeUndefined();
    });
  });

  describe('HD wallet derivation', () => {
    it('should derive multiple Ed25519 addresses from same mnemonic', async () => {
      const words = generateMnemonicPhrase(12);
      
      const multipleWallets = await deriveMultipleWallets({
        mnemonic: words,
        keyType: KEY_TYPE.ED25519,
        count: 3,
        hdOptions: {
          accountIndex: 0,
          changeIndex: 0,
          addressIndex: 0
        }
      });
      
      expect(Array.isArray(multipleWallets)).toBe(true);
      expect(multipleWallets.length).toBe(3);
      
      // Verify all addresses are unique
      const uniqueAddresses = new Set(multipleWallets.map(w => w.address));
      expect(uniqueAddresses.size).toBe(3);
      
      // Verify each wallet has valid properties
      multipleWallets.forEach((wallet, i) => {
        expect(typeof wallet.address).toBe('string');
        expect(wallet.address).toBeTruthy();
        expect(typeof wallet.derivationPath).toBe('string');
        expect(wallet.derivationPath).toBeTruthy();
      });
    });
  });

  describe('Performance', () => {
    it('should create wallets within reasonable time', async () => {
      const iterations = 2;
      const startTime = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        await createWallet({
          keyType: KEY_TYPE.ED25519,
          mnemonic: generateMnemonicPhrase(12)
        });
      }
      
      const duration = Date.now() - startTime;
      
      // Should be under 5 seconds for 2 iterations
      expect(duration).toBeLessThan(5000);
    });
  });
});