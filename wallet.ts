/**
 * kalvora.js/wallet — the wallet and key surface of kalvora.js on its own.
 *
 * Mnemonics, HD derivation, key pairs, and address encoding, with none of the
 * network, protobuf, or transaction code: it depends only on @noble/curves,
 * @noble/hashes, bip39, and bs58, and never touches the network. Use it where
 * a Kalvora key or address is all you need, such as a browser custody layer.
 *
 * HD derivation: Ed25519 follows SLIP-0010 exactly; Ed448, which no standard
 * covers, uses Kalvora's own scheme. See docs/guides/hd-derivation.md.
 *
 * Everything here is also exported, unchanged, from the main `kalvora.js`
 * entry.
 */

export {
  WalletCreationError,
  InvalidKeyTypeError,
  InvalidHashTypeError,
  InvalidMnemonicLengthError,
  InvalidMnemonicError,
  InvalidDerivationPathError,
  InvalidHDParameterError,
  MissingParameterError,
  CryptographicError
} from './src/wallet-creation/errors.js';

export {
  WalletFactory,
  createWallet,
  deriveMultipleWallets,
  createBaseWallet,
  createHDWallet,
  deriveMultipleAddresses,
  getHDWalletInfo,
  generateMnemonicPhrase,
  validateMnemonicPhrase,
  generateSeed,
  buildDerivationPath,
  generateKalvoraAddress,
  generateKalvoraPublicKeyIdentifier,
  generateAddressFromPublicKey,
  CryptoUtils,
  KEY_TYPE,
  HASH_TYPE,
  VALID_KEY_TYPES,
  VALID_HASH_TYPES,
  KEY_TYPE_PREFIXES,
  HASH_TYPE_PREFIXES,
  isValidKeyType,
  isValidHashType,
  KALVORA_TYPE,
  KALVORA_TYPE_HEX,
  KALVORA_SYMBOL,
  KALVORA_NAME,
  SLIP0010_DERIVATION_PATH,
  MNEMONIC_LENGTHS,
  deriveHDPrivateKey,
  type WalletOptions,
  type Wallet,
  type HDOptions,
  type MultipleWalletOptions,
  type KeyType,
  type HashType,
  type MnemonicLength
} from './src/wallet-creation/index.js';
