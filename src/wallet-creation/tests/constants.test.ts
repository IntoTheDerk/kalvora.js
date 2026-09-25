import { describe, it, expect } from 'vitest';

import { 
  VALID_KEY_TYPES, 
  KALVORA_TYPE,
  KALVORA_TYPE_HEX,
  KALVORA_SYMBOL,
  KALVORA_NAME,
  SLIP0010_DERIVATION_PATH,
  validateSLIP0010Path
} from '../constants.js';

describe('Constants Module', () => {
  describe('VALID_KEY_TYPES', () => {
    it('should be an array', () => {
      expect(Array.isArray(VALID_KEY_TYPES)).toBe(true);
    });

    it('should include ed25519', () => {
      expect(VALID_KEY_TYPES.includes('ed25519')).toBe(true);
    });

    it('should include ed448', () => {
      expect(VALID_KEY_TYPES.includes('ed448')).toBe(true);
    });

    it('should have 2 elements', () => {
      expect(VALID_KEY_TYPES.length).toBe(2);
    });
  });

  describe('Kalvora network constants', () => {
    it('should have correct KALVORA_TYPE', () => {
      expect(KALVORA_TYPE).toBe(5258);
    });

    it('should have correct KALVORA_TYPE_HEX', () => {
      expect(KALVORA_TYPE_HEX).toBe('0x8000148a');
    });

    it('should have correct KALVORA_SYMBOL', () => {
      expect(KALVORA_SYMBOL).toBe('KAL');
    });

    it('should have correct KALVORA_NAME', () => {
      expect(KALVORA_NAME).toBe('Kalvora');
    });

    it('should keep deprecated ZERA aliases aligned', () => {
      expect(KALVORA_TYPE).toBe(KALVORA_TYPE);
      expect(KALVORA_TYPE_HEX).toBe(KALVORA_TYPE_HEX);
    });
  });

  describe('Derivation path', () => {
    it('should be SLIP-0010 format (all hardened)', () => {
      expect(SLIP0010_DERIVATION_PATH).toBe('m/44\'/5258\'/0\'/0\'/0\'');
    });

    it('should accept Kalvora coin type 5258 and reject legacy ZERA coin type 1110', () => {
      expect(validateSLIP0010Path('m/44\'/5258\'/0\'/0\'/0\'')).toBe(true);
      expect(validateSLIP0010Path('m/44\'/1110\'/0\'/0\'/0\'')).toBe(false);
    });
  });
});
