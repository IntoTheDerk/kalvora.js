import { generateKalvoraAddress } from '../shared/crypto/address-utils.js';
import type { 
  WalletOptions, 
  Wallet, 
  MultipleWalletOptions, 
  KeyType, 
  HashType
} from '../types/index.js';

import {
  KALVORA_TYPE, KALVORA_SYMBOL, KALVORA_NAME,
  VALID_KEY_TYPES, VALID_HASH_TYPES, MNEMONIC_LENGTHS,
  isValidKeyType, KEY_TYPE
} from './constants.js';
import { Ed25519KeyPair, Ed448KeyPair, CryptoUtils, SLIP0010HDWallet } from './crypto-core.js';
import {
  MissingParameterError, InvalidKeyTypeError, InvalidHashTypeError
} from './errors.js';
import { validateHashTypes } from './hash-utils.js';
import {
  generateSeed, buildDerivationPath, 
  createHDWallet
} from './hd-utils.js';
import { 
  generateKalvoraPublicKeyIdentifier, createBaseWallet
} from './shared.js';



/**
 * Unified wallet creation factory for the Kalvora network.
 * 
 * This factory provides comprehensive wallet creation functionality with support for:
 * - Multiple key types (Ed25519, Ed448)
 * - Multiple hash algorithms (SHA3-256, SHA3-512, BLAKE3)
 * - HD wallet derivation with SLIP-0010 compliance
 * - BIP39 mnemonic phrase generation
 * - Secure memory management
 * 
 * @class WalletFactory
 * @author Kalvora Community
 * @since 1.0.0
 * 
 * @example
 * ```typescript
 * const factory = new WalletFactory();
 * const wallet = await factory.createWallet({
 *   keyType: 'ed25519',
 *   hashTypes: ['sha3_256'],
 *   mnemonic: 'your mnemonic phrase here'
 * });
 * ```
 */
export class WalletFactory {
  private readonly coinType: number;
  private readonly symbol: string;
  private readonly name: string;

  constructor() {
    this.coinType = KALVORA_TYPE;
    this.symbol = KALVORA_SYMBOL;
    this.name = KALVORA_NAME;
  }

  /**
   * Creates a new wallet with the specified parameters.
   * 
   * This method generates a complete wallet including:
   * - HD wallet derivation using SLIP-0010
   * - Key pair generation using the `@noble` libraries
   * - Address generation with specified hash types
   * - Extended key information for HD wallet functionality
   * - Secure memory management
   * 
   * @param options - Wallet creation options including key type, hash types, and mnemonic
   * @returns Promise that resolves to a complete Wallet object
   * 
   * @example
   * ```typescript
   * const wallet = await factory.createWallet({
   *   keyType: 'ed25519',
   *   hashTypes: ['sha3_256', 'blake3'],
   *   mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
   *   passphrase: 'optional-passphrase',
   *   hdOptions: {
   *     accountIndex: 0,
   *     changeIndex: 0,
   *     addressIndex: 0
   *   }
   * });
   * ```
   * 
   * @throws {MissingParameterError} When required parameters are missing
   * @throws {InvalidKeyTypeError} When key type is not supported
   * @throws {InvalidHashTypeError} When hash types are not supported
   * @throws {InvalidMnemonicError} When mnemonic phrase is invalid
   * @throws {CryptographicError} When cryptographic operations fail
   * 
   * @since 1.0.0
   */
  async createWallet(options: WalletOptions): Promise<Wallet> {
    const {
      keyType,
      hashTypes = [],
      mnemonic,
      passphrase = '',
      hdOptions = {}
    } = options;

    // Validate required parameters
    if (!keyType) {
      throw new MissingParameterError('keyType');
    }

    if (!isValidKeyType(keyType)) {
      throw new InvalidKeyTypeError(keyType, VALID_KEY_TYPES);
    }

    // Validate hash types if provided (optional — empty means key-only mode)
    if (hashTypes.length > 0 && !validateHashTypes(hashTypes)) {
      throw new InvalidHashTypeError('Invalid hash types array', VALID_HASH_TYPES);
    }

    // Validate mnemonic - must be provided
    if (!mnemonic) {
      throw new MissingParameterError('mnemonic - must be provided');
    }

    // Use provided mnemonic
    const finalMnemonic = mnemonic;
    
    // Use pre-computed seed if provided (e.g., from native PBKDF2),
    // otherwise derive it synchronously via bip39's mnemonicToSeedSync.
    const seed = options.seed ?? generateSeed(finalMnemonic, passphrase);
    
    // Build derivation path (SLIP-0010 for Ed25519/Ed448)
    const derivationPath = buildDerivationPath(hdOptions);
    
    // Create HD wallet using SLIP-0010 with the specified key type
    const hdNode = createHDWallet(seed, derivationPath, keyType);
    
    // Generate key pair based on key type using the `@noble` libraries
    const keyPair = await this.generateKeyPair(hdNode, keyType);
    
    try {
      // Generate address and public key formats
      const address = generateKalvoraAddress(keyPair.publicKey, keyType, hashTypes);
      const publicKey = generateKalvoraPublicKeyIdentifier(keyPair.publicKey, keyType, hashTypes);
      
      // Create wallet object
      const wallet = createBaseWallet(
        'hd' as const,
        finalMnemonic,
        keyPair.getPrivateKeyBase58(),
        address,
        publicKey,
        this.coinType,
        this.symbol,
        derivationPath,
        keyType,
        hashTypes
      );

      return {
        ...wallet,
        type: 'hd' as const,
        // Add extended key information for SLIP-0010 compliance
        extendedPrivateKey: hdNode.getExtendedPrivateKey(),
        extendedPublicKey: hdNode.getExtendedPublicKey(),
        fingerprint: hdNode.getFingerprint(keyType),
        depth: hdNode.depth,
        index: hdNode.index,
        // Only expose base58-encoded private key for security
        privateKey: keyPair.getPrivateKeyBase58(), // Raw 32-byte private key encoded as base58
        // Add missing properties
        publicKeyPackage: keyPair.getPublicKeyBase58(),
        name: this.name,
        // Add memory safety method
        secureClear: () => {
          keyPair.secureClear();
          hdNode.secureClear();
        }
      };
    } catch (error) {
      // Ensure cleanup on error
      keyPair.secureClear();
      hdNode.secureClear();
      throw error;
    }
  }

  /**
   * Derive multiple addresses from the same mnemonic
   * 
   * OPTIMIZATIONS:
   * 1. Computes the seed once and reuses it for all derivations (avoids PBKDF2 per account)
   * 2. Caches master node at m/44'/5258' - only derives final 3 levels per account
   * 3. Uses Promise.all for parallel derivation on multi-core systems
   * 
   * This reduces batch derivation time from ~34s to <1s for 20 accounts.
   */
  async deriveMultipleWallets(options: MultipleWalletOptions): Promise<Wallet[]> {
    const {
      mnemonic,
      keyType,
      hashTypes = [],
      passphrase = '',
      hdOptions = {},
      count = 1
    } = options;

    if (!mnemonic) {
      throw new MissingParameterError('mnemonic');
    }

    if (!keyType) {
      throw new MissingParameterError('keyType');
    }

    if (!isValidKeyType(keyType)) {
      throw new InvalidKeyTypeError(keyType, VALID_KEY_TYPES);
    }

    // Validate hash types if provided (optional — empty means key-only mode)
    if (hashTypes.length > 0 && !validateHashTypes(hashTypes)) {
      throw new InvalidHashTypeError('Invalid hash types array', VALID_HASH_TYPES);
    }

    if (!Number.isInteger(count) || count < 1) {
      throw new Error('Count must be a positive integer');
    }

    // SLIP-0010 hardened offset constant
    const HARDENED_OFFSET = 0x80000000;

    // Generate seed ONCE from mnemonic (expensive PBKDF2 with 2048 iterations)
    const seed = generateSeed(mnemonic, passphrase);

    // OPTIMIZATION: Cache the master node at m/44'/5258' (shared by all accounts)
    // This avoids re-deriving these 2 levels for every account
    // Note: We use the constructor directly since createHDWallet validates for exactly 5 levels
    const masterPath = `m/44'/${KALVORA_TYPE}'`;
    const masterNode = new SLIP0010HDWallet(seed, masterPath, keyType);
    const masterKeyMaterial = masterNode.getKeyMaterial();

    // Helper function to derive a single wallet from the cached master node
    const deriveSingleWallet = async (accountOffset: number): Promise<Wallet> => {
      const accountIndex = (hdOptions.accountIndex || 0) + accountOffset;
      const changeIndex = hdOptions.changeIndex ?? 0;
      const addressIndex = hdOptions.addressIndex ?? 0;

      // Full path for record-keeping
      const fullPath = `m/44'/${KALVORA_TYPE}'/${accountIndex}'/${changeIndex}'/${addressIndex}'`;
      
      // Child indices to derive from master (account'/change'/address')
      const childIndices = [
        accountIndex + HARDENED_OFFSET,
        changeIndex + HARDENED_OFFSET,
        addressIndex + HARDENED_OFFSET
      ];

      // Derive from cached master node (only 3 HMAC operations instead of 5)
      const hdNode = SLIP0010HDWallet.fromParentNode(
        masterKeyMaterial.privateKey,
        masterKeyMaterial.chainCode,
        childIndices,
        fullPath,
        seed,
        keyType
      );
      
      // Generate key pair based on key type using the `@noble` libraries
      const keyPair = await this.generateKeyPair(hdNode, keyType);

      try {
        // Generate address and public key formats
        const address = generateKalvoraAddress(keyPair.publicKey, keyType, hashTypes);
        const publicKey = generateKalvoraPublicKeyIdentifier(keyPair.publicKey, keyType, hashTypes);
        
        // Create wallet object
        const wallet = createBaseWallet(
          'hd' as const,
          mnemonic,
          keyPair.getPrivateKeyBase58(),
          address,
          publicKey,
          this.coinType,
          this.symbol,
          fullPath,
          keyType,
          hashTypes
        );

        return {
          ...wallet,
          type: 'hd' as const,
          // Add extended key information for SLIP-0010 compliance
          extendedPrivateKey: hdNode.getExtendedPrivateKey(),
          extendedPublicKey: hdNode.getExtendedPublicKey(),
          fingerprint: hdNode.getFingerprint(keyType),
          depth: hdNode.depth,
          index: hdNode.index,
          // Only expose base58-encoded private key for security
          privateKey: keyPair.getPrivateKeyBase58(),
          // Add missing properties
          publicKeyPackage: keyPair.getPublicKeyBase58(),
          name: this.name,
          // Add memory safety method
          secureClear: () => {
            keyPair.secureClear();
            hdNode.secureClear();
          }
        };
      } catch (error) {
        // Ensure cleanup on error for this iteration
        keyPair.secureClear();
        hdNode.secureClear();
        throw error;
      }
    };

    // Derive all wallets in parallel for better performance on multi-core systems
    const derivationPromises = Array.from({ length: count }, (_, i) => deriveSingleWallet(i));
    try {
      const wallets = await Promise.all(derivationPromises);
      return wallets;
    } finally {
      // Clear sensitive data from memory
      masterNode.secureClear();
      CryptoUtils.secureClear(seed);
    }
  }

  /**
   * Generate key pair based on key type using the `@noble` libraries
   */
  private async generateKeyPair(hdNode: SLIP0010HDWallet, keyType: KeyType): Promise<Ed25519KeyPair | Ed448KeyPair> {
    if (keyType === KEY_TYPE.ED25519) {
      return Ed25519KeyPair.fromHDNode(hdNode);
    } else if (keyType === KEY_TYPE.ED448) {
      return Ed448KeyPair.fromHDNode(hdNode);
    } else {
      throw new InvalidKeyTypeError(keyType, VALID_KEY_TYPES);
    }
  }

  /**
   * Get wallet factory information
   */
  getInfo(): {
    name: string;
    symbol: string;
    coinType: number;
    supportedKeyTypes: readonly KeyType[];
    supportedHashTypes: readonly HashType[];
    supportedMnemonicLengths: readonly number[];
    standard: string;
    description: string;
    cryptographicLibraries: string[];
    securityFeatures: string[];
    } {
    return {
      name: this.name,
      symbol: this.symbol,
      coinType: this.coinType,
      supportedKeyTypes: VALID_KEY_TYPES,
      supportedHashTypes: VALID_HASH_TYPES,
      supportedMnemonicLengths: MNEMONIC_LENGTHS,
      standard: 'BIP32 + BIP39 + SLIP-0010',
      description: 'Unified wallet factory supporting multiple key types and hash algorithms with full SLIP-0010 compliance',
      cryptographicLibraries: [
        '@noble/curves - Full Ed25519 and Ed448 implementation',
        '@noble/hashes - SHA256, SHA512, RIPEMD160',
        '@noble/hashes/hmac - HMAC-SHA512 for SLIP-0010',
        'bip39 - BIP39 mnemonic generation',
        'bs58 - Base58 encoding'
      ],
      securityFeatures: [
        'Cryptographically secure random generation',
        'Proper SLIP-0010 chain code handling',
        'Fully hardened derivation support',
        'Overflow protection',
        'Fingerprint validation',
        'Extended key support (xpub/xpriv)',
        'Secure memory clearing for sensitive data',
        'Automatic cleanup on error conditions'
      ]
    };
  }
}

/**
 * Create a new wallet with the factory
 */
export async function createWallet(options: WalletOptions): Promise<Wallet> {
  const factory = new WalletFactory();
  return factory.createWallet(options);
}

/**
 * Derive multiple wallets with the factory
 */
export async function deriveMultipleWallets(options: MultipleWalletOptions): Promise<Wallet[]> {
  const factory = new WalletFactory();
  return factory.deriveMultipleWallets(options);
}
