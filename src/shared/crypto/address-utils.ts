/**
 * Address Utilities for Kalvora SDK
 * 
 * This module provides utilities for working with Kalvora addresses and public key identifiers.
 * 
 * Address Format (current standard):
 *   Public Key Identifier: "A_<base58PublicKey>" (Ed25519) or "B_<base58PublicKey>" (Ed448)
 *   Address: base58 encoding of the raw public key bytes
 * 
 * Legacy Format (still supported):
 *   Public Key Identifier: "A_c_<base58PublicKey>" (with hash type prefix)
 *   Address: base58 encoding of the hashed public key
 */

import bs58 from 'bs58';

import { createHashChain } from '../../wallet-creation/hash-utils.js';

import { KEY_TYPE, HASH_TYPE, KEY_TYPE_PREFIXES, HASH_TYPE_PREFIXES, SPECIAL_PREFIXES, isValidKeyType, isValidHashType } from './constants.js';
import type { KeyType, HashType } from './constants.js';

/**
 * Generate Kalvora address from public key and optional hash types
 * 
 * Current standard: address = base58(publicKey) — no hashing
 * Legacy mode: when hashTypes are provided, applies hash chain before encoding
 */
export function generateKalvoraAddress(
  publicKey: Uint8Array, 
  keyType: KeyType, 
  hashTypes: HashType[] = []
): string {
  if (!publicKey || !(publicKey instanceof Uint8Array)) {
    throw new Error('Public key must be a Uint8Array');
  }

  if (!isValidKeyType(keyType)) {
    throw new Error(`Invalid key type: ${keyType}`);
  }

  // Validate all hash types if provided
  for (const hashType of hashTypes) {
    if (!isValidHashType(hashType)) {
      throw new Error(`Invalid hash type: ${hashType}`);
    }
  }

  // If no hash types, address = base58(publicKey) directly (current standard)
  if (hashTypes.length === 0) {
    return bs58.encode(publicKey);
  }

  // Legacy mode: Apply hash chain to public key
  const hashedPublicKey = createHashChain(hashTypes, publicKey);
  return bs58.encode(hashedPublicKey);
}

/**
 * Generate Kalvora address from raw public key bytes with auto-detection
 * 
 * Supports both new format ("A_<base58pubkey>") and legacy format ("A_c_<base58pubkey>").
 */
export function generateAddressFromPublicKey(publicKeyIdentifier: string): string {
  if (!publicKeyIdentifier || typeof publicKeyIdentifier !== 'string') {
    throw new Error('Public key identifier must be a non-empty string');
  }

  // Extract the raw public key bytes from the identifier
  const lastUnderscoreIndex = publicKeyIdentifier.lastIndexOf('_');
  if (lastUnderscoreIndex === -1) {
    throw new Error('Invalid public key identifier: no underscore found');
  }

  const base58Part = publicKeyIdentifier.substring(lastUnderscoreIndex + 1);
  if (!base58Part) {
    throw new Error('Invalid public key identifier: nothing after last underscore');
  }

  try {
    // Decode the base58 part to get raw public key bytes
    const publicKeyBytes = bs58.decode(base58Part);
    
    // Check if this is a new-format identifier (no hash types)
    const hashTypes = getHashTypesFromPublicKey(publicKeyIdentifier);
    
    if (hashTypes.length === 0) {
      // New format: address = base58(publicKey) directly
      return bs58.encode(publicKeyBytes);
    }
    
    // Legacy format: Apply hash chain to public key
    const hashedPublicKey = createHashChain(hashTypes, publicKeyBytes);
    return bs58.encode(hashedPublicKey);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid public key identifier')) {
      throw error;
    }
    throw new Error(`Invalid public key identifier: failed to decode base58 part - ${(error as Error).message}`);
  }
}

/**
 * Parse a base58 public key identifier and extract the address
 */
export function getAddressFromPublicKey(publicKeyIdentifier: string): string {
  // This function now uses the proper address generation
  return generateAddressFromPublicKey(publicKeyIdentifier);
}


/**
 * Validate if a string is a valid Kalvora public key identifier format
 */
export function isValidPublicKeyIdentifier(publicKeyIdentifier: string): boolean {
  try {
    generateAddressFromPublicKey(publicKeyIdentifier);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract key type from public key identifier
 */
export function getKeyTypeFromPublicKey(publicKeyIdentifier: string): KeyType {
  if (!publicKeyIdentifier || typeof publicKeyIdentifier !== 'string') {
    throw new Error('Public key identifier must be a non-empty string');
  }

  // Special cases: sc_ and gov_ don't have key types
  if (publicKeyIdentifier.startsWith(SPECIAL_PREFIXES.SMART_CONTRACT) || publicKeyIdentifier.startsWith(SPECIAL_PREFIXES.GOVERNANCE)) {
    throw new Error(`Special identifiers (${SPECIAL_PREFIXES.SMART_CONTRACT}, ${SPECIAL_PREFIXES.GOVERNANCE}) do not have key types`);
  }

  // Strip restricted key prefix if present
  let identifier = publicKeyIdentifier;
  if (identifier.startsWith('r_')) {
    identifier = identifier.substring(2);
  }

  if (identifier.startsWith(KEY_TYPE_PREFIXES[KEY_TYPE.ED25519])) {
    return KEY_TYPE.ED25519;
  } else if (identifier.startsWith(KEY_TYPE_PREFIXES[KEY_TYPE.ED448])) {
    return KEY_TYPE.ED448;
  } else {
    throw new Error(`Invalid public key identifier: missing key type prefix (${KEY_TYPE_PREFIXES[KEY_TYPE.ED25519]} or ${KEY_TYPE_PREFIXES[KEY_TYPE.ED448]})`);
  }
}

/**
 * Reconstruct public key identifier string from bytes (inverse of getPublicKeyBytes)
 * 
 * The bytes are in the format: [ASCII prefix bytes] + [raw base58-decoded bytes]
 * This function extracts the ASCII prefix and base58-encodes the remaining bytes.
 * 
 * Supports both new format (A_ prefix) and legacy format (A_c_ prefix).
 * 
 * @param bytes - The byte array from getPublicKeyBytes
 * @returns The original public key identifier string (e.g., "A_<base58pubkey>")
 */
export function getPublicKeyIdentifierFromBytes(bytes: Uint8Array): string {
  if (!bytes || !(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new Error('Bytes must be a non-empty Uint8Array');
  }

  // Special cases: check if it starts with sc_ or gov_ (stored as pure UTF-8)
  // These special identifiers were stored as-is with TextEncoder, so decode with TextDecoder
  if (bytes.length >= 3) {
    const byte0 = bytes[0];
    const byte1 = bytes[1];
    const byte2 = bytes[2];
    if (byte0 !== undefined && byte1 !== undefined && byte2 !== undefined) {
      const first3Chars = String.fromCharCode(byte0, byte1, byte2);
      if (first3Chars === 'sc_' || first3Chars === 'gov') {
        return new TextDecoder().decode(bytes);
      }
    }
  }

  // For regular public key identifiers, the format is: [ASCII prefix like "A_" or "A_c_"] + [raw bytes]
  // Find where the ASCII prefix ends by looking for the last underscore in the prefix region.
  // The prefix always ends with '_' and consists only of ASCII chars.

  let lastUnderscoreIndex = -1;
  
  // Scan through the bytes to find ASCII prefix portion
  // Prefix chars: A, B (key types), a, b, c (hash types), _ (separator), r (restricted prefix)
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) break;
    
    if (byte === 0x5F) { // underscore '_'
      lastUnderscoreIndex = i;
    }
    
    // Valid prefix bytes: A-B (65-66), a-c (97-99), _ (95), r (114)
    const isValidPrefixByte = 
      (byte >= 65 && byte <= 66) ||  // A-B
      (byte >= 97 && byte <= 99) ||  // a-c
      byte === 95 ||                   // _
      byte === 114;                    // r
    
    if (!isValidPrefixByte) {
      // We've hit a byte that's not part of the prefix pattern
      break;
    }
  }
  
  if (lastUnderscoreIndex === -1) {
    throw new Error('Invalid public key bytes: no underscore found in prefix');
  }
  
  // The actual prefix ends right after the last underscore found before non-prefix bytes
  const actualPrefixEnd = lastUnderscoreIndex + 1;
  
  // Extract the prefix as ASCII string
  const prefixBytes = bytes.slice(0, actualPrefixEnd);
  const prefix = String.fromCharCode(...prefixBytes);
  
  // Extract the raw bytes and encode as base58
  const rawBytes = bytes.slice(actualPrefixEnd);
  if (rawBytes.length === 0) {
    throw new Error('Invalid public key bytes: no data after prefix');
  }
  
  const base58Part = bs58.encode(rawBytes);
  
  return prefix + base58Part;
}

/**
 * Extract public key identifier with decoded bytes
 */
export function getPublicKeyBytes(publicKeyIdentifier: string): Uint8Array {
  if (!publicKeyIdentifier || typeof publicKeyIdentifier !== 'string') {
    throw new Error('Public key identifier must be a non-empty string');
  }

  // Special cases: if it starts with sc_ or gov_, return as-is
  if (publicKeyIdentifier.startsWith(SPECIAL_PREFIXES.SMART_CONTRACT) || publicKeyIdentifier.startsWith(SPECIAL_PREFIXES.GOVERNANCE)) {
    return new TextEncoder().encode(publicKeyIdentifier);
  }

  // For other cases, take everything after the last underscore and base58 decode it
  const lastUnderscoreIndex = publicKeyIdentifier.lastIndexOf('_');
  if (lastUnderscoreIndex === -1) {
    throw new Error('Invalid public key identifier: no underscore found');
  }

  const prefix = publicKeyIdentifier.substring(0, lastUnderscoreIndex + 1); // Keep prefix part (e.g., "A_" or "A_c_")
  const base58Part = publicKeyIdentifier.substring(lastUnderscoreIndex + 1);
  if (!base58Part) {
    throw new Error('Invalid public key identifier: nothing after last underscore');
  }

  try {
    const decodedBytes = bs58.decode(base58Part);
    // Combine prefix (as UTF-8 bytes) with decoded base58 bytes
    const prefixBytes = new TextEncoder().encode(prefix);
    const result = new Uint8Array(prefixBytes.length + decodedBytes.length);
    result.set(prefixBytes, 0);
    result.set(decodedBytes, prefixBytes.length);
    return result;
  } catch (error) {
    throw new Error(`Invalid public key identifier: failed to decode base58 part - ${(error as Error).message}`);
  }
}

/**
 * Extract hash types from public key identifier
 * 
 * Returns empty array for new-format identifiers (no hash types present).
 * Returns the hash types for legacy-format identifiers.
 */
export function getHashTypesFromPublicKey(publicKeyIdentifier: string): HashType[] {
  if (!publicKeyIdentifier || typeof publicKeyIdentifier !== 'string') {
    throw new Error('Public key identifier must be a non-empty string');
  }

  // Special cases: sc_ and gov_ don't have hash types
  if (publicKeyIdentifier.startsWith(SPECIAL_PREFIXES.SMART_CONTRACT) || publicKeyIdentifier.startsWith(SPECIAL_PREFIXES.GOVERNANCE)) {
    throw new Error(`Special identifiers (${SPECIAL_PREFIXES.SMART_CONTRACT}, ${SPECIAL_PREFIXES.GOVERNANCE}) do not have hash types`);
  }

  let remaining = publicKeyIdentifier;

  // Strip restricted key prefix if present
  if (remaining.startsWith('r_')) {
    remaining = remaining.substring(2);
  }
  
  // Skip key type prefix
  if (remaining.startsWith(KEY_TYPE_PREFIXES[KEY_TYPE.ED25519]) || remaining.startsWith(KEY_TYPE_PREFIXES[KEY_TYPE.ED448])) {
    remaining = remaining.substring(2);
    // Skip the separator underscore if present
    if (remaining.startsWith('_')) {
      remaining = remaining.substring(1);
    }
  } else {
    throw new Error(`Invalid public key identifier: missing key type prefix (${KEY_TYPE_PREFIXES[KEY_TYPE.ED25519]} or ${KEY_TYPE_PREFIXES[KEY_TYPE.ED448]})`);
  }

  // Extract hash types (if any — new format has none)
  const hashTypes: HashType[] = [];
  while (remaining.startsWith(HASH_TYPE_PREFIXES[HASH_TYPE.SHA3_256]) || 
         remaining.startsWith(HASH_TYPE_PREFIXES[HASH_TYPE.SHA3_512]) || 
         remaining.startsWith(HASH_TYPE_PREFIXES[HASH_TYPE.BLAKE3])) {
    if (remaining.startsWith(HASH_TYPE_PREFIXES[HASH_TYPE.SHA3_256])) {
      hashTypes.push(HASH_TYPE.SHA3_256);
      remaining = remaining.substring(2);
    } else if (remaining.startsWith(HASH_TYPE_PREFIXES[HASH_TYPE.SHA3_512])) {
      hashTypes.push(HASH_TYPE.SHA3_512);
      remaining = remaining.substring(2);
    } else if (remaining.startsWith(HASH_TYPE_PREFIXES[HASH_TYPE.BLAKE3])) {
      hashTypes.push(HASH_TYPE.BLAKE3);
      remaining = remaining.substring(2);
    }
    
    // Skip separator underscore if present
    if (remaining.startsWith('_')) {
      remaining = remaining.substring(1);
    }
  }

  // Return empty array for new-format identifiers (no hash types) — this is valid now
  return hashTypes;
}

/**
 * Sanitizes (trims whitespace) and decodes a base58 address string.
 * 
 * @param address - The base58 encoded address string.
 * @returns The decoded address bytes.
 * @throws Error if the address is invalid or cannot be decoded.
 */
export function sanitizeAndDecodeAddress(address: string): Uint8Array {
  if (!address || typeof address !== 'string') {
    throw new Error('Address must be a non-empty string');
  }

  const sanitizedAddress = address.trim();

  if (sanitizedAddress.length === 0) {
    throw new Error('Address cannot be empty');
  }

  try {
    return bs58.decode(sanitizedAddress);
  } catch (error) {
    throw new Error(`Invalid address format: ${(error as Error).message}`);
  }
}
