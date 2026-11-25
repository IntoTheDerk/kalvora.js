import { blake3 } from '@noble/hashes/blake3.js';
import { sha3_256, sha3_512, shake256 } from '@noble/hashes/sha3.js';
import bs58 from 'bs58';

import type { FalconVariant, WalletHash } from '../../../proto/generated/txn_pb.js';

// Numeric IDs are shared with txn.proto. Keep the wallet-only entry free of protobuf runtime imports.
export const FALCON_VARIANT = { FALCON_512: 1, FALCON_1024: 2 } as const;
export const WALLET_HASH = {
  BLAKE3_256: 1, BLAKE3_512: 2, BLAKE3_1024: 3, BLAKE3_2048: 4, BLAKE3_4096: 5, BLAKE3_9001: 6,
  SHA3_256: 7, SHA3_512: 8, SHAKE256_1024: 9, SHAKE256_2048: 10, SHAKE256_4096: 11
} as const;

export function falconVariantFromKey(rawPublicKey: Uint8Array): FalconVariant {
  const small = rawPublicKey.length === 897 && rawPublicKey[0] === 0x09;
  const large = rawPublicKey.length === 1793 && rawPublicKey[0] === 0x0a;
  if (!small && !large) throw new Error('Invalid Falcon public key length or header');
  // Validator canonical_key(): MSB-first 14-bit coefficients must be in [0, 12289).
  let buffer = 0;
  let bits = 0;
  for (const byte of rawPublicKey.subarray(1)) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    if (bits >= 14) {
      bits -= 14;
      if (((buffer >>> bits) & 0x3fff) >= 12289) throw new Error('Non-canonical Falcon public key coefficient');
    }
  }
  return small ? FALCON_VARIANT.FALCON_512 : FALCON_VARIANT.FALCON_1024;
}

export function falconSignatureSize(variant: FalconVariant): number {
  if (variant === FALCON_VARIANT.FALCON_512) return 666;
  if (variant === FALCON_VARIANT.FALCON_1024) return 1280;
  throw new Error('Unknown Falcon variant');
}

/** Hash the complete raw Falcon key or the canonical policy descriptor once. */
export function hashWalletIdentity(bytes: Uint8Array, walletHash: WalletHash): Uint8Array {
  switch (walletHash) {
  case WALLET_HASH.BLAKE3_256: return blake3(bytes);
  case WALLET_HASH.BLAKE3_512: return blake3(bytes, { dkLen: 64 });
  case WALLET_HASH.BLAKE3_1024: return blake3(bytes, { dkLen: 128 });
  case WALLET_HASH.BLAKE3_2048: return blake3(bytes, { dkLen: 256 });
  case WALLET_HASH.BLAKE3_4096: return blake3(bytes, { dkLen: 512 });
  case WALLET_HASH.BLAKE3_9001: {
    const digest = blake3(bytes, { dkLen: 1126 });
    digest[1125] = (digest[1125] as number) & 0x80;
    return digest;
  }
  case WALLET_HASH.SHA3_256: return sha3_256(bytes);
  case WALLET_HASH.SHA3_512: return sha3_512(bytes);
  case WALLET_HASH.SHAKE256_1024: return shake256(bytes, { dkLen: 128 });
  case WALLET_HASH.SHAKE256_2048: return shake256(bytes, { dkLen: 256 });
  case WALLET_HASH.SHAKE256_4096: return shake256(bytes, { dkLen: 512 });
  default: throw new Error('Unknown wallet hash');
  }
}

export function deriveFalconAddress(rawPublicKey: Uint8Array, walletHash: WalletHash = WALLET_HASH.BLAKE3_256): Uint8Array {
  falconVariantFromKey(rawPublicKey);
  return hashWalletIdentity(rawPublicKey, walletHash);
}

export function isWalletAddressBytes(address: Uint8Array): boolean {
  if (address.length === 1126) return ((address[1125] as number) & 0x7f) === 0;
  return [32, 64, 128, 256, 512].includes(address.length);
}

/** Decode a wallet's display address. Base58 preserves every leading zero. */
export function decodeWalletAddress(address: string): Uint8Array {
  // Bound the input before base-x's quadratic conversion.
  if (typeof address !== 'string' || address.length < 32 || address.length > 1538) {
    throw new Error('Invalid wallet address length');
  }
  const raw = bs58.decode(address);
  if (!isWalletAddressBytes(raw)) throw new Error('Invalid wallet address width or padding');
  return raw;
}

export function isWalletAddress(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    decodeWalletAddress(value);
    return true;
  } catch {
    return false;
  }
}
