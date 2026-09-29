/**
 * Release Liquid Stake Transaction
 * 
 * Releases a liquid stake from the staking proxy.
 * No parameters required — the contract determines the stake from the sender.
 * 
 * ## Parameter Format
 * _(empty string)_
 * 
 * @example
 * ```typescript
 * const txn = await releaseLiquidStake(publicKey, privateKey);
 * ```
 */

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { StakingOptions } from '../types.js';
import { createStakingTransaction } from '../utils.js';

// ============================================================================
// RELEASE LIQUID STAKE
// ============================================================================

/**
 * Release a liquid stake
 * 
 * Releases the sender's liquid stake. The contract identifies the stake
 * from the sender's public key — no additional parameters needed.
 * 
 * @param publicKeyBase58Identifier - Public key of the staker
 * @param privateKeyBase58 - Private key of the staker
 * @param options - Optional transaction configuration
 * @returns The created transaction (not yet sent)
 */
export async function releaseLiquidStake(
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: StakingOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createStakingTransaction(
    'release_liquid_stake',
    '',
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Release liquid stake and send in one call
 */
export async function releaseLiquidStakeAndSend(
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: StakingOptions = {}
): Promise<string> {
  const txn = await releaseLiquidStake(publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
