/**
 * Kalvora Release Transactions
 * 
 * Inbound bridge operations: Release locked Kalvora tokens, mint wrapped SOL tokens,
 * or create new wrapped tokens when receiving from Solana.
 * 
 * ## Functions
 * - `releaseKalvora` - Release locked Kalvora tokens (from Solana lock)
 * - `mintSol` - Mint wrapped SOL tokens (for existing wrapped tokens)
 * - `createSol` - Create wrapped SOL token (first time bridge)
 */

import type { ZeraReleasePayload, ZeraMintPayload, ZeraContractPayload } from '../../../../../../proto/generated/guardian_pb.js';
import { SmartContractExecuteTXN } from '../../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../../execute/index.js';
import type { ReleaseKalvoraOptions, MintSolOptions, CreateSolOptions } from '../types.js';
import { createBridgeTransaction } from '../utils.js';

// ============================================================================
// RELEASE Kalvora (Solana → Kalvora, for locked Kalvora tokens)
// ============================================================================

/**
 * Release locked Kalvora tokens
 * 
 * Called after a user locks tokens on Solana to release the corresponding
 * Kalvora tokens that were previously locked.
 * 
 * @param toZeraAddress - Kalvora address to receive the released tokens
 * @param publicKeyBase58Identifier - Public key of the transaction sender
 * @param privateKeyBase58 - Private key of the transaction sender
 * @param options - Configuration including the guardian payload
 * @returns The created transaction (not yet sent)
 * 
 * @example
 * ```typescript
 * import { guardian, zera } from 'kalvora.js';
 * 
 * // Fetch payload from guardian
 * const payload = await guardian.fetchZeraPayload(solanaTxSignature, guardianConfig);
 * 
 * // Release tokens on Kalvora
 * const hash = await zera.releaseKalvoraAndSend(
 *   zeraAddress,
 *   publicKey,
 *   privateKey,
 *   { payload }
 * );
 * ```
 */
export async function releaseKalvora(
  toZeraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: ReleaseKalvoraOptions
): Promise<SmartContractExecuteTXN> {
  if (!toZeraAddress) throw new Error('toZeraAddress is required');
  if (!options.payload) throw new Error('payload is required');
  
  const { payload } = options;
  
  if (payload.payload.case !== 'releasePayload') {
    throw new Error(`Expected releasePayload, got: ${payload.payload.case}`);
  }
  
  const releasePayload = payload.payload.value as ZeraReleasePayload;
  
  // Separate params matching Rust: release_zera(contract_id, amount, wallet_address, tx_signature, signed_hash, signatures, guardian_keys)
  const signatures = payload.signatures.join('|');
  const guardianKeys = payload.publicKeys.join('|');
  
  const parameterValue = [
    releasePayload.zeraContractId,       // contract_id
    releasePayload.amount,               // amount
    toZeraAddress,                       // wallet_address
    releasePayload.txSignature,          // tx_signature
    payload.signedHash,                  // signed_hash
    signatures,                          // signatures (pipe-separated)
    guardianKeys                         // guardian_keys (pipe-separated)
  ].join(',');
  
  const feeId = options.feeId || releasePayload.zeraContractId;
  
  return createBridgeTransaction(
    'release_zera',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Release Kalvora tokens and send in one call
 */
export async function releaseKalvoraAndSend(
  toZeraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: ReleaseKalvoraOptions
): Promise<string> {
  const txn = await releaseKalvora(
    toZeraAddress, publicKeyBase58Identifier, privateKeyBase58, options
  );
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}

// ============================================================================
// MINT SOL (Solana → Kalvora, for existing wrapped SOL)
// ============================================================================

/**
 * Mint wrapped SOL tokens on Kalvora
 * 
 * Called after a user locks SOL/SPL tokens on Solana to mint the corresponding
 * wrapped tokens on Kalvora. Use this for tokens that already have a wrapped version.
 * 
 * @param toZeraAddress - Kalvora address to receive the minted tokens
 * @param publicKeyBase58Identifier - Public key of the transaction sender
 * @param privateKeyBase58 - Private key of the transaction sender
 * @param options - Configuration including the guardian payload
 * @returns The created transaction (not yet sent)
 */
export async function mintSol(
  toZeraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: MintSolOptions
): Promise<SmartContractExecuteTXN> {
  if (!toZeraAddress) throw new Error('toZeraAddress is required');
  if (!options.payload) throw new Error('payload is required');
  
  const { payload } = options;
  
  if (payload.payload.case !== 'mintPayload') {
    throw new Error(`Expected mintPayload, got: ${payload.payload.case}`);
  }
  
  const mintPayload = payload.payload.value as ZeraMintPayload;
  
  // Format: mint_id,amount,wallet_address,token_price,tx_signature,signed_hash,signatures,guardian_keys
  // Rust fn signature: mint_sol(mint_id, amount, wallet_address, token_price, tx_signature, signed_hash, signatures, guardian_keys)
  const signatures = payload.signatures.join('|');
  const guardianKeys = payload.publicKeys.join('|');
  
  const parameterValue = [
    mintPayload.solanaMintAddress,           // mint_id
    mintPayload.amount,                       // amount
    toZeraAddress,                            // wallet_address
    mintPayload.usdPrice,                     // token_price
    mintPayload.txSignature,                  // tx_signature
    payload.signedHash,                       // signed_hash
    signatures,                               // signatures (pipe-separated)
    guardianKeys                              // guardian_keys (pipe-separated)
  ].join(',');
  
  // Use a default fee token (e.g., Kalvora) for wrapped token minting
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;
  
  return createBridgeTransaction(
    'mint_sol',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Mint wrapped SOL tokens and send in one call
 */
export async function mintSolAndSend(
  toZeraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: MintSolOptions
): Promise<string> {
  const txn = await mintSol(
    toZeraAddress, publicKeyBase58Identifier, privateKeyBase58, options
  );
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}

// ============================================================================
// CREATE SOL (Solana → Kalvora, first-time wrapped token creation)
// ============================================================================

/**
 * Create wrapped SOL token on Kalvora (first time)
 * 
 * Called when a Solana token is being bridged to Kalvora for the first time.
 * This creates the wrapped token contract and mints the initial supply.
 * 
 * @param toZeraAddress - Kalvora address to receive the minted tokens
 * @param publicKeyBase58Identifier - Public key of the transaction sender
 * @param privateKeyBase58 - Private key of the transaction sender
 * @param options - Configuration including the guardian payload
 * @returns The created transaction (not yet sent)
 */
export async function createSol(
  toZeraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: CreateSolOptions
): Promise<SmartContractExecuteTXN> {
  if (!toZeraAddress) throw new Error('toZeraAddress is required');
  if (!options.payload) throw new Error('payload is required');
  
  const { payload } = options;
  
  if (payload.payload.case !== 'contractPayload') {
    throw new Error(`Expected contractPayload, got: ${payload.payload.case}`);
  }
  
  const contractPayload = payload.payload.value as ZeraContractPayload;
  
  // Separate params matching other release functions
  const signatures = payload.signatures.join('|');
  const guardianKeys = payload.publicKeys.join('|');
  
  // Format: symbol,name,denomination,zeraWalletAddress,amount,solanaMintAddress,uri,solanaAuthorizedAddress,txSignature,signedHash,signatures,guardianKeys,usdPrice
  const parameterValue = [
    contractPayload.symbol,
    contractPayload.name,
    contractPayload.denomination,
    toZeraAddress,
    contractPayload.amount,
    contractPayload.solanaMintAddress,
    contractPayload.uri,
    contractPayload.solanaAuthorizedAddress,
    contractPayload.txSignature,
    payload.signedHash,                      // signed_hash
    signatures,                              // signatures (pipe-separated)
    guardianKeys,                            // guardian_keys (pipe-separated)
    contractPayload.usdPrice                 // token_price (last param)
  ].join(',');
  
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;
  
  return createBridgeTransaction(
    'create_sol',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Create wrapped SOL token and send in one call
 */
export async function createSolAndSend(
  toZeraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: CreateSolOptions
): Promise<string> {
  const txn = await createSol(
    toZeraAddress, publicKeyBase58Identifier, privateKeyBase58, options
  );
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
