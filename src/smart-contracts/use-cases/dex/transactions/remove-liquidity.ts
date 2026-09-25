/**
 * Remove Liquidity Transaction
 * 
 * Removes liquidity from a Kalvora DEX pool by redeeming LP tokens.
 * LP tokens always have 9 decimals — the SDK converts automatically.
 * 
 * ## Parameter Format
 * `tokenA,tokenB,lpAmount,feeRate`
 * 
 * @example
 * ```typescript
 * const txn = await removeLiquidity(
 *   { tokenA: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', tokenB: 'solana-SOL000000', lpAmount: '197.642353760', feeRate: 25 },
 *   publicKey, privateKey
 * );
 * ```
 */

import { Decimal } from 'decimal.js';

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { RemoveLiquidityOptions, DexOptions } from '../types.js';
import { createDexTransaction } from '../utils.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** LP tokens always have 9 decimal places */
const LP_TOKEN_DECIMALS = 9;

// ============================================================================
// REMOVE LIQUIDITY
// ============================================================================

/**
 * Remove liquidity from a Kalvora DEX pool
 * 
 * Burns LP tokens to receive back the underlying token pair.
 * LP tokens must be unlocked before removal (see `unlockLiquidity`).
 * 
 * `lpAmount` is specified in user-friendly units (e.g., '197.64' for ~197.64 LP tokens).
 * LP tokens always have 9 decimals — no network call is needed for conversion.
 * 
 * @param removal - Removal parameters (tokens, LP amount, fee rate)
 * @param publicKeyBase58Identifier - Public key of the liquidity provider
 * @param privateKeyBase58 - Private key of the liquidity provider
 * @param options - Optional transaction configuration
 * @returns The created transaction (not yet sent)
 */
export async function removeLiquidity(
  removal: RemoveLiquidityOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: DexOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!removal.tokenA) throw new Error('tokenA is required');
  if (!removal.tokenB) throw new Error('tokenB is required');
  if (!removal.lpAmount && removal.lpAmount !== 0) throw new Error('lpAmount is required');
  if (removal.feeRate === undefined) throw new Error('feeRate is required');
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  // Convert user-friendly LP amount to smallest units (9 decimals, no network call needed)
  const lpAmountParts = new Decimal(String(removal.lpAmount))
    .mul(new Decimal(10).pow(LP_TOKEN_DECIMALS))
    .floor()
    .toString();

  const parameterValue = `${removal.tokenA},${removal.tokenB},${lpAmountParts},${removal.feeRate}`;
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createDexTransaction(
    'remove_liquidity',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Remove liquidity and send in one call
 */
export async function removeLiquidityAndSend(
  removal: RemoveLiquidityOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: DexOptions = {}
): Promise<string> {
  const txn = await removeLiquidity(removal, publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}

