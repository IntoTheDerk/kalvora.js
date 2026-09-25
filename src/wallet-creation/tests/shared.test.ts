import { describe, it, expect } from 'vitest';

import { isValidAddress } from '../../shared/utils/validation.js';
import { TEST_WALLET_ADDRESSES } from '../../test-utils/keys.test.js';
import { isValidKeyType } from '../constants.js';
import { validateMnemonicPhrase } from '../hd-utils.js';
import { 
  createBaseWallet, 
  validateWalletObject,
  sanitizeWalletForLogging,
  createWalletSummary
} from '../shared.js';

describe('Shared Utilities', () => {
  describe('Mnemonic validation', () => {
    it('should validate valid mnemonic', () => {
      const validMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      expect(validateMnemonicPhrase(validMnemonic)).toBe(true);
    });

    it('should reject invalid mnemonic', () => {
      const invalidMnemonic = 'invalid mnemonic phrase';
      expect(validateMnemonicPhrase(invalidMnemonic)).toBe(false);
    });
  });

  describe('Key type validation', () => {
    it('should validate ed25519', () => {
      expect(isValidKeyType('ed25519')).toBe(true);
    });

    it('should validate ed448', () => {
      expect(isValidKeyType('ed448')).toBe(true);
    });

    it('should reject invalid type', () => {
      expect(isValidKeyType('invalid' as any)).toBe(false);
    });
  });

  describe('Create base wallet', () => {
    it('should create a valid base wallet', () => {
      const validMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const baseWallet = createBaseWallet(
        'hd', // type
        validMnemonic, // mnemonic
        'private-key-hex', // privateKey
        'zera-address', // address
        'public-key-hex', // publicKey
        5258, // coinType
        'KAL', // symbol
        'm/44\'/5258\'/0\'/0\'/0\'', // derivationPath
        'ed25519' as const // keyType
      );

      expect(baseWallet.type).toBe('hd');
      expect(baseWallet.mnemonic).toBe(validMnemonic);
      expect(baseWallet.privateKey).toBe('private-key-hex');
      expect(baseWallet.address).toBe('zera-address');
      expect(baseWallet.publicKey).toBe('public-key-hex');
      expect(baseWallet.coinType).toBe(5258);
      expect(baseWallet.symbol).toBe('KAL');
      expect(baseWallet.derivationPath).toBe('m/44\'/5258\'/0\'/0\'/0\'');
      expect(baseWallet.keyType).toBe('ed25519');
      expect(baseWallet.hashTypes).toBeUndefined();
    });
  });

  describe('Address validation', () => {
    it('should validate valid Kalvora address format', () => {
      const validAddress = TEST_WALLET_ADDRESSES.alice;
      expect(isValidAddress(validAddress)).toBe(true);
    });

    it('should reject invalid addresses', () => {
      expect(isValidAddress('invalid-address')).toBe(false);
      expect(isValidAddress('')).toBe(false);
    });
  });

  describe('Wallet object validation', () => {
    it('should validate a complete wallet object', () => {
      const validWallet = {
        type: 'hd',
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        privateKey: 'private-key',
        address: TEST_WALLET_ADDRESSES.alice,
        publicKey: 'public-key',
        coinType: 5258,
        symbol: 'KAL',
        name: 'Kalvora',
        derivationPath: 'm/44\'/5258\'/0\'/0\'/0\'',
        keyType: 'ed25519' as const,
        publicKeyPackage: 'A_publicKeyIdentifier'
      };

      const validation = validateWalletObject(validWallet);
      expect(validation).toBe(true);
    });

    it('should reject incomplete wallet object', () => {
      const invalidWallet = {
        type: 'hd',
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
        // Missing required fields
      } as any;

      const validation = validateWalletObject(invalidWallet);
      expect(validation).toBe(false);
    });
  });

  describe('Wallet sanitization', () => {
    it('should sanitize wallet for logging', () => {
      const wallet = {
        type: 'hd',
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        privateKey: 'private-key',
        address: TEST_WALLET_ADDRESSES.alice,
        publicKey: 'public-key',
        coinType: 5258,
        symbol: 'KAL',
        name: 'Kalvora',
        derivationPath: 'm/44\'/5258\'/0\'/0\'/0\'',
        keyType: 'ed25519' as const,
        publicKeyPackage: 'A_publicKeyIdentifier'
      };

      const sanitized = sanitizeWalletForLogging(wallet);
      
      expect(sanitized.privateKey).toBe('[REDACTED]');
      expect(sanitized.mnemonic).toBe('[REDACTED]');
      expect(sanitized.address).toBe(wallet.address); // Address should remain
      expect(sanitized.publicKey).toBe('public-key...'); // Public key should be truncated
    });
  });

  describe('Wallet summary', () => {
    it('should create wallet summary', () => {
      const wallet = {
        type: 'hd',
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        privateKey: 'private-key',
        address: TEST_WALLET_ADDRESSES.alice,
        publicKey: 'public-key',
        coinType: 5258,
        symbol: 'KAL',
        name: 'Kalvora',
        derivationPath: 'm/44\'/5258\'/0\'/0\'/0\'',
        keyType: 'ed25519' as const,
        publicKeyPackage: 'A_publicKeyIdentifier'
      };

      const summary = createWalletSummary(wallet);
      
      expect(typeof summary).toBe('string');
      expect(summary).toContain('Wallet Summary:');
      expect(summary).toContain('Type: hd');
      expect(summary).toContain(TEST_WALLET_ADDRESSES.alice);
      expect(summary).toContain('Key Type: ed25519');
      expect(summary).toContain('Symbol: KAL');
      expect(summary).toContain('m/44\'/5258\'/0\'/0\'/0\'');
    });
  });
});
