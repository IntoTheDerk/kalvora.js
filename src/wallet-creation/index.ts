// Import the new unified wallet factory system
import {
  WalletFactory
} from './wallet-factory.js';

// Import HD wallet utilities

// Import hash utilities

// Import types


// Re-export the new unified factory functions and utilities
export {
  WalletFactory,
  createWallet,
  deriveMultipleWallets
} from './wallet-factory.js';

// Re-export shared utilities
export {
  generateKalvoraPublicKeyIdentifier, createBaseWallet
} from './shared.js';

// Re-export HD utilities
export {
  generateMnemonicPhrase,
  buildDerivationPath,
  generateSeed,
  validateMnemonicPhrase,
  createHDWallet,
  deriveMultipleAddresses,
  getHDWalletInfo
} from './hd-utils.js';

// Re-export address utilities
export { generateKalvoraAddress, generateAddressFromPublicKey } from '../shared/crypto/address-utils.js';

// Re-export crypto utilities
export { CryptoUtils } from './crypto-core.js';

// Re-export error classes
export * from './errors.js';

// Re-export types
export type {
  WalletOptions,
  Wallet,
  HDOptions,
  MultipleWalletOptions,
  KeyType,
  HashType,
  MnemonicLength
} from '../types/index.js';

// Re-export constants and enums
export {
  KALVORA_TYPE, KALVORA_TYPE_HEX, KALVORA_SYMBOL, KALVORA_NAME, SLIP0010_DERIVATION_PATH,
  KEY_TYPE, HASH_TYPE, VALID_KEY_TYPES, VALID_HASH_TYPES, MNEMONIC_LENGTHS,
  KEY_TYPE_PREFIXES, HASH_TYPE_PREFIXES, isValidKeyType, isValidHashType
} from './constants.js';

export default WalletFactory;
