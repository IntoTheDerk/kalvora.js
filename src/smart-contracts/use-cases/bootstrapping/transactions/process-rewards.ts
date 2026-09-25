/**
 * Process Rewards Transaction
 *
 * Triggers the bootstrapping contract's reward processing path.
 *
 * ## Parameter Format
 * _(empty string)_
 */

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { BootstrappingOptions } from '../types.js';
import { createBootstrappingTransaction } from '../utils.js';

// ============================================================================
// PROCESS REWARDS
// ============================================================================

/**
 * Trigger reward processing for the sender's bootstrapping positions.
 *
 * The accounting rules and exact payout logic are enforced on-chain. This SDK
 * only builds the `process_rewards` execute call with the empty parameter
 * payload shown in the provided contract example.
 */
export async function processRewards(
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: BootstrappingOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createBootstrappingTransaction(
    'process_rewards',
    '',
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Process rewards and send in one call.
 */
export async function processRewardsAndSend(
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: BootstrappingOptions = {}
): Promise<string> {
  const txn = await processRewards(publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
