/**
 * Kalvora DEX - Public API
 * 
 * Complete SDK for interacting with the Kalvora decentralized exchange.
 * All operations go through the `zera_dex_proxy` smart contract.
 * 
 * ## Operations
 * 
 * ### Pool Management
 * - `createLiquidityPool` / `createLiquidityPoolAndSend` - Create a new trading pool
 * - `addLiquidity` / `addLiquidityAndSend` - Add tokens to an existing pool
 * - `removeLiquidity` / `removeLiquidityAndSend` - Remove tokens from a pool
 * - `unlockLiquidity` / `unlockLiquidityAndSend` - Unlock LP tokens after lock period
 * 
 * ### Trading
 * - `swap` / `swapAndSend` - Execute a token swap
 * 
 * ## Quick Start
 * 
 * ```typescript
 * import { dex } from 'kalvora.js';
 * 
 * // Create a pool
 * const txn = await dex.createLiquidityPool(
 *   { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-USDC000000', amountA: '1000000000000', amountB: '12000000000', feeRate: 25 },
 *   publicKey, privateKey
 * );
 * 
 * // Swap tokens
 * const hash = await dex.swapAndSend(
 *   { tokenIn: 'solana-SOL000000', tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', amountIn: '5555666', feeRate: 25, slippage: 100 },
 *   publicKey, privateKey
 * );
 * ```
 * 
 * ## Module Structure
 * 
 * ```
 * dex/
 * ├── transactions/            # Transaction builders
 * │   ├── create-pool.ts       # createLiquidityPool
 * │   ├── add-liquidity.ts     # addLiquidity
 * │   ├── remove-liquidity.ts  # removeLiquidity
 * │   ├── unlock-liquidity.ts  # unlockLiquidity
 * │   ├── swap.ts              # swap
 * │   └── index.ts             # Re-exports
 * ├── types.ts                 # Type definitions
 * ├── utils.ts                 # Helper functions
 * ├── tests/                   # Unit tests
 * ├── examples/                # Usage examples
 * ├── README.md                # Documentation
 * └── index.ts                 # Public API (this file)
 * ```
 */

// ============================================================================
// TRANSACTION BUILDERS
// ============================================================================

export {
  // Pool creation
  createLiquidityPool,
  createLiquidityPoolAndSend,

  // Add liquidity
  addLiquidity,
  addLiquidityAndSend,

  // Remove liquidity
  removeLiquidity,
  removeLiquidityAndSend,

  // Unlock LP tokens
  unlockLiquidity,
  unlockLiquidityAndSend,

  // Swap
  swap,
  swapAndSend
} from './transactions/index.js';

// ============================================================================
// TYPES
// ============================================================================

export type {
  DexOptions,
  CreateLiquidityPoolOptions,
  AddLiquidityOptions,
  RemoveLiquidityOptions,
  UnlockLiquidityOptions,
  SwapOptions,
  DexTransactionResult
} from './types.js';

// ============================================================================
// UTILITIES
// ============================================================================

export {
  DEX_CONTRACT_NAME,
  DEX_INSTANCE,
  DEFAULT_LOCK_DURATION,
  computeLockTimestamp,
  createDexTransaction,
  resolveAmount
} from './utils.js';
