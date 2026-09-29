import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from 'bip39';

import type { HDOptions, MnemonicLength, KeyType } from '../types/index.js';

import { 
  KALVORA_TYPE, 
  MNEMONIC_LENGTHS, 
  DEFAULT_HD_SETTINGS,
  validateSLIP0010Path
} from './constants.js';
import { SLIP0010HDWallet } from './crypto-core.js';
import {
  InvalidMnemonicLengthError,
  InvalidMnemonicError,
  InvalidHDParameterError,
  InvalidDerivationPathError
} from './errors.js';

/**
 * Generate a new BIP39 mnemonic phrase
 */
export function generateMnemonicPhrase(length: MnemonicLength = 24): string {
  if (!MNEMONIC_LENGTHS.includes(length)) {
    throw new InvalidMnemonicLengthError(length, MNEMONIC_LENGTHS);
  }
  
  // Convert word count to entropy bits
  const entropyBits = length === 12 ? 128 : length === 15 ? 160 : length === 18 ? 192 : length === 21 ? 224 : 256;
  
  return generateMnemonic(entropyBits);
}

/**
 * Validate a BIP39 mnemonic phrase
 */
export function validateMnemonicPhrase(mnemonic: string): boolean {
  if (!mnemonic || typeof mnemonic !== 'string') {
    return false;
  }
  
  return validateMnemonic(mnemonic);
}

/**
 * Generate seed from mnemonic and optional passphrase
 */
export function generateSeed(mnemonic: string, passphrase: string = ''): Uint8Array {
  if (!validateMnemonicPhrase(mnemonic)) {
    throw new InvalidMnemonicError(mnemonic, 'Invalid BIP39 mnemonic format');
  }
  
  return mnemonicToSeedSync(mnemonic, passphrase);
}

/**
 * Build SLIP-0010 hardened derivation path for Kalvora
 */
export function buildDerivationPath(options: HDOptions = {}): string {
  const {
    accountIndex = DEFAULT_HD_SETTINGS.accountIndex,
    changeIndex = DEFAULT_HD_SETTINGS.changeIndex,
    addressIndex = DEFAULT_HD_SETTINGS.addressIndex
  } = options;

  // Validate parameters
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new InvalidHDParameterError('accountIndex', accountIndex, 'must be a non-negative integer');
  }
  
  if (changeIndex !== 0 && changeIndex !== 1) {
    throw new InvalidHDParameterError('changeIndex', changeIndex, 'must be 0 or 1');
  }
  
  if (!Number.isInteger(addressIndex) || addressIndex < 0) {
    throw new InvalidHDParameterError('addressIndex', addressIndex, 'must be a non-negative integer');
  }

  // Build SLIP-0010 path: m/44'/5258'/account'/change'/address'
  const path = `m/44'/${KALVORA_TYPE}'/${accountIndex}'/${changeIndex}'/${addressIndex}'`;
  
  if (!validateSLIP0010Path(path)) {
    throw new InvalidDerivationPathError(path, 'Invalid SLIP-0010 path format');
  }
  
  return path;
}

/**
 * Create HD wallet from seed and derivation path
 */
export function createHDWallet(seed: Uint8Array, derivationPath: string, keyType: KeyType): SLIP0010HDWallet {
  if (!seed || seed.length === 0) {
    throw new Error('Seed must be provided and non-empty');
  }
  
  if (!derivationPath || typeof derivationPath !== 'string') {
    throw new Error('Derivation path must be provided');
  }
  
  if (!validateSLIP0010Path(derivationPath)) {
    throw new InvalidDerivationPathError(derivationPath, 'Invalid SLIP-0010 path format');
  }
  
  return new SLIP0010HDWallet(seed, derivationPath, keyType);
}

/**
 * Derive multiple addresses from the same HD wallet
 * 
 * For account-based systems like Kalvora, this increments accountIndex (BIP44 index 2)
 * rather than addressIndex (index 4). This provides:
 * - Hardened key isolation between wallets
 * - Consistent behavior with industry standards (e.g., MetaMask)
 * - Better security model for account-based blockchains
 */
export function deriveMultipleAddresses(
  hdWallet: SLIP0010HDWallet, 
  count: number, 
  startAccountIndex: number = 0
): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('Count must be a positive integer');
  }
  
  if (!Number.isInteger(startAccountIndex) || startAccountIndex < 0) {
    throw new Error('Start account index must be a non-negative integer');
  }
  
  const addresses: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const currentAccountIndex = startAccountIndex + i;
    // Increment accountIndex for account-based systems
    const currentPath = buildDerivationPath({ accountIndex: currentAccountIndex });
    const currentWallet = createHDWallet(hdWallet.seed, currentPath, hdWallet.keyType);
    addresses.push(currentWallet.getAddress());
  }
  
  return addresses;
}

/**
 * Get HD wallet information
 */
export function getHDWalletInfo(): {
  standard: string;
  coinType: number;
  derivationScheme: string;
  supportedLengths: readonly number[];
  defaultSettings: typeof DEFAULT_HD_SETTINGS;
  description: string;
  } {
  return {
    standard: 'BIP32 + BIP39 + SLIP-0010',
    coinType: KALVORA_TYPE,
    derivationScheme: 'slip0010',
    supportedLengths: MNEMONIC_LENGTHS,
    defaultSettings: DEFAULT_HD_SETTINGS,
    description: 'HD wallet implementation following SLIP-0010 for EdDSA curves (Ed25519/Ed448)'
  };
}
