/**
 * Stake Transaction
 *
 * Locks eligible LP tokens into the bootstrapping rewards contract.
 *
 * ## Parameter Format
 * `amount,term,lpTokenId`
 */

import type { SmartContractExecuteTXN } from '../../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import type { BootstrappingOptions, StakeOptions } from '../types.js';
import { createBootstrappingTransaction, resolveBootstrappingAmount } from '../utils.js';

// ============================================================================
// STAKE
// ============================================================================

/**
 * Lock LP tokens in the bootstrapping contract.
 *
 * This builds the raw `stake` execution path using the format shown in the
 * provided contract examples:
 *
 * `execute("stake", "amount,term,lpTokenId")`
 *
 * Callers should pass `amount` in user-friendly token units. The SDK converts
 * it to raw parts using the fixed 1e9 LP denomination before submission.
 */
export async function stake(
  stakeOpts: StakeOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: BootstrappingOptions = {}
): Promise<SmartContractExecuteTXN> {
  if (!stakeOpts.amount) throw new Error('amount is required');
  if (!stakeOpts.term) throw new Error('term is required');
  if (!stakeOpts.lpTokenId) throw new Error('lpTokenId is required');
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  if (!privateKeyBase58) throw new Error('privateKeyBase58 is required');

  const amountInParts = resolveBootstrappingAmount(stakeOpts.amount, stakeOpts.lpTokenId);
  const parameterValue = `${amountInParts},${stakeOpts.term},${stakeOpts.lpTokenId}`;
  const feeId = options.feeId || KALVORA_NATIVE_TOKEN;

  return createBootstrappingTransaction(
    'stake',
    parameterValue,
    publicKeyBase58Identifier,
    privateKeyBase58,
    feeId,
    options
  );
}

/**
 * Stake and send in one call.
 */
export async function stakeAndSend(
  stakeOpts: StakeOptions,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: BootstrappingOptions = {}
): Promise<string> {
  const txn = await stake(stakeOpts, publicKeyBase58Identifier, privateKeyBase58, options);
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  return sendSmartContractExecuteTXN(txn, grpcConfig);
}
