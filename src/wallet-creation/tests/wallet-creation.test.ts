import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createWallet, generateMnemonicPhrase, buildDerivationPath, deriveMultipleWallets, KEY_TYPE, HASH_TYPE } from '../index.js';

describe('Kalvora Wallet Creation', () => {
  beforeAll(() => {
    console.log('Setting up wallet creation tests');
  });
  
  afterAll(() => {
    console.log('Cleaning up wallet creation tests');
  });
  
  describe('Basic Wallet Creation', () => {
    it('should create a basic Ed25519 wallet (key-only mode)', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic
      });
      
      // Basic wallet structure validation
      expect(wallet).toBeDefined();
      expect(typeof wallet.address).toBe('string');
      expect(typeof wallet.privateKey).toBe('string');
      expect(typeof wallet.publicKey).toBe('string');
      expect(wallet.type).toBe('hd');
      expect(wallet.keyType).toBe(KEY_TYPE.ED25519);
      // Address should equal the base58 public key
      expect(wallet.publicKey.startsWith('A_')).toBe(true);
      expect(wallet.address).toBe(wallet.publicKey.substring(2));
    });
    
    it('should create a basic Ed448 wallet (key-only mode)', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED448,
        mnemonic
      });
      
      // Basic wallet structure validation
      expect(wallet).toBeDefined();
      expect(typeof wallet.address).toBe('string');
      expect(typeof wallet.privateKey).toBe('string');
      expect(typeof wallet.publicKey).toBe('string');
      expect(wallet.type).toBe('hd');
      expect(wallet.keyType).toBe(KEY_TYPE.ED448);
      // Address should equal the base58 public key
      expect(wallet.publicKey.startsWith('B_')).toBe(true);
      expect(wallet.address).toBe(wallet.publicKey.substring(2));
    });
  });
  
  describe('Wallet Properties', () => {
    it('should have all required properties', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic
      });
      
      expect(wallet.type).toBeDefined();
      expect(wallet.mnemonic).toBeDefined();
      expect(wallet.privateKey).toBeDefined();
      expect(wallet.address).toBeDefined();
      expect(wallet.publicKey).toBeDefined();
      expect(wallet.coinType).toBeDefined();
      expect(wallet.symbol).toBeDefined();
      expect(wallet.name).toBeDefined();
      expect(wallet.derivationPath).toBeDefined();
      expect(wallet.keyType).toBeDefined();
      expect(wallet.publicKeyPackage).toBeDefined();
    });

    it('should have correct Kalvora network properties', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic
      });
      
      expect(wallet.coinType).toBe(5258);
      expect(wallet.symbol).toBe('KAL');
      expect(wallet.name).toBe('Kalvora');
    });
  });

  describe('Legacy Hash Type Support', () => {
    it('should still support SHA3-256 hash type (backward compat)', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        hashTypes: [HASH_TYPE.SHA3_256],
        mnemonic
      });
      
      expect(wallet.hashTypes).toContain(HASH_TYPE.SHA3_256);
    });

    it('should still support SHA3-512 hash type (backward compat)', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        hashTypes: [HASH_TYPE.SHA3_512],
        mnemonic
      });
      
      expect(wallet.hashTypes).toContain(HASH_TYPE.SHA3_512);
    });

    it('should still support Blake3 hash type (backward compat)', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        hashTypes: [HASH_TYPE.BLAKE3],
        mnemonic
      });
      
      expect(wallet.hashTypes).toContain(HASH_TYPE.BLAKE3);
    });

    it('should still support multiple hash types (backward compat)', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        hashTypes: [HASH_TYPE.SHA3_256, HASH_TYPE.BLAKE3],
        mnemonic
      });
      
      expect(wallet.hashTypes).toContain(HASH_TYPE.SHA3_256);
      expect(wallet.hashTypes).toContain(HASH_TYPE.BLAKE3);
      expect(wallet.hashTypes!.length).toBe(2);
    });
  });

  describe('Derivation Path', () => {
    it('should have valid SLIP-0010 derivation path', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic
      });
      
      expect(wallet.derivationPath).toMatch(/^m\/44'/);
      expect(wallet.derivationPath).toContain('5258\'');
      expect(wallet.derivationPath).toMatch(/0'\/0'\/0'$/);
    });

    it('should reproduce the Kalvora coin type 5258 reference vector', async () => {
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      });

      expect(wallet.coinType).toBe(5258);
      expect(wallet.derivationPath).toBe('m/44\'/5258\'/0\'/0\'/0\'');
      expect(wallet.address).toBe('Hb6KH2BhgcjCYnc3JwDU1VNfbLds2yfMDMVwZGUWSunE');
      expect(wallet.publicKey).toBe('A_Hb6KH2BhgcjCYnc3JwDU1VNfbLds2yfMDMVwZGUWSunE');

      wallet.secureClear();
    });
  });

  describe('Address Generation', () => {
    it('should generate valid addresses', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic
      });
      
      expect(wallet.address).toBeTruthy();
      expect(typeof wallet.address).toBe('string');
      expect(wallet.address.length).toBeGreaterThan(0);
    });

    it('should generate different addresses with vs without hash types', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      
      const wallet1 = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic
      });
      
      const wallet2 = await createWallet({
        keyType: KEY_TYPE.ED25519,
        hashTypes: [HASH_TYPE.BLAKE3],
        mnemonic
      });
      
      expect(wallet1.address).not.toBe(wallet2.address);
    });
  });

  describe('Public Key Package', () => {
    it('should generate base58-encoded public key package', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallet = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic
      });
      
      expect(wallet.publicKeyPackage).toBeTruthy();
      expect(typeof wallet.publicKeyPackage).toBe('string');
      expect(wallet.publicKeyPackage.length).toBeGreaterThan(0);
      // Should be base58 encoded (alphanumeric characters)
      expect(wallet.publicKeyPackage).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('should generate different public key packages for different key types', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      
      const wallet1 = await createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic
      });
      
      const wallet2 = await createWallet({
        keyType: KEY_TYPE.ED448,
        mnemonic
      });
      
      expect(wallet1.publicKeyPackage).not.toBe(wallet2.publicKeyPackage);
    });
  });

  describe('Derivation Path Building', () => {
    it('should build default derivation path', () => {
      const path = buildDerivationPath();
      expect(typeof path).toBe('string');
      expect(path).toMatch(/^m\/44'/);
      expect(path).toContain('5258\'');
      expect(path).toMatch(/0'\/0'\/0'$/);
    });

    it('should build custom derivation path', () => {
      const path = buildDerivationPath({ accountIndex: 1, changeIndex: 1, addressIndex: 5 });
      expect(typeof path).toBe('string');
      expect(path).toMatch(/^m\/44'/);
      expect(path).toContain('5258\'');
      expect(path).toContain('1\'');
      expect(path).toMatch(/1'\/1'\/5'$/);
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

      // All wallets should share the same mnemonic
      wallets.forEach(wallet => {
        expect(wallet.mnemonic).toBe(mnemonic);
        expect(wallet.keyType).toBe(KEY_TYPE.ED25519);
      });

      // Clean up
      wallets.forEach(wallet => wallet.secureClear());
    });

    it('should derive wallets with sequential account indices', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      const wallets = await deriveMultipleWallets({
        keyType: KEY_TYPE.ED25519,
        mnemonic,
        count: 3,
        hdOptions: {
          accountIndex: 5
        }
      });

      expect(wallets).toHaveLength(3);

      // Verify derivation paths show incrementing accountIndex
      expect(wallets[0]?.derivationPath).toContain("/5'/");
      expect(wallets[1]?.derivationPath).toContain("/6'/");
      expect(wallets[2]?.derivationPath).toContain("/7'/");

      // Clean up
      wallets.forEach(wallet => wallet.secureClear());
    });

    it('should derive wallets with different key types', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      
      const ed25519Wallets = await deriveMultipleWallets({
        keyType: KEY_TYPE.ED25519,
        mnemonic,
        count: 2
      });

      const ed448Wallets = await deriveMultipleWallets({
        keyType: KEY_TYPE.ED448,
        mnemonic,
        count: 2
      });

      // ED25519 wallets should have different addresses than ED448 wallets
      const ed25519Addresses = ed25519Wallets.map(w => w.address);
      const ed448Addresses = ed448Wallets.map(w => w.address);
      
      ed25519Addresses.forEach(ed25519Addr => {
        ed448Addresses.forEach(ed448Addr => {
          expect(ed25519Addr).not.toBe(ed448Addr);
        });
      });

      // Clean up
      [...ed25519Wallets, ...ed448Wallets].forEach(wallet => wallet.secureClear());
    });
  });

  describe('Mnemonic Phrase Generation', () => {
    it('should generate 12-word mnemonic', () => {
      const mnemonic = generateMnemonicPhrase(12);
      const words = mnemonic.split(' ');
      expect(words.length).toBe(12);
    });

    it('should generate 15-word mnemonic', () => {
      const mnemonic = generateMnemonicPhrase(15);
      const words = mnemonic.split(' ');
      expect(words.length).toBe(15);
    });

    it('should generate 18-word mnemonic', () => {
      const mnemonic = generateMnemonicPhrase(18);
      const words = mnemonic.split(' ');
      expect(words.length).toBe(18);
    });

    it('should generate 21-word mnemonic', () => {
      const mnemonic = generateMnemonicPhrase(21);
      const words = mnemonic.split(' ');
      expect(words.length).toBe(21);
    });

    it('should generate 24-word mnemonic', () => {
      const mnemonic = generateMnemonicPhrase(24);
      const words = mnemonic.split(' ');
      expect(words.length).toBe(24);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid key type', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      
      await expect(createWallet({
        keyType: 'invalid' as any,
        mnemonic
      })).rejects.toThrow();
    });

    it('should handle invalid hash type (when explicitly provided)', async () => {
      const mnemonic = generateMnemonicPhrase(12);
      
      await expect(createWallet({
        keyType: KEY_TYPE.ED25519,
        hashTypes: ['invalid' as any],
        mnemonic
      })).rejects.toThrow();
    });

    it('should handle invalid mnemonic', async () => {
      await expect(createWallet({
        keyType: KEY_TYPE.ED25519,
        mnemonic: 'invalid mnemonic phrase'
      })).rejects.toThrow();
    });
  });
});
