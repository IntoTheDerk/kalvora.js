/**
 * Solana Bridge Types
 * 
 * Type definitions for Solana bridge operations.
 * These types represent the parameters and options for interacting with
 * the Solana-side of the Kalvora bridge.
 */

/**
 * Base options for all Solana bridge operations
 */
export interface SolanaBridgeOptions {
  /** Solana RPC URL (defaults to mainnet) */
  rpcUrl?: string;
  /** Commitment level for transactions */
  commitment?: 'processed' | 'confirmed' | 'finalized';
  /** Core program ID (defaults to mainnet address) */
  coreProgramId?: string;
  /** Token bridge program ID (defaults to mainnet address) */
  tokenBridgeProgramId?: string;
  /** Metadata program ID (Metaplex, defaults to mainnet address) */
  metadataProgramId?: string;
}

/**
 * Guardian signature for VAA verification
 */
export interface GuardianSignature {
  /** Base58-encoded signature */
  signature: string;
  /** Base58-encoded public key */
  publicKey: string;
}

export type { SolanaTokenTypeValue as SolanaTokenType } from './constants.js';

/**
 * Options for releasing SPL tokens on Solana
 */
export interface ReleaseSplOptions extends SolanaBridgeOptions {
  /** Amount in smallest units (lamports equivalent for the token) */
  amount: bigint | string;
  /** Recipient Solana address */
  recipient: string;
  /** SPL token mint address */
  mint: string;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Timestamp of the original Kalvora transaction */
  timestamp: number;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
  /** USD price in nano units (for rate limiting) */
  usdPriceNano: bigint | string;
  /** Liquidity in USD nano units (for rate limiting) */
  liquidityUsdNano: bigint | string;
  /** Tier level for rate limiting (0-255) */
  tier: number;
}

/**
 * Options for releasing Token-2022 tokens on Solana
 */
export interface ReleaseToken2022Options extends SolanaBridgeOptions {
  /** Amount in smallest units */
  amount: bigint | string;
  /** Recipient Solana address */
  recipient: string;
  /** Token-2022 mint address */
  mint: string;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Timestamp of the original Kalvora transaction */
  timestamp: number;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
  /** USD price in nano units (for rate limiting) */
  usdPriceNano: bigint | string;
  /** Liquidity in USD nano units (for rate limiting) */
  liquidityUsdNano: bigint | string;
  /** Tier level for rate limiting (0-255) */
  tier: number;
}

/**
 * Options for releasing native SOL on Solana
 */
export interface ReleaseSolOptions extends SolanaBridgeOptions {
  /** Amount in lamports */
  amount: bigint | string;
  /** Recipient Solana address */
  recipient: string;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Timestamp of the original Kalvora transaction */
  timestamp: number;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
  /** USD amount for rate limiting */
  usdAmount: bigint | string;
}

/**
 * Options for locking SPL tokens to bridge to Kalvora
 */
export interface LockSplOptions extends SolanaBridgeOptions {
  /** Amount in smallest units */
  amount: bigint | string;
  /** Kalvora address to receive the bridged tokens */
  zeraAddress: string;
  /** SPL token mint address */
  mint: string;
}

/**
 * Options for locking Token-2022 tokens to bridge to Kalvora
 */
export interface LockToken2022Options extends SolanaBridgeOptions {
  /** Amount in smallest units */
  amount: bigint | string;
  /** Kalvora address to receive the bridged tokens */
  zeraAddress: string;
  /** Token-2022 mint address */
  mint: string;
}

/**
 * Options for locking native SOL to bridge to Kalvora
 */
export interface LockSolOptions extends SolanaBridgeOptions {
  /** Amount in lamports */
  amount: bigint | string;
  /** Kalvora address to receive the bridged tokens */
  zeraAddress: string;
}

/**
 * Token-type routed lock options.
 *
 * Use this when the caller wants one Solana-side lock entrypoint and chooses
 * the asset path explicitly with tokenType.
 */
export type LockSolanaOptions =
  | (LockSolOptions & { tokenType: 'SOL' })
  | (LockSplOptions & { tokenType: 'SPL' })
  | (LockToken2022Options & { tokenType: 'TOKEN2022' });

/**
 * Token-type routed release options.
 *
 * Use this when the caller wants one Solana-side release entrypoint and chooses
 * the asset path explicitly with tokenType.
 */
export type ReleaseSolanaOptions =
  | (ReleaseSolOptions & { tokenType: 'SOL' })
  | (ReleaseSplOptions & { tokenType: 'SPL' })
  | (ReleaseToken2022Options & { tokenType: 'TOKEN2022' });

/**
 * Options for minting wrapped tokens (new token initialization)
 */
export interface MintWrappedOptions extends SolanaBridgeOptions {
  /** Amount to mint in smallest units */
  amount: bigint | string;
  /** Recipient Solana address */
  recipient: string;
  /** Kalvora contract ID (used to derive mint PDA) */
  contractId: string;
  /** Token decimals */
  decimals: number;
  /** Token name */
  name: string;
  /** Token symbol */
  symbol: string;
  /** Token metadata URI */
  uri: string;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Timestamp of the original Kalvora transaction */
  timestamp: number;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
  /** USD price in nano units (for rate limiting) */
  usdPriceNano: bigint | string;
  /** Liquidity in USD nano units (for rate limiting) */
  liquidityUsdNano: bigint | string;
  /** Tier level for rate limiting (0-255) */
  tier: number;
}

/**
 * Options for minting wrapped tokens (existing token)
 */
export interface MintWrappedExistingOptions extends SolanaBridgeOptions {
  /** Amount to mint in smallest units */
  amount: bigint | string;
  /** Recipient Solana address */
  recipient: string;
  /** Kalvora contract ID (used to derive mint PDA) */
  contractId: string;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Timestamp of the original Kalvora transaction */
  timestamp: number;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
  /** USD price in nano units (for rate limiting) */
  usdPriceNano: bigint | string;
  /** Liquidity in USD nano units (for rate limiting) */
  liquidityUsdNano: bigint | string;
  /** Tier level for rate limiting (0-255) */
  tier: number;
}

/**
 * Options for burning wrapped tokens to bridge back to Kalvora
 */
export interface BurnWrappedOptions extends SolanaBridgeOptions {
  /** Amount to burn in smallest units */
  amount: bigint | string;
  /** Wrapped token mint address on Solana */
  wrappedMint: string;
  /** Kalvora address to receive the unlocked tokens */
  zeraRecipient: string;
}

/**
 * Options for requesting token registration (permissionless)
 */
export interface RequestTokenRegistrationOptions extends SolanaBridgeOptions {
  /** SPL or Token-2022 token mint address to register */
  mint: string;
  /**
   * Token program that owns the mint.
   * Defaults to the classic SPL token program when no Connection is supplied.
   * With a Connection, builders detect the mint owner and fail if the mint is
   * missing or owned by an unsupported program. Pass TOKEN_2022_PROGRAM_ID to
   * force Token-2022 without an RPC mint-owner lookup.
   */
  tokenProgramId?: string;
}

/**
 * Options for completing token registration (guardian-attested)
 */
export interface RegisterTokenOptions extends SolanaBridgeOptions {
  /** SPL or Token-2022 token mint address to register */
  mint: string;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Timestamp of the attestation */
  timestamp: number;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
  /** USD price in nano units */
  usdPriceNano: bigint | string;
  /** Liquidity in USD nano units */
  liquidityUsdNano: bigint | string;
  /** Tier level (0-255) */
  tier: number;
  /**
   * Token program that owns the mint.
   * Defaults to the classic SPL token program when no Connection is supplied.
   * With a Connection, builders detect the mint owner and fail if the mint is
   * missing or owned by an unsupported program. Pass TOKEN_2022_PROGRAM_ID to
   * force Token-2022 without an RPC mint-owner lookup.
   */
  tokenProgramId?: string;
}

/**
 * Options for pausing incoming transfers (Level 1)
 */
export interface PauseIncomingOptions extends SolanaBridgeOptions {
  /** Duration in seconds (0 = indefinite) */
  durationSeconds: number;
  /** Timestamp of the pause request */
  timestamp: number;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
}

/**
 * Options for complete pause (Level 2 - full freeze)
 */
export interface PauseCompleteOptions extends SolanaBridgeOptions {
  /** Duration in seconds (0 = indefinite) */
  durationSeconds: number;
  /** Timestamp of the pause request */
  timestamp: number;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
}

/**
 * Options for unpausing the bridge
 */
export interface UnpauseOptions extends SolanaBridgeOptions {
  /** Timestamp of the unpause request */
  timestamp: number;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
}

/**
 * Options for upgrading the core program
 */
export interface UpgradeCoreOptions extends SolanaBridgeOptions {
  /** Timestamp of the upgrade request */
  timestamp: number;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Buffer address containing the new program code */
  bufferAddress: string;
  /** Spill address for the old program data */
  spillAddress: string;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
}

/**
 * Options for upgrading the token bridge program
 */
export interface UpgradeTokenBridgeOptions extends SolanaBridgeOptions {
  /** Timestamp of the upgrade request */
  timestamp: number;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Buffer address containing the new program code */
  bufferAddress: string;
  /** Spill address for the old program data */
  spillAddress: string;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
}

/**
 * Options for setting new guardians
 */
export interface SetGuardiansOptions extends SolanaBridgeOptions {
  /** Timestamp of the set guardians request */
  timestamp: number;
  /** Transaction ID (hex encoded, 32 bytes) */
  txnId: string;
  /** Array of new guardian public keys (base58 encoded) */
  newGuardians: string[];
  /** New threshold for multi-sig (must be <= guardian count) */
  newThreshold: number;
  /** Guardian signatures for VAA verification */
  signatures: GuardianSignature[];
  /** Expected hash of the VAA (hex encoded) */
  expectedHash: string;
}

/**
 * Result from a Solana bridge transaction
 */
export interface SolanaBridgeResult {
  /** Transaction signature */
  signature: string;
  /** Whether the transaction was successful */
  success: boolean;
  /** Optional error message if failed */
  error?: string;
}
