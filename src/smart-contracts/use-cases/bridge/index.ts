/**
 * Cross-Chain Bridge - Public API
 * 
 * Complete bidirectional Kalvora ↔ Solana bridge SDK.
 * 
 * ## Modules
 * 
 * ### Kalvora (./zera)
 * Kalvora-side bridge operations via the `bridge_proxy` smart contract.
 * 
 * **Outbound (Kalvora → Solana):**
 * - `lockKalvora` / `lockKalvoraAndSend` - Lock Kalvora tokens to bridge out
 * - `burnSol` / `burnSolAndSend` - Burn wrapped SOL tokens
 * 
 * **Inbound (Solana → Kalvora):**
 * - `releaseKalvora` / `releaseKalvoraAndSend` - Release locked Kalvora tokens
 * - `mintSol` / `mintSolAndSend` - Mint wrapped SOL tokens
 * - `createSol` / `createSolAndSend` - Create wrapped SOL token (first time)
 * 
 * ### Solana (./solana)
 * Solana-side bridge operations via on-chain programs.
 * - `SolanaTokenType` - Explicit SOL / SPL / TOKEN2022 selector
 * - `buildLockSolanaTransaction` / `buildReleaseSolanaTransaction`
 * - `buildReleaseSplTransaction` (handles both SPL and SOL)
 * - `buildReleaseToken2022Transaction`
 * - `buildLockSplTransaction` / `buildLockSolTransaction`
 * - `buildLockToken2022Transaction`
 * - `buildMintWrappedTransaction` / `buildMintWrappedExistingTransaction`
 * - `buildBurnWrappedTransaction`
 * - `buildRegisterTokenTransaction`
 * 
 * ### Guardian (./guardian)
 * VAA (Verified Action Approval) helpers for cross-chain attestation.
 * - `submitVAAToSolana` - Fetch VAA + build + submit to Solana (one-liner)
 * - `submitVAAToKalvora` - Fetch VAA + build + submit to Kalvora (one-liner)
 * - `fetchSolanaVAA` / `fetchKalvoraVAA` - Manual VAA fetching
 * 
 * ## Quick Start
 * 
 * ### Kalvora → Solana (Automated)
 * ```typescript
 * import { lockKalvoraAndSend, guardian } from 'kalvora.js';
 * 
 * // Step 1: Lock tokens on Kalvora
 * const txnHash = await lockKalvoraAndSend('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', '10', 'solana-address', pubKey, privKey);
 * 
 * // Step 2: Submit VAA to Solana (one-liner)
 * const result = await guardian.submitVAAToSolana({ txnHash, guardianConfig, connection, payer });
 * ```
 * 
 * ### Solana → Kalvora (Automated)
 * ```typescript
 * import { solana, guardian } from 'kalvora.js';
 * 
 * // Step 1: Lock tokens on Solana
 * const { transaction } = await solana.buildLockSplTransaction({ amount, mint, zeraAddress }, payer, connection);
 * const txSignature = await sendAndConfirmTransaction(connection, transaction, [payer]);
 * 
 * // Step 2: Submit VAA to Kalvora (one-liner)
 * const result = await guardian.submitVAAToKalvora({ txSignature, guardianConfig, kalvoraConfig, publicKeyBase58, privateKeyBase58 });
 * ```
 */

// Kalvora Chain - All bridge operations
export {
  // Outbound: Lock Kalvora to bridge to Solana
  lockKalvora,
  lockKalvoraAndSend,
  
  // Outbound: Burn wrapped SOL to bridge back to Solana
  burnSol,
  burnSolAndSend,
  
  // Inbound: Release locked Kalvora (from Solana lock)
  releaseKalvora,
  releaseKalvoraAndSend,
  
  // Inbound: Mint wrapped SOL (from Solana lock)
  mintSol,
  mintSolAndSend,
  
  // Inbound: Create wrapped SOL (first time mint)
  createSol,
  createSolAndSend,
  
  // Legacy aliases
  bridgeKalvoraToSol,
  bridgeKalvoraToSolAndSend,
  
  // Types
  type BridgeKalvoraOptions,
  type ReleaseKalvoraOptions,
  type MintSolOptions,
  type CreateSolOptions,
  type BurnSolOptions
} from './kalvora/index.js';

// Re-export Solana and Guardian modules as namespaces for cleaner imports
export * as solana from './solana/index.js';
export * as guardian from './guardian/index.js';

// Also export Kalvora as namespace for consistency
export * as zera from './kalvora/index.js';
