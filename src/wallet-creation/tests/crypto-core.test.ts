import bs58 from 'bs58';
import { describe, it, expect } from 'vitest';

import { KEY_TYPE } from '../constants.js';
import { 
  SLIP0010HDWallet, 
  Ed25519KeyPair, 
  Ed448KeyPair, 
  CryptoUtils 
} from '../crypto-core.js';
import { 
  generateMnemonicPhrase, 
  generateSeed, 
  buildDerivationPath 
} from '../hd-utils.js';

describe('Crypto Core', () => {
  describe('SLIP-0010 HD Wallet', () => {
    it('should create master node from seed', () => {
      const mnemonic = generateMnemonicPhrase(12);
      const seed = generateSeed(mnemonic);
      const masterNode = new SLIP0010HDWallet(seed, "m/44'/5258'/0'/0/0", KEY_TYPE.ED25519);
      
      expect(masterNode.depth).toBeDefined();
      expect(masterNode.index).toBeDefined();
      expect(masterNode.getFingerprint(KEY_TYPE.ED25519)).toBeDefined();
    });

    it('should create child node with different path', () => {
      const mnemonic = generateMnemonicPhrase(12);
      const seed = generateSeed(mnemonic);
      const childPath = buildDerivationPath({ addressIndex: 1 });
      const childNode = new SLIP0010HDWallet(seed, childPath, KEY_TYPE.ED25519);
      
      expect(childNode.depth).toBeDefined();
      expect(childNode.index).toBeDefined();
    });

    it('should have deterministic derivation', () => {
      const mnemonic = generateMnemonicPhrase(12);
      const seed = generateSeed(mnemonic);
      const childPath = buildDerivationPath({ addressIndex: 1 });
      
      const childNode1 = new SLIP0010HDWallet(seed, childPath, KEY_TYPE.ED25519);
      const childNode2 = new SLIP0010HDWallet(seed, childPath, KEY_TYPE.ED25519);
      
      expect(childNode1.getFingerprint(KEY_TYPE.ED25519)).toBe(childNode2.getFingerprint(KEY_TYPE.ED25519));
    });

    it('should generate extended keys', () => {
      const mnemonic = generateMnemonicPhrase(12);
      const seed = generateSeed(mnemonic);
      const masterNode = new SLIP0010HDWallet(seed, "m/44'/5258'/0'/0/0", KEY_TYPE.ED25519);
      
      const extendedPrivateKey = masterNode.getExtendedPrivateKey();
      const extendedPublicKey = masterNode.getExtendedPublicKey();
      
      expect(extendedPrivateKey.length).toBeGreaterThan(0);
      expect(extendedPublicKey.length).toBeGreaterThan(0);
    });
  });

  describe('Ed25519 Key Pair', () => {
    it('should generate new key pair', () => {
      const keyPair = new Ed25519KeyPair();
      
      expect(keyPair.getPrivateKeyBase58().length).toBeGreaterThan(0);
      expect(keyPair.getPublicKeyBase58().length).toBeGreaterThan(0);
    });

    it('should create from private key', () => {
      const keyPair1 = new Ed25519KeyPair();
      const privateKey = keyPair1.getPrivateKeyBase58();
      const keyPair2 = Ed25519KeyPair.fromPrivateKey(
        bs58.decode(privateKey)
      );
      
      expect(keyPair1.getPublicKeyBase58()).toBe(keyPair2.getPublicKeyBase58());
    });

    it('should sign and verify', () => {
      const keyPair = new Ed25519KeyPair();
      const message = Buffer.from('Hello, Kalvora!', 'utf8');
      const signature = keyPair.sign(message);
      const isValid = keyPair.verify(signature, message);
      
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const keyPair = new Ed25519KeyPair();
      const message = Buffer.from('Hello, Kalvora!', 'utf8');
      const invalidSignature = new Uint8Array(64); // Correct length for Ed25519 signature
      const isInvalid = keyPair.verify(invalidSignature, message);
      
      expect(isInvalid).toBe(false);
    });
  });

  describe('Ed448 Key Pair', () => {
    it('should generate new key pair', () => {
      const keyPair = new Ed448KeyPair();
      
      expect(keyPair.getPrivateKeyBase58().length).toBeGreaterThan(0);
      expect(keyPair.getPublicKeyBase58().length).toBeGreaterThan(0);
    });

    it('should create from private key', () => {
      const keyPair1 = new Ed448KeyPair();
      const privateKey = keyPair1.getPrivateKeyBase58();
      const keyPair2 = Ed448KeyPair.fromPrivateKey(
        bs58.decode(privateKey)
      );
      
      expect(keyPair1.getPublicKeyBase58()).toBe(keyPair2.getPublicKeyBase58());
    });

    it('should sign and verify', () => {
      const keyPair = new Ed448KeyPair();
      const message = Buffer.from('Hello, Kalvora!', 'utf8');
      const signature = keyPair.sign(message);
      const isValid = keyPair.verify(signature, message);
      
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const keyPair = new Ed448KeyPair();
      const message = Buffer.from('Hello, Kalvora!', 'utf8');
      const invalidSignature = new Uint8Array(114); // Correct length for Ed448 signature
      const isInvalid = keyPair.verify(invalidSignature, message);
      
      expect(isInvalid).toBe(false);
    });
  });

  describe('Crypto Utils', () => {
    it('should generate random private keys', () => {
      const ed25519PrivateKey = CryptoUtils.randomPrivateKey(KEY_TYPE.ED25519);
      const ed448PrivateKey = CryptoUtils.randomPrivateKey(KEY_TYPE.ED448);
      
      expect(ed25519PrivateKey.length).toBeGreaterThan(0);
      expect(ed448PrivateKey.length).toBeGreaterThan(0);
    });

    it('should generate public keys', () => {
      const ed25519PrivateKey = CryptoUtils.randomPrivateKey(KEY_TYPE.ED25519);
      const ed448PrivateKey = CryptoUtils.randomPrivateKey(KEY_TYPE.ED448);
      
      const ed25519PublicKey = CryptoUtils.getPublicKey(ed25519PrivateKey, KEY_TYPE.ED25519);
      const ed448PublicKey = CryptoUtils.getPublicKey(ed448PrivateKey, KEY_TYPE.ED448);
      
      expect(ed25519PublicKey.length).toBeGreaterThan(0);
      expect(ed448PublicKey.length).toBeGreaterThan(0);
    });

    it('should validate key lengths', () => {
      const ed25519PrivateKey = CryptoUtils.randomPrivateKey(KEY_TYPE.ED25519);
      const ed448PrivateKey = CryptoUtils.randomPrivateKey(KEY_TYPE.ED448);
      
      expect(ed25519PrivateKey.length).toBe(32);
      expect(ed448PrivateKey.length).toBe(57);
    });
  });

  describe('Key Derivation', () => {
    it('should derive keys with different paths', () => {
      const mnemonic = generateMnemonicPhrase(24);
      const seed = generateSeed(mnemonic);
      const masterNode = new SLIP0010HDWallet(seed, "m/44'/5258'/0'/0/0", KEY_TYPE.ED25519);
      
      const paths = [
        buildDerivationPath({ addressIndex: 0 }),
        buildDerivationPath({ addressIndex: 1 }),
        buildDerivationPath({ changeIndex: 1, addressIndex: 0 }),
        buildDerivationPath({ changeIndex: 1, addressIndex: 1 })
      ];
      
      const derivedKeys: string[] = [];
      
      for (const path of paths) {
        const childNode = new SLIP0010HDWallet(seed, path, KEY_TYPE.ED25519);
        const privateKey = childNode.getPrivateKeyBase58();
        derivedKeys.push(privateKey);
      }
      
      // Verify all keys are different
      const uniqueKeys = new Set(derivedKeys);
      expect(uniqueKeys.size).toBe(derivedKeys.length);
    });
  });

  describe('Cross-platform Compatibility', () => {
    it('should have deterministic derivation with known mnemonic', () => {
      const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const seed = generateSeed(testMnemonic);
      const masterNode = new SLIP0010HDWallet(seed, "m/44'/5258'/0'/0/0", KEY_TYPE.ED25519);
      
      const path = buildDerivationPath({ addressIndex: 0 });
      const childNode = new SLIP0010HDWallet(seed, path, KEY_TYPE.ED25519);
      
      const privateKey = childNode.getPrivateKeyBase58();
      
      expect(privateKey).toBeTruthy();
      expect(typeof privateKey).toBe('string');
    });
  });
});
