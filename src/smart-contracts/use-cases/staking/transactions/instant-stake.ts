/**
 * Instant Stake Transaction
 * 
 * Stakes tokens via instant staking on the Kalvora staking proxy.
 * 
 * ## Parameter Format
 * `amount,term`
 * 
 * @example
 * ```typescript
 * const txn = await instantStake(
 *   { amount: '500000000000', term: '6_months' },
 *   publicKey, privateKey
 * );
 * ```
 */

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { InstantStakeOptions, StakingOptions } from '../types.js';
import { createStakingTransaction } from '../utils.js';

// ============================================================================
// INSTANT STAKE
// ============================================================================

/**
 * Instant stake tokens on the Kalvora network
 * 
 * Stakes the specified amount for the given term using the instant
 * staking mechanism.
 * 
 * @param stakeOpts - Instant stake parameters (amount, term)
 * @param publicKeyBase58Identifier - Public key of the staker
 * @param privateKeyBase58 - Private key of the staker
 * @param options - Optional transaction configuration
 * @returns The created transaction (not yet sent)
 */
export async function instantStake(
  stakeOpts: InstantStakeOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: StakingOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!stakeOpts.amount) throw new Error('amount is required');
  if (!stakeOpts.term) throw new Error('term is required');
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  const parameterValue = `${stakeOpts.amount},${stakeOpts.term}`;
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createStakingTransaction(
    'instant_stake',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Instant stake and send in one call
 */
export async function instantStakeAndSend(
  stakeOpts: InstantStakeOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: StakingOptions = {}
): Promise<string> {
  const txn = await instantStake(stakeOpts, publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
