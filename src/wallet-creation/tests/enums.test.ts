import { describe, it, expect } from 'vitest';

import {
  KEY_TYPE,
  HASH_TYPE,
  VALID_KEY_TYPES,
  VALID_HASH_TYPES,
  MNEMONIC_LENGTHS,
  isValidKeyType,
  isValidHashType,
  isValidMnemonicLength
} from '../constants.js';

describe('Enum Constants', () => {
  describe('Constants', () => {
    it('should have correct KEY_TYPE values', () => {
      expect(KEY_TYPE.ED25519).toBe('ed25519');
      expect(KEY_TYPE.ED448).toBe('ed448');
    });

    it('should have correct HASH_TYPE values', () => {
      expect(HASH_TYPE.SHA3_256).toBe('sha3-256');
      expect(HASH_TYPE.BLAKE3).toBe('blake3');
    });

    it('should have VALID_KEY_TYPES as array', () => {
      expect(Array.isArray(VALID_KEY_TYPES)).toBe(true);
    });

    it('should have VALID_HASH_TYPES as array', () => {
      expect(Array.isArray(VALID_HASH_TYPES)).toBe(true);
    });

    it('should have MNEMONIC_LENGTHS as array', () => {
      expect(Array.isArray(MNEMONIC_LENGTHS)).toBe(true);
    });
  });

  describe('Validation Functions', () => {
    it('should validate key types correctly', () => {
      expect(isValidKeyType(KEY_TYPE.ED25519)).toBe(true);
      expect(isValidKeyType('ed25519')).toBe(true);
      expect(isValidKeyType(KEY_TYPE.ED448)).toBe(true);
      expect(isValidKeyType('ed448')).toBe(true);
      expect(isValidKeyType('invalid' as any)).toBe(false);
    });

    it('should validate hash types correctly', () => {
      expect(isValidHashType(HASH_TYPE.BLAKE3)).toBe(true);
      expect(isValidHashType('blake3')).toBe(true);
      expect(isValidHashType(HASH_TYPE.SHA3_256)).toBe(true);
      expect(isValidHashType('sha3-256')).toBe(true);
      expect(isValidHashType('invalid-hash' as any)).toBe(false);
    });

    it('should validate mnemonic lengths correctly', () => {
      expect(isValidMnemonicLength(12)).toBe(true);
      expect(isValidMnemonicLength(15)).toBe(true);
      expect(isValidMnemonicLength(18)).toBe(true);
      expect(isValidMnemonicLength(21)).toBe(true);
      expect(isValidMnemonicLength(24)).toBe(true);
      // Test with a number that's not in the valid range
      expect(isValidMnemonicLength(13 as any)).toBe(false);
    });
  });

  describe('Enum System', () => {
    it('should have expected number of key types', () => {
      expect(VALID_KEY_TYPES.length).toBe(2);
    });

    it('should have expected number of hash types', () => {
      expect(VALID_HASH_TYPES.length).toBe(3);
    });

    it('should have expected number of mnemonic lengths', () => {
      expect(MNEMONIC_LENGTHS.length).toBe(5);
    });

    it('should include all expected key types', () => {
      expect(VALID_KEY_TYPES).toContain('ed25519');
      expect(VALID_KEY_TYPES).toContain('ed448');
    });

    it('should include all expected hash types', () => {
      expect(VALID_HASH_TYPES).toContain('sha3-256');
      expect(VALID_HASH_TYPES).toContain('sha3-512');
      expect(VALID_HASH_TYPES).toContain('blake3');
    });
  });
});