/**
 * Solana Bridge Constants
 * 
 * Program IDs and other constants for the Solana-side of the Kalvora bridge.
 */

/**
 * Default Solana RPC URL (mainnet-beta)
 */
export const DEFAULT_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

/**
 * Core bridge program ID on Solana mainnet
 */
export const CORE_PROGRAM_ID = 'zera3giq7oM9QJaD6mY1ajGmakv9TZcax5Giky99HD8';

/**
 * Token bridge program ID on Solana mainnet
 */
export const TOKEN_BRIDGE_PROGRAM_ID = 'WrapZ8f88HR8waSp7wR8Vgc68z4hKj3p3i2b81oeSxR';

/**
 * Metaplex token metadata program ID
 */
export const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

/**
 * BPF Loader Upgradeable program ID
 */
export const BPF_LOADER_UPGRADEABLE_ID = 'BPFLoaderUpgradeab1e11111111111111111111111';

/**
 * SPL Token program ID
 */
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Token-2022 program ID
 */
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * SPL Associated Token Account program ID
 */
export const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/**
 * System program ID
 */
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

/**
 * Default VAA version
 */
export const DEFAULT_VAA_VERSION = 1;

/**
 * Default VAA expiry (0 = no expiry)
 */
export const DEFAULT_VAA_EXPIRY = 0;

/**
 * Default event index
 */
export const DEFAULT_EVENT_INDEX = 0;

/**
 * Bridge action codes
 */
export const BridgeAction = {
  /** Release SOL */
  RELEASE_SOL: 0,
  /** Release SPL tokens */
  RELEASE_SPL: 1,
  /** Mint wrapped token (initial creation) */
  MINT_WRAPPED_INIT: 2,
  /** Mint wrapped token (existing token) */
  MINT_WRAPPED: 3,
  /** Register token */
  REGISTER_TOKEN: 4,
  /** Release Token-2022 tokens */
  RELEASE_2022: 5
} as const;

export type BridgeActionType = typeof BridgeAction[keyof typeof BridgeAction];

/**
 * User-facing Solana asset type selector.
 */
export const SolanaTokenType = {
  /** Native SOL */
  SOL: 'SOL',
  /** Classic SPL token */
  SPL: 'SPL',
  /** Token-2022 token */
  TOKEN2022: 'TOKEN2022'
} as const;

export type SolanaTokenTypeValue = typeof SolanaTokenType[keyof typeof SolanaTokenType];
