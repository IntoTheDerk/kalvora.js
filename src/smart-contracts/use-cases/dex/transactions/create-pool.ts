/**
 * Create Liquidity Pool Transaction
 * 
 * Creates a new liquidity pool on the Kalvora DEX with an initial token pair and amounts.
 * Amounts are specified in user-friendly units (e.g., '100' for 100 tokens) and
 * automatically converted to smallest units via the token info API.
 * 
 * ## Parameter Format
 * `tokenA,tokenB,amountA,amountB,feeRate,lockTimestamp`
 * 
 * @example
 * ```typescript
 * const txn = await createLiquidityPool(
 *   { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-USDC000000', amountA: '100', amountB: '12', feeRate: 25 },
 *   publicKey, privateKey
 * );
 * ```
 */

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { CreateLiquidityPoolOptions, DexOptions } from '../types.js';
import { createDexTransaction, computeLockTimestamp, resolveAmount } from '../utils.js';

// ============================================================================
// CREATE LIQUIDITY POOL
// ============================================================================

/**
 * Create a new liquidity pool on the Kalvora DEX
 * 
 * @param pool - Pool configuration (tokens, amounts in user-friendly units, fee rate)
 * @param publicKeyBase58Identifier - Public key of the pool creator
 * @param privateKeyBase58 - Private key of the pool creator
 * @param options - Optional transaction configuration
 * @returns The created transaction (not yet sent)
 */
export async function createLiquidityPool(
  pool: CreateLiquidityPoolOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: DexOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!pool.tokenA) throw new Error('tokenA is required');
  if (!pool.tokenB) throw new Error('tokenB is required');
  if (!pool.amountA && pool.amountA !== 0) throw new Error('amountA is required');
  if (!pool.amountB && pool.amountB !== 0) throw new Error('amountB is required');
  if (pool.feeRate === undefined) throw new Error('feeRate is required');
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;

  // Convert user-friendly amounts to smallest units
  const [amountAParts, amountBParts] = await Promise.all([
    resolveAmount(pool.amountA, pool.tokenA, grpcConfig),
    resolveAmount(pool.amountB, pool.tokenB, grpcConfig)
  ]);

  const lockTimestamp = computeLockTimestamp(pool.lockDuration);
  const parameterValue = `${pool.tokenA},${pool.tokenB},${amountAParts},${amountBParts},${pool.feeRate},${lockTimestamp}`;
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createDexTransaction(
    'create_liquidity_pool',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Create a new liquidity pool and send in one call
 */
export async function createLiquidityPoolAndSend(
  pool: CreateLiquidityPoolOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: DexOptions = {}
): Promise<string> {
  const txn = await createLiquidityPool(pool, publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
