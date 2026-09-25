/**
 * Bridge - Kalvora Chain Operations (Public API)
 * 
 * Complete Kalvora-side bridge functionality via the `bridge_proxy` smart contract.
 * 
 * ## Outbound (Kalvora → Solana)
 * - `lockKalvora` / `lockKalvoraAndSend` - Lock Kalvora tokens to bridge out
 * - `burnSol` / `burnSolAndSend` - Burn wrapped SOL tokens
 * 
 * ## Inbound (Solana → Kalvora)
 * - `releaseKalvora` / `releaseKalvoraAndSend` - Release locked Kalvora tokens
 * - `mintSol` / `mintSolAndSend` - Mint wrapped SOL tokens
 * - `createSol` / `createSolAndSend` - Create wrapped SOL token (first time)
 * 
 * ## Legacy Aliases
 * - `bridgeKalvoraToSol` = `lockKalvora`
 * - `bridgeKalvoraToSolAndSend` = `lockKalvoraAndSend`
 * 
 * ## Module Structure
 * 
 * ```
 * zera/
 * ├── transactions/       # Transaction builders
 * │   ├── lock.ts         # lockKalvora, burnSol
 * │   ├── release.ts      # releaseKalvora, mintSol, createSol
 * │   └── index.ts        # Re-exports all transactions
 * ├── types.ts            # Type definitions
 * ├── utils.ts            # Helper functions
 * └── index.ts            # Public API (this file)
 * ```
 */

// ============================================================================
// TRANSACTION BUILDERS
// ============================================================================

export {
  // Lock Kalvora (Kalvora → Solana)
  lockKalvora,
  lockKalvoraAndSend,
  
  // Burn wrapped SOL (Kalvora → Solana)
  burnSol,
  burnSolAndSend,
  
  // Release Kalvora (Solana → Kalvora)
  releaseKalvora,
  releaseKalvoraAndSend,
  
  // Mint wrapped SOL (Solana → Kalvora)
  mintSol,
  mintSolAndSend,
  
  // Create wrapped SOL (Solana → Kalvora, first time)
  createSol,
  createSolAndSend,
  
  // Legacy aliases
  bridgeKalvoraToSol,
  bridgeKalvoraToSolAndSend
} from './transactions/index.js';

// ============================================================================
// TYPES
// ============================================================================

export type {
  BridgeKalvoraOptions,
  BurnSolOptions,
  ReleaseKalvoraOptions,
  MintSolOptions,
  CreateSolOptions,
  LockKalvoraResult,
  ReleaseKalvoraResult,
  MintSolResult,
  CreateSolResult,
  BurnSolResult
} from './types.js';

// ============================================================================
// UTILITIES
// ============================================================================

export {
  BRIDGE_CONTRACT_NAME,
  BRIDGE_INSTANCE,
  formatGuardianSignatures,
  createBridgeTransaction
} from './utils.js';
