import bs58 from 'bs58';

import type { KeyType, HashType } from '../types/index.js';

import { 
  KEY_TYPE_PREFIXES, 
  HASH_TYPE_PREFIXES,
  isValidKeyType,
  isValidHashType
} from './constants.js';

// ============================================================================
// WALLET INTERFACES
// ============================================================================

/**
 * Base wallet interface
 */
export interface BaseWallet {
  type: string;
  mnemonic: string;
  privateKey: string;
  address: string;
  publicKey: string;
  coinType: number;
  symbol: string;
  derivationPath: string;
  keyType: KeyType;
  hashTypes?: HashType[];
}

/**
 * Sanitized wallet interface for logging
 */
export interface SanitizedWallet {
  type: string;
  address: string;
  publicKey: string | undefined;
  coinType: number;
  symbol: string;
  derivationPath: string;
  keyType: KeyType;
  hashTypes?: HashType[];
  mnemonic: string;
  privateKey: string;
}

/**
 * Generate Kalvora public key identifier (human-readable format with type prefixes)
 * 
 * Current standard (hashTypes empty or omitted):
 *   Format: KeyPrefix_PublicKeyBase58
 *   Example: "A_5KJvsngHeMby884zrh6A5u6b4SqzZzAb"
 * 
 * Legacy format (hashTypes provided):
 *   Format: KeyPrefix_HashPrefix_PublicKeyBase58
 *   Example: "A_c_5KJvsngHeMby884zrh6A5u6b4SqzZzAb"
 */
export function generateKalvoraPublicKeyIdentifier(
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

  // Get key type prefix
  const keyPrefix = KEY_TYPE_PREFIXES[keyType];
  
  // Encode public key to base58
  const publicKeyBase58 = bs58.encode(publicKey);

  // If no hash types, use new format: KeyPrefix_PublicKeyBase58
  if (!hashTypes || hashTypes.length === 0) {
    return `${keyPrefix}_${publicKeyBase58}`;
  }

  // Legacy mode: validate and include hash type prefixes
  for (const hashType of hashTypes) {
    if (!isValidHashType(hashType)) {
      throw new Error(`Invalid hash type: ${hashType}`);
    }
  }

  // Get hash type prefixes (sorted for consistency)
  const sortedHashTypes = [...hashTypes].sort();
  const hashPrefixes = sortedHashTypes.map(hashType => HASH_TYPE_PREFIXES[hashType]).join('_');
  
  // Combine all parts: KeyPrefix_HashPrefixes_PublicKeyBase58
  return `${keyPrefix}_${hashPrefixes}_${publicKeyBase58}`;
}

/**
 * Create base wallet object with common properties
 */
export function createBaseWallet(
  type: string,
  mnemonic: string,
  privateKey: string,
  address: string,
  publicKey: string,
  coinType: number,
  symbol: string,
  derivationPath: string,
  keyType: KeyType,
  hashTypes: HashType[] = []
): BaseWallet {
  return {
    type,
    mnemonic,
    privateKey,
    address,
    publicKey,
    coinType,
    symbol,
    derivationPath,
    keyType,
    ...(hashTypes.length > 0 ? { hashTypes } : {})
  };
}

/**
 * Validate wallet object structure
 */
export function validateWalletObject(wallet: BaseWallet): boolean {
  // Validate specific field types
  if (typeof wallet.type !== 'string') return false;
  if (typeof wallet.mnemonic !== 'string') return false;
  if (typeof wallet.privateKey !== 'string') return false;
  if (typeof wallet.address !== 'string') return false;
  if (typeof wallet.publicKey !== 'string') return false;
  if (typeof wallet.coinType !== 'number') return false;
  if (typeof wallet.symbol !== 'string') return false;
  if (typeof wallet.derivationPath !== 'string') return false;
  if (!isValidKeyType(wallet.keyType)) return false;
  // hashTypes is now optional — if present, validate it
  if (wallet.hashTypes !== undefined) {
    if (!Array.isArray(wallet.hashTypes)) return false;
    for (const ht of wallet.hashTypes) {
      if (!isValidHashType(ht)) return false;
    }
  }

  return true;
}

/**
 * Sanitize wallet object for safe logging (removes sensitive data)
 */
export function sanitizeWalletForLogging(wallet: BaseWallet): SanitizedWallet {
  return {
    type: wallet.type,
    address: wallet.address,
    publicKey: wallet.publicKey ? `${wallet.publicKey.substring(0, 10)}...` : undefined,
    coinType: wallet.coinType,
    symbol: wallet.symbol,
    derivationPath: wallet.derivationPath,
    keyType: wallet.keyType,
    ...(wallet.hashTypes ? { hashTypes: wallet.hashTypes } : {}),
    // Never log sensitive data
    mnemonic: '[REDACTED]',
    privateKey: '[REDACTED]'
  };
}

/**
 * Create wallet summary for display
 */
export function createWalletSummary(wallet: BaseWallet): string {
  if (!validateWalletObject(wallet)) {
    return 'Invalid wallet object';
  }

  const hashTypesStr = wallet.hashTypes?.length ? wallet.hashTypes.join(', ') : 'none';
  return `Wallet Summary:
  Type: ${wallet.type}
  Address: ${wallet.address}
  Key Type: ${wallet.keyType}
  Hash Types: ${hashTypesStr}
  Derivation Path: ${wallet.derivationPath}
  Coin Type: ${wallet.coinType}
  Symbol: ${wallet.symbol}`;
}
