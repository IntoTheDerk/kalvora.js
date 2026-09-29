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

import { SmartContractExecuteTXN } from '../../../../../../proto/generated/txn_pb.js';
import type {
  KalvoraGuardianContractPayload,
  KalvoraGuardianMintPayload,
  KalvoraGuardianReleasePayload
} from '../../../../../protocol/guardian-names.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../../execute/index.js';
import type { ReleaseKalvoraOptions, MintSolOptions, CreateSolOptions } from '../types.js';
import { BRIDGE_FUNCTIONS, createBridgeTransaction } from '../utils.js';

// ============================================================================
// RELEASE Kalvora (Solana → Kalvora, for locked Kalvora tokens)
// ============================================================================

/**
 * Release locked Kalvora tokens
 * 
 * Called after a user locks tokens on Solana to release the corresponding
 * Kalvora tokens that were previously locked.
 * 
 * @param toKalvoraAddress - Kalvora address to receive the released tokens
 * @param publicKeyBase58Identifier - Public key of the transaction sender
 * @param privateKeyBase58 - Private key of the transaction sender
 * @param options - Configuration including the guardian payload
 * @returns The created transaction (not yet sent)
 * 
 * @example
 * ```typescript
 * import { guardianBridge, releaseKalvoraAndSend } from 'kalvora.js';
 * 
 * // Fetch the guardian-signed payload for the Solana lock transaction
 * const payload = await guardianBridge.fetchKalvoraVAA(solanaTxSignature, guardianConfig);
 * 
 * // Release tokens on Kalvora
 * const hash = await releaseKalvoraAndSend(
 *   kalvoraAddress,
 *   publicKey,
 *   privateKey,
 *   { payload }
 * );
 * ```
 */
export async function releaseKalvora(
  toKalvoraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: ReleaseKalvoraOptions
): Promise<SmartContractExecuteTXN> {
  if (!toKalvoraAddress) throw new Error('toKalvoraAddress is required');
  if (!options.payload) throw new Error('payload is required');
  
  const { payload } = options;
  
  if (payload.payload.case !== 'releasePayload') {
    throw new Error(`Expected releasePayload, got: ${payload.payload.case}`);
  }
  
  const releasePayload = payload.payload.value as KalvoraGuardianReleasePayload;
  
  // Separate params matching the contract's release function (BRIDGE_FUNCTIONS.releaseKalvora):
  // (contract_id, amount, wallet_address, tx_signature, signed_hash, signatures, guardian_keys)
  const signatures = payload.signatures.join('|');
  const guardianKeys = payload.publicKeys.join('|');
  
  const parameterValue = [
    releasePayload.zeraContractId,       // contract_id (generated guardian proto field)
    releasePayload.amount,               // amount
    toKalvoraAddress,                       // wallet_address
    releasePayload.txSignature,          // tx_signature
    payload.signedHash,                  // signed_hash
    signatures,                          // signatures (pipe-separated)
    guardianKeys                         // guardian_keys (pipe-separated)
  ].join(',');
  
  const feeId = options.feeId || releasePayload.zeraContractId;
  
  return createBridgeTransaction(
    BRIDGE_FUNCTIONS.releaseKalvora,
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
  toKalvoraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: ReleaseKalvoraOptions
): Promise<string> {
  const txn = await releaseKalvora(
    toKalvoraAddress, publicKeyBase58Identifier, privateKeyBase58, options
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
 * @param toKalvoraAddress - Kalvora address to receive the minted tokens
 * @param publicKeyBase58Identifier - Public key of the transaction sender
 * @param privateKeyBase58 - Private key of the transaction sender
 * @param options - Configuration including the guardian payload
 * @returns The created transaction (not yet sent)
 */
export async function mintSol(
  toKalvoraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: MintSolOptions
): Promise<SmartContractExecuteTXN> {
  if (!toKalvoraAddress) throw new Error('toKalvoraAddress is required');
  if (!options.payload) throw new Error('payload is required');
  
  const { payload } = options;
  
  if (payload.payload.case !== 'mintPayload') {
    throw new Error(`Expected mintPayload, got: ${payload.payload.case}`);
  }
  
  const mintPayload = payload.payload.value as KalvoraGuardianMintPayload;
  
  // Format: mint_id,amount,wallet_address,token_price,tx_signature,signed_hash,signatures,guardian_keys
  // Rust fn signature: mint_sol(mint_id, amount, wallet_address, token_price, tx_signature, signed_hash, signatures, guardian_keys)
  const signatures = payload.signatures.join('|');
  const guardianKeys = payload.publicKeys.join('|');
  
  const parameterValue = [
    mintPayload.solanaMintAddress,           // mint_id
    mintPayload.amount,                       // amount
    toKalvoraAddress,                            // wallet_address
    mintPayload.usdPrice,                     // token_price
    mintPayload.txSignature,                  // tx_signature
    payload.signedHash,                       // signed_hash
    signatures,                               // signatures (pipe-separated)
    guardianKeys                              // guardian_keys (pipe-separated)
  ].join(',');
  
  // Use a default fee token (e.g., Kalvora) for wrapped token minting
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;
  
  return createBridgeTransaction(
    BRIDGE_FUNCTIONS.mintSol,
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
  toKalvoraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: MintSolOptions
): Promise<string> {
  const txn = await mintSol(
    toKalvoraAddress, publicKeyBase58Identifier, privateKeyBase58, options
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
 * @param toKalvoraAddress - Kalvora address to receive the minted tokens
 * @param publicKeyBase58Identifier - Public key of the transaction sender
 * @param privateKeyBase58 - Private key of the transaction sender
 * @param options - Configuration including the guardian payload
 * @returns The created transaction (not yet sent)
 */
export async function createSol(
  toKalvoraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: CreateSolOptions
): Promise<SmartContractExecuteTXN> {
  if (!toKalvoraAddress) throw new Error('toKalvoraAddress is required');
  if (!options.payload) throw new Error('payload is required');
  
  const { payload } = options;
  
  if (payload.payload.case !== 'contractPayload') {
    throw new Error(`Expected contractPayload, got: ${payload.payload.case}`);
  }
  
  const contractPayload = payload.payload.value as KalvoraGuardianContractPayload;
  
  // Separate params matching other release functions
  const signatures = payload.signatures.join('|');
  const guardianKeys = payload.publicKeys.join('|');
  
  // Format: symbol,name,denomination,walletAddress,amount,solanaMintAddress,uri,solanaAuthorizedAddress,txSignature,signedHash,signatures,guardianKeys,usdPrice
  const parameterValue = [
    contractPayload.symbol,
    contractPayload.name,
    contractPayload.denomination,
    toKalvoraAddress,
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
    BRIDGE_FUNCTIONS.createSol,
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
  toKalvoraAddress: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: CreateSolOptions
): Promise<string> {
  const txn = await createSol(
    toKalvoraAddress, publicKeyBase58Identifier, privateKeyBase58, options
  );
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
