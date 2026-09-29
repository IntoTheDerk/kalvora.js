/**
 * Swap Transaction
 * 
 * Executes a token swap on the Kalvora DEX.
 * `amountIn` is specified in user-friendly units and auto-converted.
 * 
 * ## Parameter Format
 * `tokenIn,tokenOut,amountIn,feeRate,platformFeeBps,platformFeeAddress`
 * 
 * @example
 * ```typescript
 * const txn = await swap(
 *   { tokenIn: 'solana-SOL000000', tokenOut: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', amountIn: '5.5', feeRate: 25, platformFeeBps: 100, platformFeeAddress: 'EW9iaR8...' },
 *   publicKey, privateKey
 * );
 * ```
 */

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { SwapOptions, DexOptions } from '../types.js';
import { createDexTransaction, resolveAmount } from '../utils.js';

// ============================================================================
// SWAP
// ============================================================================

/**
 * Execute a token swap on the Kalvora DEX
 * 
 * Swaps `amountIn` of `tokenIn` for `tokenOut` through the specified fee-rate pool.
 * Amount is specified in user-friendly units (e.g., '5.5' for 5.5 tokens).
 * Platform fee is specified in basis points (e.g., 100 = 1%) and sent to the given address.
 * 
 * @param swapOpts - Swap parameters (tokens, user-friendly amount, fee rate, platform fee)
 * @param publicKeyBase58Identifier - Public key of the swapper
 * @param privateKeyBase58 - Private key of the swapper
 * @param options - Optional transaction configuration
 * @returns The created transaction (not yet sent)
 */
export async function swap(
  swapOpts: SwapOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: DexOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!swapOpts.tokenIn) throw new Error('tokenIn is required');
  if (!swapOpts.tokenOut) throw new Error('tokenOut is required');
  if (!swapOpts.amountIn && swapOpts.amountIn !== 0) throw new Error('amountIn is required');
  if (swapOpts.feeRate === undefined) throw new Error('feeRate is required');
  if (swapOpts.platformFeeBps === undefined) throw new Error('platformFeeBps is required');
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;

  // Convert user-friendly amount to smallest units
  const amountInParts = await resolveAmount(swapOpts.amountIn, swapOpts.tokenIn, grpcConfig);

  // platformFeeAddress defaults to empty string if not provided
  const platformFeeAddress = swapOpts.platformFeeAddress ?? '';
  const parameterValue = `${swapOpts.tokenIn},${swapOpts.tokenOut},${amountInParts},${swapOpts.feeRate},${swapOpts.platformFeeBps},${platformFeeAddress}`;
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createDexTransaction(
    'swap',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Swap tokens and send in one call
 */
export async function swapAndSend(
  swapOpts: SwapOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: DexOptions = {}
): Promise<string> {
  const txn = await swap(swapOpts, publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}

