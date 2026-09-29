/**
 * Add Liquidity Transaction
 * 
 * Adds liquidity to an existing pool on the Kalvora DEX.
 * Amounts are specified in user-friendly units and auto-converted.
 * 
 * ## Parameter Format
 * `tokenA,tokenB,amountA,amountB,feeRate,lockTimestamp`
 * 
 * @example
 * ```typescript
 * const txn = await addLiquidity(
 *   { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-SOL000000', amountA: '50', amountB: '100', feeRate: 25 },
 *   publicKey, privateKey
 * );
 * ```
 */

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { AddLiquidityOptions, DexOptions } from '../types.js';
import { createDexTransaction, computeLockTimestamp, resolveAmount } from '../utils.js';

// ============================================================================
// ADD LIQUIDITY
// ============================================================================

/**
 * Add liquidity to an existing Kalvora DEX pool
 * 
 * @param liquidity - Liquidity parameters (tokens, amounts in user-friendly units, fee rate)
 * @param publicKeyBase58Identifier - Public key of the liquidity provider
 * @param privateKeyBase58 - Private key of the liquidity provider
 * @param options - Optional transaction configuration
 * @returns The created transaction (not yet sent)
 */
export async function addLiquidity(
  liquidity: AddLiquidityOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: DexOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!liquidity.tokenA) throw new Error('tokenA is required');
  if (!liquidity.tokenB) throw new Error('tokenB is required');
  if (!liquidity.amountA && liquidity.amountA !== 0) throw new Error('amountA is required');
  if (!liquidity.amountB && liquidity.amountB !== 0) throw new Error('amountB is required');
  if (liquidity.feeRate === undefined) throw new Error('feeRate is required');
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;

  // Convert user-friendly amounts to smallest units
  const [amountAParts, amountBParts] = await Promise.all([
    resolveAmount(liquidity.amountA, liquidity.tokenA, grpcConfig),
    resolveAmount(liquidity.amountB, liquidity.tokenB, grpcConfig)
  ]);

  const lockTimestamp = computeLockTimestamp(liquidity.lockDuration);
  const parameterValue = `${liquidity.tokenA},${liquidity.tokenB},${amountAParts},${amountBParts},${liquidity.feeRate},${lockTimestamp}`;
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createDexTransaction(
    'add_liquidity',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Add liquidity and send in one call
 */
export async function addLiquidityAndSend(
  liquidity: AddLiquidityOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: DexOptions = {}
): Promise<string> {
  const txn = await addLiquidity(liquidity, publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
