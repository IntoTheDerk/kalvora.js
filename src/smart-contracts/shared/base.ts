/**
 * Shared base transaction helpers for smart contract transactions.
 */

import { protoInt64 } from '@bufbuild/protobuf';

import type { BaseTXN } from '../../../proto/generated/txn_pb.js';
import { generateAddressFromPublicKey } from '../../shared/crypto/address-utils.js';
import type { TransactionMessage } from '../../shared/fee-calculators/universal-fee-calculator.js';
import { UniversalFeeCalculator, type FeeConfigHelper } from '../../shared/fee-calculators/universal-fee-calculator.js';
import { logger } from '../../shared/monitoring/index.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { buildStandardBaseTXN, getAddressAndNonce } from '../../shared/tx/base.js';
import { parseUint256, type StandardTXNOptions } from '../../shared/tx/standard.js';
import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import type { GRPCConfig } from '../../types/index.js';

export type SmartContractBaseTXNOptions = Pick<StandardTXNOptions,
  'memo' | 'grpcConfig' | 'nonce' | 'feeId' | 'feeAmountParts' | 'overestimatePercent' |
  'proofLayout' | 'nonNativeMultiplier' | 'timestamp'>;

export async function buildSmartContractBaseTXN(
  publicKeyBase58Identifier: string,
  options: SmartContractBaseTXNOptions,
  operation: string
): Promise<{ base: BaseTXN; grpcConfig: GRPCConfig; effectiveFeeId: string }> {
  if (!publicKeyBase58Identifier) throw new Error('publicKeyBase58Identifier is required');
  generateAddressFromPublicKey(publicKeyBase58Identifier);

  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  const effectiveFeeId = options.feeId || KALVORA_NATIVE_TOKEN;

  let nonce: bigint;
  if (options.nonce !== undefined) {
    nonce = protoInt64.uParse(String(options.nonce));
    logger.warn('Manual nonce specified - skipping network nonce fetch.', {
      operation,
      nonce: String(options.nonce)
    });
  } else {
    const result = await getAddressAndNonce(publicKeyBase58Identifier, grpcConfig);
    nonce = result.nonce;
  }

  return {
    base: buildStandardBaseTXN({ publicKeyId: publicKeyBase58Identifier, nonce, feeId: effectiveFeeId,
      ...(options.memo !== undefined && { memo: options.memo }),
      ...(options.timestamp && { timestamp: options.timestamp }),
      ...(options.feeAmountParts !== undefined && { feeAmountParts: parseUint256(options.feeAmountParts, 'feeAmountParts', false) }),
      ...(grpcConfig.transactionContext && { context: grpcConfig.transactionContext })
    }, operation.slice(5)),
    grpcConfig,
    effectiveFeeId
  };
}

export async function calculateSmartContractFee<T extends TransactionMessage>(
  txn: T,
  options: SmartContractBaseTXNOptions & { gasFeeInUsd?: number },
  grpcConfig: GRPCConfig,
  effectiveFeeId: string
): Promise<void> {
  if (options.gasFeeInUsd !== undefined && (!Number.isFinite(options.gasFeeInUsd) || options.gasFeeInUsd < 0)) {
    throw new RangeError('gasFeeInUsd must be finite and non-negative');
  }
  if (options.feeAmountParts !== undefined && !options.gasFeeInUsd) return;

  const feeOptions: FeeConfigHelper<T> = {
    protoObject: txn,
    tokenInfoMap: new Map(),
    baseFeeId: effectiveFeeId,
    grpcConfig,
    ...(options.feeAmountParts !== undefined && txn.base && { baseFeeParts: txn.base.feeAmount }),
    ...(options.proofLayout && { proofLayout: options.proofLayout }),
    ...(options.nonNativeMultiplier !== undefined && { nonNativeMultiplier: options.nonNativeMultiplier }),
    ...(options.gasFeeInUsd !== undefined && { gasFeeInUsd: options.gasFeeInUsd }),
    ...(options.overestimatePercent !== undefined && { overestimatePercent: options.overestimatePercent })
  };

  await UniversalFeeCalculator.calculateFee<T>(feeOptions);
}
