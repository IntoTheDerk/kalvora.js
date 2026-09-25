import bs58 from 'bs58';
import { describe, it, expect } from 'vitest';

import {
  createWallet,
  deriveMultipleWallets,
  generateMnemonicPhrase,
  KEY_TYPE
} from '../index.js';

describe('Ed448 Implementation', () => {
  describe('Basic Ed448 wallet creation', () => {
    it('should create a valid Ed448 wallet', async () => {
      const words = generateMnemonicPhrase(12);
      
      const ed448Wallet = await createWallet({
        keyType: KEY_TYPE.ED448,
        mnemonic: words
      });
      
      expect(ed448Wallet.keyType).toBe('ed448');
      expect(typeof ed448Wallet.address).toBe('string');
      expect(typeof ed448Wallet.derivationPath).toBe('string');
      expect(ed448Wallet.address).toBeTruthy();
      expect(ed448Wallet.derivationPath).toBeTruthy();
      // New format: public key should start with B_ (no hash prefix)
      expect(ed448Wallet.publicKey.startsWith('B_')).toBe(true);
      // Address should equal the base58 public key
      const base58Part = ed448Wallet.publicKey.substring(2);
      expect(ed448Wallet.address).toBe(base58Part);
    });

    it('should use 57-byte Ed448 private keys', async () => {
      const words = generateMnemonicPhrase(12);
      
      const ed448Wallet = await createWallet({
        keyType: KEY_TYPE.ED448,
        mnemonic: words
      });
      
      const privateKeyBytes = bs58.decode(ed448Wallet.privateKey);
      expect(privateKeyBytes.length).toBe(57);
    });
  });

  describe('HD wallet derivation', () => {
    it('should derive multiple Ed448 addresses from same mnemonic', async () => {
      const words = generateMnemonicPhrase(12);
      
      const multipleWallets = await deriveMultipleWallets({
        mnemonic: words,
        keyType: KEY_TYPE.ED448,
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
      const iterations = 3;
      const startTime = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        await createWallet({
          keyType: KEY_TYPE.ED448,
          mnemonic: generateMnemonicPhrase(12)
        });
      }
      
      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;
      
      expect(duration).toBeLessThan(10000); // Should be under 10 seconds for 3 iterations
      expect(avgTime).toBeLessThan(2000); // Average should be under 2 seconds
    });
  });
});