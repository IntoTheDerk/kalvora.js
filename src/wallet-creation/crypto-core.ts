import { ed25519 } from '@noble/curves/ed25519.js';
import { ed448 } from '@noble/curves/ed448.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import bs58 from 'bs58';

import { KEY_TYPE } from '../shared/crypto/constants.js';
import type { KeyType } from '../types/index.js';

import { EXTENDED_KEY_VERSIONS, SLIP0010_DERIVATION_PATH } from './constants.js';

// HD derivation constants.
//
// Ed25519 follows SLIP-0010 exactly (https://github.com/satoshilabs/slips/blob/master/slip-0010.md):
//   master = HMAC-SHA512(key = "ed25519 seed", data = seed)
//   child  = HMAC-SHA512(key = chainCode, data = 0x00 || privateKey || ser32BE(index))
// and only hardened children exist.
//
// SLIP-0010 does not define Ed448, and no other standard does. Ed448 therefore
// keeps Kalvora's own scheme, unchanged since the first release:
//   master = HMAC-SHA512(key = "Kalvora seed", data = seed)
//   child  = HMAC-SHA512(key = chainCode, data = ser32LE(index) || privateKey)
// and the 32-byte node key is expanded to a 57-byte Ed448 key by Ed448KeyPair.
// Changing either scheme changes every address derived from every mnemonic.
const SLIP0010_HARDENED_OFFSET = 0x80000000;
const SLIP0010_ED25519_SEED_KEY = 'ed25519 seed';
const KALVORA_ED448_SEED_KEY = 'Kalvora seed';
const SLIP0010_PRIVATE_KEY_LENGTH = 32;

/**
 * Utility functions for byte manipulation
 */
const ByteUtils = {
  /**
   * Convert Uint8Array to Uint32
   */
  bytesToUint32(bytes: Uint8Array, littleEndian: boolean = false): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getUint32(0, littleEndian);
  },

  /**
   * Convert Uint32 to Uint8Array
   */
  uint32ToBytes(value: number, littleEndian: boolean = false): Uint8Array {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, value, littleEndian);
    return new Uint8Array(buffer);
  },

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
  },

  /**
   * Secure memory clearing
   */
  secureClear(bytes: Uint8Array): void {
    if (bytes && bytes.length > 0) {
      bytes.fill(0);
    }
  }
};

type HDNode = { privateKey: Uint8Array; chainCode: Uint8Array };

function splitNode(hmacResult: Uint8Array): HDNode {
  return {
    privateKey: hmacResult.slice(0, SLIP0010_PRIVATE_KEY_LENGTH),
    chainCode: hmacResult.slice(SLIP0010_PRIVATE_KEY_LENGTH)
  };
}

/** The master node for `seed` under the scheme for `keyType`. */
function deriveMasterNode(seed: Uint8Array, keyType: KeyType): HDNode {
  const seedKey = keyType === KEY_TYPE.ED448 ? KALVORA_ED448_SEED_KEY : SLIP0010_ED25519_SEED_KEY;
  return splitNode(hmac(sha512, new TextEncoder().encode(seedKey), seed));
}

/**
 * One child step under the scheme for `keyType`. `index` already includes the
 * hardened offset when the segment is hardened.
 */
function deriveChildNode(parent: HDNode, index: number, keyType: KeyType): HDNode {
  if (keyType === KEY_TYPE.ED448) {
    const data = ByteUtils.concat(ByteUtils.uint32ToBytes(index, true), parent.privateKey);
    return splitNode(hmac(sha512, parent.chainCode, data));
  }

  if (index < SLIP0010_HARDENED_OFFSET) {
    throw new Error('SLIP-0010 Ed25519 supports hardened derivation only; every path segment must end in \'.');
  }
  const data = ByteUtils.concat(
    new Uint8Array([0]),
    parent.privateKey,
    ByteUtils.uint32ToBytes(index, false)
  );
  return splitNode(hmac(sha512, parent.chainCode, data));
}

/** Parses `m/…` into child indices, hardened segments carrying the offset. */
function parseDerivationPath(path: string): number[] {
  if (!path.startsWith('m/')) {
    throw new Error('Invalid derivation path: must start with "m/"');
  }

  const parts = path.split('/').slice(1);
  return parts.map(part => {
    if (part.endsWith("'")) {
      return parseInt(part.slice(0, -1)) + SLIP0010_HARDENED_OFFSET;
    } else {
      return parseInt(part);
    }
  });
}

/**
 * Derives the 32-byte private key at `path` from `seed`, and nothing else.
 *
 * Ed25519 uses SLIP-0010, so the result is the standard SLIP-0010 key for that
 * seed and path; Ed448 uses Kalvora's scheme, and its 32-byte node key is what
 * Ed448KeyPair expands. Unlike SLIP0010HDWallet, this neither keeps a
 * reference to `seed` nor returns chain codes: every intermediate node is
 * zeroed, and the returned key is the caller's to zero.
 */
export function deriveHDPrivateKey(
  seed: Uint8Array,
  path: string = SLIP0010_DERIVATION_PATH,
  keyType: KeyType = KEY_TYPE.ED25519
): Uint8Array {
  const indices = parseDerivationPath(path);
  let node = deriveMasterNode(seed, keyType);
  try {
    for (const index of indices) {
      const child = deriveChildNode(node, index, keyType);
      node.privateKey.fill(0);
      node.chainCode.fill(0);
      node = child;
    }
    return node.privateKey.slice();
  } finally {
    node.privateKey.fill(0);
    node.chainCode.fill(0);
  }
}

/**
 * HD wallet for EdDSA curves: SLIP-0010 for Ed25519, Kalvora's own scheme for
 * Ed448 (see the constants above).
 */
export class SLIP0010HDWallet {
  public readonly seed: Uint8Array;
  public readonly derivationPath: string;
  public readonly keyType: KeyType;
  public readonly depth: number;
  public readonly index: number;
  public readonly chainCode: Uint8Array;
  public readonly privateKey: Uint8Array;
  public readonly publicKey: Uint8Array;

  constructor(seed: Uint8Array, derivationPath: string, keyType: KeyType) {
    this.seed = seed;
    this.derivationPath = derivationPath;
    this.keyType = keyType;
    
    // Parse derivation path
    const pathParts = parseDerivationPath(derivationPath);
    this.depth = pathParts.length - 1;
    this.index = pathParts[pathParts.length - 1] || 0;
    
    // Derive keys
    const derived = this.deriveKeys(seed, pathParts);
    this.chainCode = derived.chainCode;
    this.privateKey = derived.privateKey;
    this.publicKey = derived.publicKey;
  }

  /**
   * Create an HD wallet from an existing parent node's key material.
   * This avoids re-deriving the full path from seed when we have a cached parent.
   * 
   * @param parentPrivateKey - The parent node's private key
   * @param parentChainCode - The parent node's chain code
   * @param childPath - The remaining path to derive (e.g., "0'/0'/0'" for account/change/address)
   * @param fullPath - The full derivation path for record-keeping
   * @param seed - Original seed (kept for compatibility)
   * @param keyType - Key type (ed25519 or ed448)
   */
  static fromParentNode(
    parentPrivateKey: Uint8Array,
    parentChainCode: Uint8Array,
    childIndices: number[],
    fullPath: string,
    seed: Uint8Array,
    keyType: KeyType
  ): SLIP0010HDWallet {
    // Create a minimal instance to use private methods
    const instance = Object.create(SLIP0010HDWallet.prototype) as SLIP0010HDWallet;
    
    // Derive from parent
    let currentPrivateKey = parentPrivateKey;
    let currentChainCode = parentChainCode;
    
    for (const index of childIndices) {
      const derived = deriveChildNode(
        { privateKey: currentPrivateKey, chainCode: currentChainCode },
        index,
        keyType
      );
      currentPrivateKey = derived.privateKey;
      currentChainCode = derived.chainCode;
    }
    
    // Generate public key
    const publicKey = instance.generatePublicKeyStatic(currentPrivateKey, keyType);
    
    // Set all readonly properties via Object.defineProperty
    Object.defineProperty(instance, 'seed', { value: seed, writable: false });
    Object.defineProperty(instance, 'derivationPath', { value: fullPath, writable: false });
    Object.defineProperty(instance, 'keyType', { value: keyType, writable: false });
    Object.defineProperty(instance, 'depth', { value: fullPath.split('/').length - 1, writable: false });
    Object.defineProperty(instance, 'index', { value: childIndices[childIndices.length - 1] || 0, writable: false });
    Object.defineProperty(instance, 'chainCode', { value: currentChainCode, writable: false });
    Object.defineProperty(instance, 'privateKey', { value: currentPrivateKey, writable: false });
    Object.defineProperty(instance, 'publicKey', { value: publicKey, writable: false });
    
    return instance;
  }

  /**
   * Static version of generatePublicKey for use in fromParentNode
   */
  private generatePublicKeyStatic(privateKey: Uint8Array, keyType: KeyType): Uint8Array {
    if (keyType === KEY_TYPE.ED25519) {
      return ed25519.getPublicKey(privateKey);
    } else if (keyType === KEY_TYPE.ED448) {
      const ed448KeyPair = new Ed448KeyPair(privateKey);
      return ed448KeyPair.publicKey;
    } else {
      throw new Error(`Unsupported key type: ${keyType}`);
    }
  }

  /**
   * Get the intermediate key material for caching.
   * Returns private key and chain code that can be used with fromParentNode.
   */
  getKeyMaterial(): { privateKey: Uint8Array; chainCode: Uint8Array } {
    return {
      privateKey: this.privateKey,
      chainCode: this.chainCode
    };
  }

  /**
   * Derive the node at `pathIndices` from `seed`: SLIP-0010 for Ed25519,
   * Kalvora's scheme for Ed448.
   */
  private deriveKeys(seed: Uint8Array, pathIndices: number[]): {
    chainCode: Uint8Array;
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  } {
    let node = deriveMasterNode(seed, this.keyType);
    for (const index of pathIndices) {
      node = deriveChildNode(node, index, this.keyType);
    }

    return {
      chainCode: node.chainCode,
      privateKey: node.privateKey,
      publicKey: this.generatePublicKey(node.privateKey)
    };
  }

  /**
   * Generate public key from private key
   */
  private generatePublicKey(privateKey: Uint8Array): Uint8Array {
    if (this.keyType === KEY_TYPE.ED25519) {
      return ed25519.getPublicKey(privateKey);
    } else if (this.keyType === KEY_TYPE.ED448) {
      // For ED448, we need to expand the 32-byte SLIP-0010 seed to 57-byte private key
      const ed448KeyPair = new Ed448KeyPair(privateKey);
      return ed448KeyPair.publicKey;
    } else {
      throw new Error(`Unsupported key type: ${this.keyType}`);
    }
  }

  /**
   * Get wallet address
   */
  getAddress(): string {
    // This would typically involve address generation logic
    // For now, return a placeholder
    return bs58.encode(this.publicKey);
  }

  /**
   * Get extended private key
   */
  getExtendedPrivateKey(): string {
    const version = EXTENDED_KEY_VERSIONS.PRIVATE;
    const versionBytes = ByteUtils.uint32ToBytes(version, false);
    const depthByte = new Uint8Array([this.depth]);
    const indexBytes = ByteUtils.uint32ToBytes(this.index, false);
    const chainCodeBytes = this.chainCode;
    const privateKeyBytes = this.privateKey;
    
    const extendedKey = ByteUtils.concat(
      versionBytes,
      depthByte,
      indexBytes,
      chainCodeBytes,
      privateKeyBytes
    );
    
    return bs58.encode(extendedKey);
  }

  /**
   * Get extended public key
   */
  getExtendedPublicKey(): string {
    const version = EXTENDED_KEY_VERSIONS.PUBLIC;
    const versionBytes = ByteUtils.uint32ToBytes(version, false);
    const depthByte = new Uint8Array([this.depth]);
    const indexBytes = ByteUtils.uint32ToBytes(this.index, false);
    const chainCodeBytes = this.chainCode;
    const publicKeyBytes = this.publicKey;
    
    const extendedKey = ByteUtils.concat(
      versionBytes,
      depthByte,
      indexBytes,
      chainCodeBytes,
      publicKeyBytes
    );
    
    return bs58.encode(extendedKey);
  }

  /**
   * Get private key in base58 format
   */
  getPrivateKeyBase58(): string {
    return bs58.encode(this.privateKey);
  }

  /**
   * Get fingerprint
   */
  getFingerprint(_keyType: KeyType): string {
    const hash = sha256(this.publicKey);
    return ByteUtils.toHex(hash.slice(0, 4));
  }

  /**
   * Secure memory clearing
   */
  secureClear(): void {
    ByteUtils.secureClear(this.seed);
    ByteUtils.secureClear(this.privateKey);
    ByteUtils.secureClear(this.chainCode);
  }
}

/**
 * Ed25519 Key Pair implementation
 */
export class Ed25519KeyPair {
  private readonly privateKey: Uint8Array;
  public readonly publicKey: Uint8Array;

  constructor(privateKey?: Uint8Array) {
    if (privateKey) {
      this.privateKey = privateKey;
      this.publicKey = ed25519.getPublicKey(privateKey);
    } else {
      this.privateKey = ed25519.utils.randomSecretKey();
      this.publicKey = ed25519.getPublicKey(this.privateKey);
    }
  }

  /**
   * Create from HD wallet node
   */
  static fromHDNode(hdNode: SLIP0010HDWallet): Ed25519KeyPair {
    return new Ed25519KeyPair(hdNode.privateKey);
  }

  /**
   * Create from private key bytes
   */
  static fromPrivateKey(privateKey: Uint8Array): Ed25519KeyPair {
    return new Ed25519KeyPair(privateKey);
  }

  /**
   * Get private key as base58
   */
  getPrivateKeyBase58(): string {
    return bs58.encode(this.privateKey);
  }

  /**
   * Get public key as base58
   */
  getPublicKeyBase58(): string {
    return bs58.encode(this.publicKey);
  }

  /**
   * Sign data
   */
  sign(data: Uint8Array): Uint8Array {
    return ed25519.sign(data, this.privateKey);
  }

  /**
   * Verify signature
   */
  verify(signature: Uint8Array, data: Uint8Array): boolean {
    return ed25519.verify(signature, data, this.publicKey);
  }

  /**
   * Secure memory clearing
   */
  secureClear(): void {
    ByteUtils.secureClear(this.privateKey);
  }
}

/**
 * Ed448 Key Pair implementation
 */
export class Ed448KeyPair {
  private readonly privateKey: Uint8Array;
  public readonly publicKey: Uint8Array;

  constructor(privateKey?: Uint8Array) {
    if (privateKey) {
      // Handle both 32-byte SLIP0010 seeds and 57-byte ED448 private keys
      if (privateKey.length === 32) {
        // Expand 32-byte SLIP0010 seed to 57-byte ED448 private key using SHA3-256
        this.privateKey = this.expandSeedToPrivateKey(privateKey);
      } else if (privateKey.length === 57) {
        // Direct 57-byte ED448 private key
        this.privateKey = privateKey;
      } else {
        throw new Error(`Invalid private key length: ${privateKey.length}. Expected 32 (SLIP0010 seed) or 57 (ED448 private key) bytes.`);
      }
      this.publicKey = ed448.getPublicKey(this.privateKey);
    } else {
      this.privateKey = ed448.utils.randomSecretKey();
      this.publicKey = ed448.getPublicKey(this.privateKey);
    }
  }

  /**
   * Expand 32-byte SLIP0010 seed to 57-byte ED448 private key
   * This follows the original JavaScript implementation using SHA3-256 + HMAC-SHA512
   */
  private expandSeedToPrivateKey(privateKey: Uint8Array): Uint8Array {
    // Validate input
    if (privateKey.length !== 32) {
      throw new Error('SLIP-0010 private key must be 32 bytes');
    }
    
    // Step 1: Create deterministic seed using SHA3-256
    const seed = sha3_256(privateKey);
    
    // Step 2: Secure key expansion using HMAC-SHA512
    const expanded = hmac(sha512, seed, new TextEncoder().encode('ed448-expansion'));
    const expanded57 = expanded.slice(0, 57);
    
    // Step 3: Apply Ed448 clamping (clear bits 0 and 1 of the last byte)
    const clamped = new Uint8Array(expanded57);
    if (clamped.length >= 57) {
      clamped[56] = (clamped[56] || 0) & 0xFC; // Clear bits 0 and 1
    }
    
    return clamped;
  }

  /**
   * Create from HD wallet node
   */
  static fromHDNode(hdNode: SLIP0010HDWallet): Ed448KeyPair {
    return new Ed448KeyPair(hdNode.privateKey);
  }

  /**
   * Create from private key bytes
   */
  static fromPrivateKey(privateKey: Uint8Array): Ed448KeyPair {
    return new Ed448KeyPair(privateKey);
  }

  /**
   * Get private key as base58
   */
  getPrivateKeyBase58(): string {
    return bs58.encode(this.privateKey);
  }

  /**
   * Get public key as base58
   */
  getPublicKeyBase58(): string {
    return bs58.encode(this.publicKey);
  }

  /**
   * Sign data
   */
  sign(data: Uint8Array): Uint8Array {
    return ed448.sign(data, this.privateKey);
  }

  /**
   * Verify signature
   */
  verify(signature: Uint8Array, data: Uint8Array): boolean {
    return ed448.verify(signature, data, this.publicKey);
  }

  /**
   * Secure memory clearing
   */
  secureClear(): void {
    ByteUtils.secureClear(this.privateKey);
  }
}

/**
 * Cryptographic utilities
 */
export const CryptoUtils = {
  /**
   * Generate random private key
   */
  randomPrivateKey(keyType: KeyType): Uint8Array {
    if (keyType === KEY_TYPE.ED25519) {
      return ed25519.utils.randomSecretKey();
    } else if (keyType === KEY_TYPE.ED448) {
      return ed448.utils.randomSecretKey();
    } else {
      throw new Error(`Unsupported key type: ${keyType}`);
    }
  },

  /**
   * Generate public key from private key
   */
  getPublicKey(privateKey: Uint8Array, keyType: KeyType): Uint8Array {
    if (keyType === KEY_TYPE.ED25519) {
      return ed25519.getPublicKey(privateKey);
    } else if (keyType === KEY_TYPE.ED448) {
      return ed448.getPublicKey(privateKey);
    } else {
      throw new Error(`Unsupported key type: ${keyType}`);
    }
  },

  /**
   * Secure memory clearing
   */
  secureClear(data: Uint8Array): void {
    ByteUtils.secureClear(data);
  }
};
