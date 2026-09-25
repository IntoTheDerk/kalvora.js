
import bs58 from 'bs58';
import { describe, it, expect } from 'vitest';

import { sanitizeAndDecodeAddress } from '../address-utils.js';

describe('Address Utils', () => {
  describe('sanitizeAndDecodeAddress', () => {
    it('should decode a valid base58 string', () => {
      const address = 'A_5KJvsngHeMby884zrh6A5u6b4SqzZzAb';
      // Note: This function just decodes base58, it doesn't validate the Kalvora structure (unless implied by use case)
      // But wait, Kalvora addresses are base58 encoded. 
      // Let's use a simple base58 string.
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const encoded = bs58.encode(bytes);
      
      const decoded = sanitizeAndDecodeAddress(encoded);
      expect(decoded).toEqual(bytes);
    });

    it('should trim whitespace and decode', () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const encoded = bs58.encode(bytes);
      const addressWithSpace = `  ${encoded}  `;
      
      const decoded = sanitizeAndDecodeAddress(addressWithSpace);
      expect(decoded).toEqual(bytes);
    });

    it('should throw error for empty string', () => {
      expect(() => sanitizeAndDecodeAddress('')).toThrow('Address must be a non-empty string');
    });

    it('should throw error for string with only whitespace', () => {
      expect(() => sanitizeAndDecodeAddress('   ')).toThrow('Address cannot be empty');
    });

    it('should throw error for invalid base58 string', () => {
      expect(() => sanitizeAndDecodeAddress('InvalidBase58Characters0OIl')).toThrow('Invalid address format');
    });
  });
});
