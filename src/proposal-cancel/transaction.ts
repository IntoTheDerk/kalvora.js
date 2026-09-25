/**
 * Transaction Module - ProposalCancelTXN
 *
 * Builds, signs, and submits Kalvora governance proposal-cancellation
 * transactions introduced by the Kalvora protocol.
 */

import { create, protoInt64 } from '@bufbuild/protobuf';

import {
  ProposalCancelTXNSchema,
  type ProposalCancelTXN
} from '../../proto/generated/txn_pb.js';
import {
  UniversalFeeCalculator,
  type FeeConfigHelper
} from '../shared/fee-calculators/universal-fee-calculator.js';
import { logger } from '../shared/monitoring/index.js';
import { KALVORA_NATIVE_TOKEN } from '../shared/network/constants.js';
import { buildStandardBaseTXN, getAddressAndNonce } from '../shared/tx/base.js';
import { hexToBytes } from '../shared/utils/byte-utils.js';
import { PROTONET_GRPC_CONFIG } from '../shared/utils/testing-defaults/index.js';
import { isValidContractId } from '../shared/utils/validation.js';
import { signWithKey } from '../sign/finalize.js';
import type { GRPCConfig } from '../types/index.js';

export interface BuildProposalCancelTXNOptions {
  grpcConfig?: GRPCConfig;
  nonce?: string | number | bigint;
  timestamp?: Date;
  memo?: string;
  feeId?: string;
  feeAmountParts?: string;
  overestimatePercent?: number;
}

export type CreateProposalCancelTXNOptions = BuildProposalCancelTXNOptions;

function parseProposalId(proposalIdHex: string): Uint8Array {
  if (typeof proposalIdHex !== 'string' || !/^(?:0x)?[0-9a-fA-F]{64}$/u.test(proposalIdHex)) {
    throw new Error('proposalId must be a 32-byte hex string');
  }

  return hexToBytes(proposalIdHex);
}

/**
 * Build an unsigned ProposalCancelTXN.
 *
 * The proposal ID is the 32-byte proposal hash encoded as hexadecimal.
 * Pass `nonce` and `feeAmountParts` for deterministic/offline construction;
 * otherwise the SDK queries the configured Kalvora endpoint.
 */
export async function buildProposalCancelTXN(
  contractId: string,
  proposalIdHex: string,
  publicKeyBase58Identifier: string,
  options: BuildProposalCancelTXNOptions = {}
): Promise<ProposalCancelTXN> {
  if (!isValidContractId(contractId)) {
    throw new Error('contractId must be a canonical bounded Kalvora mint ID');
  }
  if (!publicKeyBase58Identifier) {
    throw new Error('publicKey identifier is required');
  }

  const proposalId = parseProposalId(proposalIdHex);
  const feeId = options.feeId ?? KALVORA_NATIVE_TOKEN;
  if (!isValidContractId(feeId)) {
    throw new Error('feeId must be a canonical bounded Kalvora mint ID');
  }

  const grpcConfig = options.grpcConfig ?? PROTONET_GRPC_CONFIG;
  const nonce = options.nonce !== undefined
    ? protoInt64.uParse(String(options.nonce))
    : (await getAddressAndNonce(publicKeyBase58Identifier, grpcConfig)).nonce;

  if (options.nonce !== undefined) {
    logger.warn('Manual nonce specified - skipping network nonce fetch.', {
      operation: 'buildProposalCancelTXN',
      nonce: String(options.nonce)
    });
  }

  const base = buildStandardBaseTXN({
    publicKeyId: publicKeyBase58Identifier,
    nonce,
    ...(options.memo !== undefined ? { memo: options.memo } : {}),
    ...(options.timestamp !== undefined ? { timestamp: options.timestamp } : {}),
    feeId,
    ...(options.feeAmountParts !== undefined ? { feeAmountParts: options.feeAmountParts } : {})
  });

  const proposalCancel = create(ProposalCancelTXNSchema, {
    base,
    contractId,
    proposalId
  });

  const feeOptions: FeeConfigHelper<ProposalCancelTXN> = {
    contractId,
    protoObject: proposalCancel,
    tokenInfoMap: new Map(),
    baseFeeId: feeId,
    ...(options.grpcConfig !== undefined ? { grpcConfig: options.grpcConfig } : {}),
    ...(options.feeAmountParts !== undefined ? { baseFeeParts: options.feeAmountParts } : {}),
    ...(options.overestimatePercent !== undefined
      ? { overestimatePercent: options.overestimatePercent }
      : {})
  };

  if (options.feeAmountParts === undefined) {
    await UniversalFeeCalculator.calculateFee(feeOptions);
  }

  if (proposalCancel.base?.signature !== undefined || proposalCancel.base?.hash !== undefined) {
    throw new Error('Unsigned proposal-cancel construction unexpectedly produced signature material');
  }

  return proposalCancel;
}

/** Build and sign a ProposalCancelTXN with a private key. */
export async function createProposalCancelTXN(
  contractId: string,
  proposalIdHex: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: CreateProposalCancelTXNOptions = {}
): Promise<ProposalCancelTXN> {
  if (!privateKeyBase58) {
    throw new Error('privateKey is required');
  }

  const proposalCancel = await buildProposalCancelTXN(
    contractId,
    proposalIdHex,
    publicKeyBase58Identifier,
    options
  );
  signWithKey(proposalCancel, privateKeyBase58, publicKeyBase58Identifier);
  return proposalCancel;
}

/** Submit a ProposalCancelTXN through the Kalvora transaction service. */
export async function sendProposalCancelTXN(
  proposalCancel: ProposalCancelTXN,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  const { submitTransaction } = await import('../grpc/transaction/transaction-client.js');
  return submitTransaction(proposalCancel, grpcConfig);
}
