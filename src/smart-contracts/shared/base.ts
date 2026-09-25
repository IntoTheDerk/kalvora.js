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
import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import type { GRPCConfig } from '../../types/index.js';

export interface SmartContractBaseTXNOptions {
  /** Optional memo */
  memo?: string;
  /** gRPC configuration */
  grpcConfig?: GRPCConfig;
  /** Optional nonce override */
  nonce?: string | number | bigint;
  /** Fee ID (defaults to `KALVORA_NATIVE_TOKEN`) */
  feeId?: string;
  /** Manual fee amount in smallest units/parts */
  feeAmountParts?: string;
  /** Overestimate percentage for auto-calculated fees */
  overestimatePercent?: number;
}

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

  const baseParams: {
    publicKeyId: string;
    nonce: bigint;
    memo?: string;
    feeId?: string;
    feeAmountParts?: string;
  } = {
    publicKeyId: publicKeyBase58Identifier,
    nonce
  };
  if (options.memo) baseParams.memo = options.memo;
  if (options.feeId !== undefined) baseParams.feeId = options.feeId;
  if (options.feeAmountParts !== undefined) baseParams.feeAmountParts = options.feeAmountParts;

  return {
    base: buildStandardBaseTXN(baseParams),
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
  if (options.feeAmountParts !== undefined && options.gasFeeInUsd === undefined) {
    logger.warn('Manual base fee parts specified - skipping fee calculation and conversion. Fee is not validated and may be insufficient, causing transaction failure.', {
      baseFeeId: effectiveFeeId,
      providedFeeParts: options.feeAmountParts,
      operation: 'manualSmartContractBaseFeeParts'
    });

    const txnProto = txn as { base?: { feeAmount?: string; feeId?: string } };
    if (txnProto.base) {
      txnProto.base.feeAmount = options.feeAmountParts;
      txnProto.base.feeId = effectiveFeeId;
    }
    return;
  }

  const feeOptions: FeeConfigHelper<T> = {
    protoObject: txn,
    tokenInfoMap: new Map(),
    baseFeeId: effectiveFeeId,
    grpcConfig,
    ...(options.feeAmountParts !== undefined && { baseFeeParts: options.feeAmountParts }),
    ...(options.gasFeeInUsd !== undefined && { gasFeeInUsd: options.gasFeeInUsd }),
    ...(options.overestimatePercent !== undefined && { overestimatePercent: options.overestimatePercent })
  };

  await UniversalFeeCalculator.calculateFee<T>(feeOptions);
}
