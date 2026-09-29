/**
 * Kalvora Staking - Public API
 * 
 * Complete SDK for interacting with the Kalvora staking system.
 * All operations go through the `staking_proxy` smart contract.
 * 
 * ## Staking Types
 * 
 * There are two staking types, determined by which function you call:
 * 
 * ### Liquid Staking
 * Locks tokens for a term with a wallet address for liquid token receipt.
 * Works like a regular stake, but withdrawal can be triggered at any time
 * with a short delay.
 * - `stake` / `stakeAndSend` - Liquid stake tokens for a term
 * - `updateWallet` / `updateWalletAndSend` - Update stake wallet address
 * - `releaseLiquidStake` / `releaseLiquidStakeAndSend` - Trigger withdrawal
 * 
 * ### Instant Staking
 * Locks tokens directly for a term with no liquid token representation.
 * Does not require a wallet address.
 * - `instantStake` / `instantStakeAndSend` - Instant stake tokens
 * - `updateInstantWallet` / `updateInstantWalletAndSend` - Update instant stake wallet
 * - `releaseInstant` / `releaseInstantAndSend` - Release an instant stake
 * 
 * ## Quick Start
 * 
 * ```typescript
 * import { staking } from 'kalvora.js';
 * 
 * // Liquid stake tokens (withdrawal can be triggered anytime)
 * const hash = await staking.stakeAndSend(
 *   { amount: '500000000000', walletAddress: 'Hg6Qz...', term: '6_months' },
 *   publicKey, privateKey, { grpcConfig }
 * );
 * 
 * // Instant stake tokens (no liquid token, no wallet address)
 * const hash2 = await staking.instantStakeAndSend(
 *   { amount: '500000000000', term: '6_months' },
 *   publicKey, privateKey, { grpcConfig }
 * );
 * ```
 * 
 * ## Module Structure
 * 
 * ```
 * staking/
 * ├── transactions/                    # Transaction builders
 * │   ├── stake.ts                     # stake
 * │   ├── update-wallet.ts             # updateWallet
 * │   ├── release-liquid-stake.ts      # releaseLiquidStake
 * │   ├── instant-stake.ts             # instantStake
 * │   ├── release-instant.ts           # releaseInstant
 * │   ├── update-instant-wallet.ts     # updateInstantWallet
 * │   └── index.ts                     # Re-exports
 * ├── types.ts                         # Type definitions
 * ├── utils.ts                         # Helper functions
 * ├── tests/                           # Unit tests
 * ├── examples/                        # Usage examples
 * ├── README.md                        # Documentation
 * └── index.ts                         # Public API (this file)
 * ```
 */

// ============================================================================
// TRANSACTION BUILDERS
// ============================================================================

export {
  // Liquid staking
  stake,
  stakeAndSend,

  // Update wallet (liquid)
  updateWallet,
  updateWalletAndSend,

  // Release liquid stake
  releaseLiquidStake,
  releaseLiquidStakeAndSend,

  // Instant staking
  instantStake,
  instantStakeAndSend,

  // Release instant
  releaseInstant,
  releaseInstantAndSend,

  // Update instant wallet
  updateInstantWallet,
  updateInstantWalletAndSend
} from './transactions/index.js';

// ============================================================================
// TYPES
// ============================================================================

export type {
  StakingOptions,
  StakeOptions,
  UpdateWalletOptions,
  InstantStakeOptions,
  UpdateInstantWalletOptions,
  StakingTransactionResult
} from './types.js';

// ============================================================================
// UTILITIES
// ============================================================================

export {
  STAKING_CONTRACT_NAME,
  STAKING_INSTANCE,
  createStakingTransaction
} from './utils.js';
