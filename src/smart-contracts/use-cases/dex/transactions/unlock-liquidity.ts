/**
 * Unlock Liquidity Transaction
 * 
 * Unlocks LP tokens from a Kalvora DEX pool after the lock period has expired.
 * This must be called before `removeLiquidity`.
 * 
 * ## Parameter Format
 * `tokenA,tokenB,feeRate`
 * 
 * @example
 * ```typescript
 * const txn = await unlockLiquidity(
 *   { tokenA: 'solana-SOL000000', tokenB: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', feeRate: 25 },
 *   publicKey, privateKey
 * );
 * ```
 */

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { UnlockLiquidityOptions, DexOptions } from '../types.js';
import { createDexTransaction } from '../utils.js';

// ============================================================================
// UNLOCK LIQUIDITY
// ============================================================================

/**
 * Unlock LP tokens from a Kalvora DEX pool
 * 
 * After the lock timestamp has passed, call this to unlock your LP tokens
 * so they can be removed via `removeLiquidity`.
 * 
 * @param unlock - Unlock parameters (tokens, fee rate)
 * @param publicKeyBase58Identifier - Public key of the liquidity provider
 * @param privateKeyBase58 - Private key of the liquidity provider
 * @param options - Optional transaction configuration
 * @returns The created transaction (not yet sent)
 */
export async function unlockLiquidity(
  unlock: UnlockLiquidityOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: DexOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!unlock.tokenA) throw new Error('tokenA is required');
  if (!unlock.tokenB) throw new Error('tokenB is required');
  if (unlock.feeRate === undefined) throw new Error('feeRate is required');
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  const parameterValue = `${unlock.tokenA},${unlock.tokenB},${unlock.feeRate}`;
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createDexTransaction(
    'unlock_liquidity_pool_tokens',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Unlock liquidity and send in one call
 */
export async function unlockLiquidityAndSend(
  unlock: UnlockLiquidityOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: DexOptions = {}
): Promise<string> {
  const txn = await unlockLiquidity(unlock, publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
