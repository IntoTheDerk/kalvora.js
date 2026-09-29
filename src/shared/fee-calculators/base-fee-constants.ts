/**
 * Base Fee Constants
 * 
 * Structural constants used for transaction size calculation.
 * Fee values (key_fee, byte_fee, new_wallet_fee) are sourced from the BaseFee gRPC API at runtime.
 */

import { KEY_TYPE } from '../crypto/constants.js';

/**
 * Signature sizes for different key types (used for transaction size calculation)
 */
export const SIGNATURE_SIZES = {
  ED25519: 64,  // Ed25519 signature size in bytes
  ED448: 114     // Ed448 signature size in bytes
} as const;

/**
 * Hash sizes for different hash types (used for transaction size calculation)
 */
export const HASH_SIZES = {
  SHA3_256: 32,  // SHA3-256 hash size in bytes
  SHA3_512: 64,  // SHA3-512 hash size in bytes  
  BLAKE3: 32     // BLAKE3 hash size in bytes (typically 32 bytes)
} as const;

export const HASH_SIZE = HASH_SIZES.SHA3_256; // TXN Hash size

/**
 * Protobuf overhead for bytes fields (hash / signature)
 */
export const PROTOBUF_HASH_OVERHEAD = 2;
export const PROTOBUF_BASE_SIGNATURE_OVERHEAD = 2;
export const PROTOBUF_AUTH_SIGNATURE_OVERHEAD = 2;

/**
 * Get signature size for a key type
 */
export function getSignatureSize(keyType: string, _hashType?: string): number {
  if (keyType === KEY_TYPE.ED25519) {
    return SIGNATURE_SIZES.ED25519;
  } else if (keyType === KEY_TYPE.ED448) {
    return SIGNATURE_SIZES.ED448;
  } else {
    // Default to Ed25519 size
    return SIGNATURE_SIZES.ED25519;
  }
}