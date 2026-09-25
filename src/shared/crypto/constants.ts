/**
 * Shared Cryptographic Constants for Kalvora JS SDK
 * 
 * This module contains cryptographic constants that are used across multiple
 * modules in the SDK, including wallet creation, address generation, and
 * fee calculation.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type KeyType = 'ed25519' | 'ed448';
export type HashType = 'sha3-256' | 'sha3-512' | 'blake3';

// ============================================================================
// CRYPTOGRAPHIC CONSTANTS
// ============================================================================

// Key type enums - these are the only valid key types
export const KEY_TYPE = {
  ED25519: 'ed25519',
  ED448: 'ed448'
} as const;

// Hash type enums - these are the only valid hash types
export const HASH_TYPE = {
  SHA3_256: 'sha3-256',
  SHA3_512: 'sha3-512',
  BLAKE3: 'blake3'
} as const;

// Type arrays for validation
export const VALID_KEY_TYPES: readonly KeyType[] = Object.values(KEY_TYPE);
export const VALID_HASH_TYPES: readonly HashType[] = Object.values(HASH_TYPE);

// ============================================================================
// DISPLAY PREFIXES
// ============================================================================

// Key type prefixes for display
export const KEY_TYPE_PREFIXES: Record<KeyType, string> = {
  [KEY_TYPE.ED25519]: 'A',
  [KEY_TYPE.ED448]: 'B'
};

// Hash type prefixes for display
export const HASH_TYPE_PREFIXES: Record<HashType, string> = {
  [HASH_TYPE.SHA3_256]: 'a',
  [HASH_TYPE.SHA3_512]: 'b',
  [HASH_TYPE.BLAKE3]: 'c'
};

// Special identifier prefixes
export const SPECIAL_PREFIXES = {
  SMART_CONTRACT: 'sc_',
  GOVERNANCE: 'gov_'
} as const;

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

export function isValidKeyType(keyType: KeyType): boolean {
  return VALID_KEY_TYPES.includes(keyType);
}

export function isValidHashType(hashType: HashType): boolean {
  return VALID_HASH_TYPES.includes(hashType);
}
