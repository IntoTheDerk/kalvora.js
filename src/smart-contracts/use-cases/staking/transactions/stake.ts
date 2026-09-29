/**
 * Stake Transaction
 * 
 * Stakes tokens via the Kalvora staking proxy for a specified term.
 * 
 * ## Parameter Format
 * `amount,walletAddress,term`
 * 
 * @example
 * ```typescript
 * const txn = await stake(
 *   { amount: '500000000000', walletAddress: 'Hg6QzYxK1AxfE7Y8PYLzCVwDXvobKiG9RhqQDdoi4gyf', term: '6_months' },
 *   publicKey, privateKey
 * );
 * ```
 */

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { StakeOptions, StakingOptions } from '../types.js';
import { createStakingTransaction } from '../utils.js';

// ============================================================================
// STAKE
// ============================================================================

/**
 * Stake tokens on the Kalvora network
 * 
 * Locks the specified amount for the given term and associates the stake
 * with the provided wallet address.
 * 
 * @param stakeOpts - Stake parameters (amount, wallet address, term)
 * @param publicKeyBase58Identifier - Public key of the staker
 * @param privateKeyBase58 - Private key of the staker
 * @param options - Optional transaction configuration
 * @returns The created transaction (not yet sent)
 */
export async function stake(
  stakeOpts: StakeOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: StakingOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!stakeOpts.amount) throw new Error('amount is required');
  if (!stakeOpts.walletAddress) throw new Error('walletAddress is required');
  if (!stakeOpts.term) throw new Error('term is required');
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  const parameterValue = `${stakeOpts.amount},${stakeOpts.walletAddress},${stakeOpts.term}`;
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createStakingTransaction(
    'stake',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Stake tokens and send in one call
 */
export async function stakeAndSend(
  stakeOpts: StakeOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: StakingOptions = {}
): Promise<string> {
  const txn = await stake(stakeOpts, publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
