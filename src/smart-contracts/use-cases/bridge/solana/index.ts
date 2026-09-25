/**
 * Solana Bridge Module
 * 
 * Complete Solana-side bridge functionality for Kalvora ↔ Solana cross-chain transfers.
 * Uses @solana/web3.js for native Solana transaction construction.
 * 
 * ## Quick Start
 * 
 * ```typescript
 * import { Connection, Keypair } from '@solana/web3.js';
 * import { solana } from 'kalvora.js';
 * 
 * // Lock SPL tokens to bridge to Kalvora
 * const connection = new Connection('https://api.mainnet-beta.solana.com');
 * const wallet = Keypair.fromSecretKey(yourSecretKey);
 * 
 * const { transaction } = await solana.buildLockSplTransaction(
 *   {
 *     amount: 1000000n, // 1 USDC
 *     mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint
 *     zeraAddress: 'your-zera-address',
 *   },
 *   wallet.publicKey,
 *   connection
 * );
 * 
 * // Sign and send
 * transaction.sign(wallet);
 * const signature = await connection.sendRawTransaction(transaction.serialize());
 * ```
 * 
 * ## Available Functions
 * 
 * ### User Operations (Bridging)
 * - `buildLockSolanaTransaction` - Lock SOL, SPL, or Token-2022 by token type
 * - `buildLockSplTransaction` - Lock SPL tokens to bridge to Kalvora
 * - `buildLockSolTransaction` - Lock native SOL to bridge to Kalvora  
 * - `buildLockToken2022Transaction` - Lock Token-2022 tokens to bridge to Kalvora
 * - `buildBurnWrappedTransaction` - Burn wrapped Kalvora tokens to bridge back
 * 
 * ### Guardian Operations (Releasing)
 * - `buildReleaseSolanaTransaction` - Release SOL, SPL, or Token-2022 by token type
 * - `buildReleaseSplTransaction` - Release SPL tokens, including SOL (after Kalvora → Solana transfer)
 * - `buildReleaseToken2022Transaction` - Release Token-2022 tokens
 * 
 * ### Utilities
 * - PDA derivation functions for all bridge accounts
 * - Byte encoding utilities for transaction data
 * - Anchor discriminator generation
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
  SolanaBridgeOptions,
  GuardianSignature,
  ReleaseToken2022Options,
  ReleaseSplOptions,
  ReleaseSolOptions,
  LockSolanaOptions,
  ReleaseSolanaOptions,
  LockToken2022Options,
  LockSplOptions,
  LockSolOptions,
  MintWrappedOptions,
  MintWrappedExistingOptions,
  BurnWrappedOptions,
  RequestTokenRegistrationOptions,
  RegisterTokenOptions,
  PauseIncomingOptions,
  PauseCompleteOptions,
  UnpauseOptions,
  UpgradeCoreOptions,
  UpgradeTokenBridgeOptions,
  SetGuardiansOptions,
  SolanaBridgeResult
} from './types.js';

// ============================================================================
// PROGRAM IDs & CONSTANTS
// ============================================================================

export {
  SolanaTokenType,
  BridgeAction,
  type BridgeActionType
} from './constants.js';

export {
  CORE_PROGRAM_ID,
  TOKEN_BRIDGE_PROGRAM_ID,
  METADATA_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  BPF_LOADER_UPGRADEABLE_ID
} from './utils.js';

// ============================================================================
// PDA DERIVATION
// ============================================================================

export {
  deriveRouterSignerPDA,
  deriveRouterSigner2022PDA,
  deriveRouterConfigPDA,
  deriveVerifiedTransferPDA,
  deriveReleasedTransferPDA,
  deriveVaultPDA,
  deriveRateLimitStatePDA,
  deriveTokenRegistrationPDA,
  deriveExtensionWhitelist2022PDA,
  deriveWrappedMintPDA,
  deriveWrappedMintAuthorityPDA,
  deriveLockedTransferPDA,
  deriveMetadataPDA,
  getATA,
  getATAWithProgramId,
  getMintAccountOwner,
  assertToken2022Mint
} from './utils.js';

// ============================================================================
// TRANSACTION BUILDERS
// ============================================================================

export {
  // Token-type routed operations
  buildLockSolanaTransaction,
  buildReleaseSolanaTransaction,

  // Release operations (Guardian-executed, Kalvora → Solana)
  buildReleaseSplTransaction,
  buildReleaseSolTransaction,
  buildReleaseToken2022Transaction,
  
  // Lock operations (User-initiated, Solana → Kalvora)
  buildLockSplTransaction,
  buildLockSolTransaction,
  buildLockToken2022Transaction,
  
  // Wrapped token operations
  buildBurnWrappedTransaction,
  buildMintWrappedTransaction,
  buildMintWrappedExistingTransaction,
  
  // Token registration operations
  buildRequestTokenRegistrationTransaction,
  buildRegisterTokenTransaction,
  
  // Result types
  type LockSolanaTransactionResult,
  type ReleaseSolanaTransactionResult,
  type ReleaseSplResult,
  type ReleaseSolResult,
  type ReleaseToken2022Result,
  type LockSplResult,
  type LockSolResult,
  type LockToken2022Result,
  type BurnWrappedResult,
  type MintWrappedResult,
  type MintWrappedExistingResult,
  type RequestTokenRegistrationResult,
  type RegisterTokenResult
} from './transactions/index.js';

// ============================================================================
// UTILITIES
// ============================================================================

export {
  // Discriminator generation
  generateDiscriminator,
  
  // Borsh encoding
  encodeBorshString,
  encodeBorshOption,
  
  // Hashing
  hashContractId,
  
  // Byte utilities (re-exported from shared)
  hexToBytes,
  bytesToHex,
  concatBytes,
  encodeU64LE,
  encodeU64BE,
  encodeU32LE,
  encodeU32BE,
  encodeU16LE,
  encodeU16BE,
  decodeU64LE,
  decodeU64BE,
  decodeU32LE,
  bytesEqual,
  fixedBytes
} from './utils.js';

// ============================================================================
// SOLANA PRIMITIVES (Re-exports for convenience)
// ============================================================================

export { PublicKey, Connection, Transaction, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
