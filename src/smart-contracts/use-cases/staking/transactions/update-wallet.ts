/**
 * Update Wallet Transaction
 * 
 * Updates the wallet address associated with a liquid stake.
 * 
 * ## Parameter Format
 * `walletAddress,bumpId`
 * 
 * @example
 * ```typescript
 * const txn = await updateWallet(
 *   { walletAddress: 'Hg6QzYxK1AxfE7Y8PYLzCVwDXvobKiG9RhqQDdoi4gyf', bumpId: '28' },
 *   publicKey, privateKey
 * );
 * ```
 */

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { UpdateWalletOptions, StakingOptions } from '../types.js';
import { createStakingTransaction } from '../utils.js';

// ============================================================================
// UPDATE WALLET
// ============================================================================

/**
 * Update the wallet address for a liquid stake
 * 
 * Changes the wallet address associated with an existing stake
 * identified by the bump ID.
 * 
 * @param updateOpts - Update parameters (wallet address, bump ID)
 * @param publicKeyBase58Identifier - Public key of the staker
 * @param privateKeyBase58 - Private key of the staker
 * @param options - Optional transaction configuration
 * @returns The created transaction (not yet sent)
 */
export async function updateWallet(
  updateOpts: UpdateWalletOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: StakingOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!updateOpts.walletAddress) throw new Error('walletAddress is required');
  if (!updateOpts.bumpId) throw new Error('bumpId is required');
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  const parameterValue = `${updateOpts.walletAddress},${updateOpts.bumpId}`;
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createStakingTransaction(
    'update_wallet',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Update wallet and send in one call
 */
export async function updateWalletAndSend(
  updateOpts: UpdateWalletOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: StakingOptions = {}
): Promise<string> {
  const txn = await updateWallet(updateOpts, publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
