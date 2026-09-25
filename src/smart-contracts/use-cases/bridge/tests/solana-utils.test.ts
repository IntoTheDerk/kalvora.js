/**
 * Solana Bridge Utilities Tests
 * 
 * Tests for the utility functions used in building Solana bridge transactions.
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, it, expect } from 'vitest';

import {
  generateDiscriminator,
  hexToBytes,
  bytesToHex,
  encodeU64LE,
  encodeU64BE,
  encodeU32LE,
  encodeU16BE,
  encodeU16LE,
  encodeBorshString,
  encodeBorshOption,
  concatBytes,
  hashContractId,
  deriveRouterSignerPDA,
  deriveRouterSigner2022PDA,
  deriveRouterConfigPDA,
  deriveVaultPDA,
  deriveVerifiedTransferPDA,
  deriveReleasedTransferPDA,
  deriveRateLimitStatePDA,
  deriveTokenRegistrationPDA,
  deriveExtensionWhitelist2022PDA,
  deriveWrappedMintPDA,
  deriveWrappedMintAuthorityPDA,
  getATAWithProgramId,
  CORE_PROGRAM_ID,
  TOKEN_BRIDGE_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
} from '../solana/utils.js';

describe('Solana Bridge Utilities', () => {
  describe('generateDiscriminator', () => {
    it('should generate 8-byte discriminators', () => {
      const disc = generateDiscriminator('global:release_spl');
      expect(disc.length).toBe(8);
    });

    it('should generate consistent discriminators for same input', () => {
      const disc1 = generateDiscriminator('global:release_spl');
      const disc2 = generateDiscriminator('global:release_spl');
      expect(bytesToHex(disc1)).toBe(bytesToHex(disc2));
    });

    it('should generate different discriminators for different inputs', () => {
      const disc1 = generateDiscriminator('global:release_spl');
      const disc2 = generateDiscriminator('global:lock_spl');
      expect(bytesToHex(disc1)).not.toBe(bytesToHex(disc2));
    });
  });

  describe('hexToBytes', () => {
    it('should convert hex string to bytes', () => {
      const bytes = hexToBytes('deadbeef');
      expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it('should handle 0x prefix', () => {
      const bytes = hexToBytes('0xdeadbeef');
      expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it('should handle 32-byte hashes', () => {
      const hex = 'a'.repeat(64);
      const bytes = hexToBytes(hex);
      expect(bytes.length).toBe(32);
    });
  });

  describe('bytesToHex', () => {
    it('should convert bytes to hex string', () => {
      const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      expect(bytesToHex(bytes)).toBe('deadbeef');
    });

    it('should pad single-digit values', () => {
      const bytes = new Uint8Array([0x01, 0x02, 0x0f]);
      expect(bytesToHex(bytes)).toBe('01020f');
    });
  });

  describe('encodeU64LE', () => {
    it('should encode u64 in little-endian', () => {
      const bytes = encodeU64LE(BigInt(1));
      expect(bytes).toEqual(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]));
    });

    it('should handle string input', () => {
      const bytes = encodeU64LE('1000000');
      expect(bytes.length).toBe(8);
    });

    it('should handle number input', () => {
      const bytes = encodeU64LE(1000000);
      expect(bytes.length).toBe(8);
    });
  });

  describe('encodeU64BE', () => {
    it('should encode u64 in big-endian', () => {
      const bytes = encodeU64BE(BigInt(1));
      expect(bytes).toEqual(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]));
    });
  });

  describe('encodeU32LE', () => {
    it('should encode u32 in little-endian', () => {
      const bytes = encodeU32LE(1);
      expect(bytes).toEqual(new Uint8Array([1, 0, 0, 0]));
    });
  });

  describe('encodeU16BE', () => {
    it('should encode u16 in big-endian', () => {
      const bytes = encodeU16BE(256);
      expect(bytes).toEqual(new Uint8Array([1, 0]));
    });
  });

  describe('encodeU16LE', () => {
    it('should encode u16 in little-endian', () => {
      const bytes = encodeU16LE(256);
      expect(bytes).toEqual(new Uint8Array([0, 1]));
    });
  });

  describe('encodeBorshString', () => {
    it('should encode string with length prefix', () => {
      const bytes = encodeBorshString('test');
      expect(bytes.length).toBe(4 + 4); // u32 length + 4 chars
      expect(bytes[0]).toBe(4); // length = 4
    });

    it('should handle empty string', () => {
      const bytes = encodeBorshString('');
      expect(bytes.length).toBe(4);
      expect(bytes[0]).toBe(0);
    });
  });

  describe('encodeBorshOption', () => {
    it('should encode None as single 0 byte', () => {
      const bytes = encodeBorshOption(null, () => new Uint8Array([1, 2, 3]));
      expect(bytes).toEqual(new Uint8Array([0]));
    });

    it('should encode undefined as None', () => {
      const bytes = encodeBorshOption(undefined, () => new Uint8Array([1, 2, 3]));
      expect(bytes).toEqual(new Uint8Array([0]));
    });

    it('should encode Some with value', () => {
      const bytes = encodeBorshOption('test', (v) => new TextEncoder().encode(v));
      expect(bytes[0]).toBe(1); // Some marker
      expect(bytes.length).toBe(5); // 1 + 4 chars
    });
  });

  describe('concatBytes', () => {
    it('should concatenate multiple arrays', () => {
      const a = new Uint8Array([1, 2]);
      const b = new Uint8Array([3, 4]);
      const c = new Uint8Array([5]);
      const result = concatBytes(a, b, c);
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    });

    it('should handle empty arrays', () => {
      const a = new Uint8Array([1, 2]);
      const b = new Uint8Array([]);
      const result = concatBytes(a, b);
      expect(result).toEqual(new Uint8Array([1, 2]));
    });
  });

  describe('hashContractId', () => {
    it('should generate 32-byte hash', () => {
      const hash = hashContractId('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
      expect(hash.length).toBe(32);
    });

    it('should generate consistent hashes', () => {
      const hash1 = hashContractId('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
      const hash2 = hashContractId('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
      expect(bytesToHex(hash1)).toBe(bytesToHex(hash2));
    });

    it('should generate different hashes for different IDs', () => {
      const hash1 = hashContractId('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
      const hash2 = hashContractId('SOL0000');
      expect(bytesToHex(hash1)).not.toBe(bytesToHex(hash2));
    });
  });

  describe('PDA Derivation', () => {
    it('should derive router signer PDA', () => {
      const [pda, bump] = deriveRouterSignerPDA();
      expect(pda).toBeInstanceOf(PublicKey);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('should derive Token-2022 router signer PDA', () => {
      const [pda, bump] = deriveRouterSigner2022PDA();
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from('router_signer_2022')],
        TOKEN_BRIDGE_PROGRAM_ID
      );
      expect(pda.toBase58()).toBe(expected.toBase58());
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('should derive router config PDA', () => {
      const [pda, bump] = deriveRouterConfigPDA();
      expect(pda).toBeInstanceOf(PublicKey);
    });

    it('should derive vault PDA', () => {
      const [pda, bump] = deriveVaultPDA();
      expect(pda).toBeInstanceOf(PublicKey);
    });

    it('should derive verified transfer PDA with hash', () => {
      const hash = new Uint8Array(32).fill(1);
      const [pda, bump] = deriveVerifiedTransferPDA(hash);
      expect(pda).toBeInstanceOf(PublicKey);
    });

    it('should derive released transfer PDA with hash', () => {
      const hash = new Uint8Array(32).fill(1);
      const [pda, bump] = deriveReleasedTransferPDA(hash);
      expect(pda).toBeInstanceOf(PublicKey);
    });

    it('should derive rate limit state PDA', () => {
      const [pda, bump] = deriveRateLimitStatePDA();
      expect(pda).toBeInstanceOf(PublicKey);
    });

    it('should derive token registration PDA with mint', () => {
      const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const [pda, bump] = deriveTokenRegistrationPDA(mint);
      expect(pda).toBeInstanceOf(PublicKey);
    });

    it('should derive Token-2022 extension whitelist PDA', () => {
      const [pda, bump] = deriveExtensionWhitelist2022PDA();
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from('extension_whitelist_2022')],
        TOKEN_BRIDGE_PROGRAM_ID
      );
      expect(pda.toBase58()).toBe(expected.toBase58());
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('should derive wrapped mint PDA from contract ID', () => {
      const [pda, bump] = deriveWrappedMintPDA('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
      expect(pda).toBeInstanceOf(PublicKey);
    });

    it('should derive wrapped mint authority PDA', () => {
      const [wrappedMint] = deriveWrappedMintPDA('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
      const [pda, bump] = deriveWrappedMintAuthorityPDA(wrappedMint);
      expect(pda).toBeInstanceOf(PublicKey);
    });
  });

  describe('Program IDs', () => {
    it('should have valid core program ID', () => {
      expect(CORE_PROGRAM_ID).toBeInstanceOf(PublicKey);
      expect(CORE_PROGRAM_ID.toBase58()).toBe('zera3giq7oM9QJaD6mY1ajGmakv9TZcax5Giky99HD8');
    });

    it('should have valid token bridge program ID', () => {
      expect(TOKEN_BRIDGE_PROGRAM_ID).toBeInstanceOf(PublicKey);
      expect(TOKEN_BRIDGE_PROGRAM_ID.toBase58()).toBe('WrapZ8f88HR8waSp7wR8Vgc68z4hKj3p3i2b81oeSxR');
    });

    it('should have valid Token-2022 program ID', () => {
      expect(TOKEN_2022_PROGRAM_ID).toBeInstanceOf(PublicKey);
      expect(TOKEN_2022_PROGRAM_ID.toBase58()).toBe('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    });
  });

  describe('ATA Derivation', () => {
    it('should derive Token-2022 ATAs with the Token-2022 program ID', () => {
      const owner = Keypair.generate().publicKey;
      const mint = Keypair.generate().publicKey;
      const ata = getATAWithProgramId(owner, mint, TOKEN_2022_PROGRAM_ID);
      const expected = PublicKey.findProgramAddressSync(
        [
          owner.toBuffer(),
          TOKEN_2022_PROGRAM_ID.toBuffer(),
          mint.toBuffer()
        ],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      )[0];

      expect(ata.toBase58()).toBe(expected.toBase58());
    });
  });
});
