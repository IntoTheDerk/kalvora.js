import { blake3 } from '@noble/hashes/blake3.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha3_256, sha3_512 } from '@noble/hashes/sha3.js';

import type { HashType } from '../types/index.js';

import { HASH_TYPE, VALID_HASH_TYPES } from './constants.js';

/**
 * Utility functions for byte manipulation
 */
const _ByteUtils = {
  /**
   * Compare two byte arrays for equality
   */
  equals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  },

  /**
   * Convert bytes to hex string
   */
  toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },

  /**
   * Convert hex string to bytes
   */
  fromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  },

  /**
   * Concatenate multiple byte arrays
   */
  concat(...arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }
};

/**
 * Hash function implementations
 */
const HashFunctions = {
  [HASH_TYPE.SHA3_256]: (data: Uint8Array): Uint8Array => sha3_256(data),
  [HASH_TYPE.SHA3_512]: (data: Uint8Array): Uint8Array => sha3_512(data),
  [HASH_TYPE.BLAKE3]: (data: Uint8Array): Uint8Array => blake3(data)
};

/**
 * Get hash function by type
 */
export function getHashFunction(hashType: HashType): (data: Uint8Array) => Uint8Array {
  const hashFn = HashFunctions[hashType];
  if (!hashFn) {
    throw new Error(`Unsupported hash type: ${hashType}`);
  }
  return hashFn;
}

/**
 * Validate hash types array
 */
export function validateHashTypes(hashTypes: HashType[]): boolean {
  if (hashTypes.length === 0) {
    return false;
  }
  
  return hashTypes.every(hashType => VALID_HASH_TYPES.includes(hashType));
}

/**
 * Get all hash information
 */
export function getAllHashInfo(): {
  supportedTypes: readonly HashType[];
  implementations: Record<HashType, string>;
  descriptions: Record<HashType, string>;
  } {
  return {
    supportedTypes: VALID_HASH_TYPES,
    implementations: {
      [HASH_TYPE.SHA3_256]: '@noble/hashes/sha3',
      [HASH_TYPE.SHA3_512]: '@noble/hashes/sha3',
      [HASH_TYPE.BLAKE3]: '@noble/hashes/blake3'
    },
    descriptions: {
      [HASH_TYPE.SHA3_256]: 'SHA-3 256-bit hash function',
      [HASH_TYPE.SHA3_512]: 'SHA-3 512-bit hash function',
      [HASH_TYPE.BLAKE3]: 'BLAKE3 hash function'
    }
  };
}

/**
 * Get supported hash types
 */
export function getSupportedHashTypes(): readonly HashType[] {
  return VALID_HASH_TYPES;
}

/**
 * Hash data with specified hash type
 */
export function hashData(data: Uint8Array, hashType: HashType): Uint8Array {
  const hashFn = getHashFunction(hashType);
  return hashFn(data);
}

/**
 * Create HMAC with specified hash type
 */
export function createHMAC(key: Uint8Array, data: Uint8Array, hashType: HashType): Uint8Array {
  if (hashType === HASH_TYPE.SHA3_256) {
    return hmac(sha3_256, key, data);
  } else if (hashType === HASH_TYPE.SHA3_512) {
    return hmac(sha3_512, key, data);
  } else if (hashType === HASH_TYPE.BLAKE3) {
    return hmac(blake3, key, data);
  } else {
    throw new Error(`Unsupported hash type for HMAC: ${hashType}`);
  }
}

/**
 * Double hash (hash of hash) for additional security
 */
export function doubleHash(data: Uint8Array, hashType: HashType): Uint8Array {
  const hashFn = getHashFunction(hashType);
  const firstHash = hashFn(data);
  return hashFn(firstHash);
}

/**
 * Create hash chain by applying multiple hash functions in sequence
 */
export function createHashChain(hashTypes: HashType[], data: Uint8Array): Uint8Array {
  let result = data;
  
  for (const hashType of hashTypes.reverse()) {
    const hashFn = getHashFunction(hashType);
    result = hashFn(result);
  }
  
  return result;
}
