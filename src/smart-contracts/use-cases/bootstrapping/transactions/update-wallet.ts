/**
 * Update Wallet Transaction
 *
 * Updates the payout wallet associated with a bootstrapping LP position.
 *
 * ## Parameter Format
 * `walletAddress,bumpId`
 */

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { BootstrappingOptions, UpdateWalletOptions } from '../types.js';
import { createBootstrappingTransaction } from '../utils.js';

// ============================================================================
// UPDATE WALLET
// ============================================================================

/**
 * Update the payout wallet for an existing bootstrapping position.
 *
 * The position is identified by the provided `bumpId`, matching the
 * `walletAddress,bumpId` format supplied in the protocol execution examples.
 */
export async function updateWallet(
  updateOpts: UpdateWalletOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: BootstrappingOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!updateOpts.walletAddress) throw new Error('walletAddress is required');
  if (!updateOpts.bumpId) throw new Error('bumpId is required');
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  const parameterValue = `${updateOpts.walletAddress},${updateOpts.bumpId}`;
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createBootstrappingTransaction(
    'update_wallet',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Update wallet and send in one call.
 */
export async function updateWalletAndSend(
  updateOpts: UpdateWalletOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: BootstrappingOptions = {}
): Promise<string> {
  const txn = await updateWallet(updateOpts, publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
