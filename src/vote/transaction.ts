/**
 * Transaction Module - Governance VoteTXN
 *
 * Creates, builds, and submits GovernanceVote transactions.
 *
 * `buildVoteTXN()` constructs an unsigned transaction (no private keys needed).
 * `createVoteTXN()` is a convenience wrapper: build + sign with private key.
 */

import { protoInt64, create } from '@bufbuild/protobuf';

import type { ProposalDetailResponse } from '../../proto/generated/kal_api_pb.js';
import { GovernanceVoteSchema } from '../../proto/generated/txn_pb.js';
import type { GovernanceVote } from '../../proto/generated/txn_pb.js';
import { PROPOSAL_PHASE } from '../../proto/generated/validator_pb.js';
import { UniversalFeeCalculator, type FeeConfigHelper } from '../shared/fee-calculators/universal-fee-calculator.js';
import { logger } from '../shared/monitoring/index.js';
import { KALVORA_NATIVE_TOKEN } from '../shared/network/constants.js';
import { buildStandardBaseTXN, getAddressAndNonce } from '../shared/tx/base.js';
import type { StandardTXNOptions } from '../shared/tx/standard.js';
import { bytesEqual, hexToBytes } from '../shared/utils/byte-utils.js';
import { PROTONET_GRPC_CONFIG } from '../shared/utils/testing-defaults/index.js';
import { isValidContractId } from '../shared/utils/validation.js';
import { optionsForSigner, signBuiltTransaction, type SigningKey } from '../sign/builder.js';
import type { GRPCConfig } from '../types/index.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for building an unsigned GovernanceVote transaction.
 */
export interface BuildVoteTXNOptions {
  proofLayout?: StandardTXNOptions['proofLayout'];
  /** Whether to support the proposal (for binary yes/no votes) */
  support?: boolean;
  /** The option index to support (for multi-option votes) */
  supportOption?: number;
  /** Sign the active zero-based PRE or POST step from the proposal's frozen council list. */
  preGovernanceStage?: number;
  postGovernanceStage?: number;
  /** Read from getProposalDetail. Binds the ballot to the current phase, choice shape and council step. */
  proposalDetail?: ProposalDetailResponse;
  /** Optional memo */
  memo?: string;
  /** gRPC configuration */
  grpcConfig?: GRPCConfig;
  /** Overestimate percentage for fee (defaults to 5.0%) */
  overestimatePercent?: number;
  /** Optional nonce override */
  nonce?: string | number | bigint;
  /** Fee ID (defaults to `KALVORA_NATIVE_TOKEN`) */
  feeId?: string;
  /** Manual fee amount in parts */
  feeAmountParts?: string;
  /** Deterministic timestamp override for reviewed transaction vectors */
  timestamp?: Date;
}

/**
 * Options for creating a GovernanceVote transaction (includes private key).
 */
export type CreateVoteTXNOptions = BuildVoteTXNOptions;

// ============================================================================
// PUBLIC API — BUILD UNSIGNED
// ============================================================================

/**
 * Build an unsigned GovernanceVote transaction.
 *
 * Performs validation, nonce fetching, and fee calculation but **stops before signing**.
 * The returned transaction has no signature and no hash.
 *
 * @param contractId - Contract ID for the governance token
 * @param proposalIdHex - Hex-encoded proposal ID
 * @param publicKeyBase58Identifier - Public key identifier (no private key needed)
 * @param options - Vote options (support/supportOption, memo, fees, etc.)
 * @returns An unsigned `GovernanceVote` protobuf
 *
 * @example
 * ```typescript
 * const unsigned = await buildVoteTXN(
 *   'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', 'aabbccdd...', 'A_9Xk3...',
 *   { support: true }
 * );
 * const signed = await signAndFinalize(unsigned, signer);
 * ```
 */
export async function buildVoteTXN(
  contractId: string,
  proposalIdHex: string,
  publicKeyBase58Identifier: string,
  options: BuildVoteTXNOptions = {}
): Promise<GovernanceVote> {
  if (!isValidContractId(contractId)) {
    throw new Error('contractId must be a canonical bounded Kalvora mint ID');
  }
  if (!proposalIdHex) throw new Error('proposalId (hex) is required');
  if (!publicKeyBase58Identifier) throw new Error('publicKey identifier is required');

  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;
  const feeId = options.feeId;
  const feeAmountParts = options.feeAmountParts;

  const hasSupport = typeof options.support === 'boolean';
  const hasSupportOption = typeof options.supportOption === 'number';
  if (options.preGovernanceStage !== undefined && options.postGovernanceStage !== undefined) throw new Error('Vote in one council phase at a time');
  if (hasSupport === hasSupportOption) {
    throw new Error('Specify exactly one of: support (boolean) OR supportOption (number)');
  }
  if (
    hasSupportOption &&
    (!Number.isSafeInteger(options.supportOption) ||
      (options.supportOption as number) < 0 ||
      (options.supportOption as number) > 0xffff_ffff)
  ) {
    throw new Error('supportOption must be a uint32 integer');
  }

  let proposalBytes: Uint8Array;
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(proposalIdHex)) throw new Error('Invalid hex');
    proposalBytes = hexToBytes(proposalIdHex);
  } catch {
    throw new Error('Invalid proposalId: must be hex-encoded');
  }

  let { preGovernanceStage, postGovernanceStage } = options;
  const detail = options.proposalDetail;
  if (detail) {
    if (detail.contractId !== contractId || !bytesEqual(detail.proposalId, proposalBytes)) throw new Error('Vote target does not match proposal detail');
    if (detail.promotionPending || detail.granular?.closed) throw new Error('This proposal is closed or awaiting promotion');
    const pre = detail.phase === PROPOSAL_PHASE.PRE_GOVERNANCE;
    const post = detail.phase === PROPOSAL_PHASE.POST_GOVERNANCE;
    if ((preGovernanceStage !== undefined && (!pre || preGovernanceStage !== detail.preGovernanceStage)) ||
        (postGovernanceStage !== undefined && (!post || postGovernanceStage !== detail.postGovernanceStage))) {
      throw new Error('Vote targets a stale council step');
    }
    preGovernanceStage = pre ? detail.preGovernanceStage : undefined;
    postGovernanceStage = post ? detail.postGovernanceStage : undefined;
    if ((pre && preGovernanceStage === undefined) || (post && postGovernanceStage === undefined)) {
      throw new Error('Missing active council step');
    }
    if (!pre && !post && (hasSupportOption !== detail.optionsSet ||
        (options.supportOption !== undefined && options.supportOption >= detail.numberOfOptions))) {
      throw new Error('Vote choice does not match the proposal');
    }
  }
  const step = preGovernanceStage ?? postGovernanceStage;
  if (step !== undefined && (!Number.isInteger(step) || step < 0 || step >= 32 || !hasSupport)) {
    throw new Error('Council votes require binary support and a step from 0 to 31');
  }

  let nonce: bigint;
  if (options.nonce !== undefined) {
    nonce = protoInt64.uParse(String(options.nonce));
    logger.warn('Manual nonce specified - skipping network nonce fetch.', { operation: 'buildVoteTXN', nonce: String(options.nonce) });
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
    timestamp?: Date;
  } = { publicKeyId: publicKeyBase58Identifier, nonce };
  if (options.memo) baseParams.memo = options.memo;
  if (feeId !== undefined) baseParams.feeId = feeId;
  if (feeAmountParts !== undefined) baseParams.feeAmountParts = feeAmountParts;
  if (options.timestamp !== undefined) baseParams.timestamp = options.timestamp;
  const base = buildStandardBaseTXN({ ...baseParams, ...(grpcConfig.transactionContext ? { context: grpcConfig.transactionContext } : {}) }, 'kal_txn.GovernanceVote');

  const voteData: Record<string, unknown> = { base, contractId, proposalId: proposalBytes };
  if (hasSupport && options.support !== undefined) voteData.support = options.support;
  if (hasSupportOption && options.supportOption !== undefined) voteData.supportOption = options.supportOption;
  if (preGovernanceStage !== undefined) voteData.preGovernanceStage = preGovernanceStage;
  if (postGovernanceStage !== undefined) voteData.postGovernanceStage = postGovernanceStage;

  const voteTxn = create(GovernanceVoteSchema, voteData);
  const effectiveFeeId = feeId || KALVORA_NATIVE_TOKEN;

  const feeOptions: FeeConfigHelper<GovernanceVote> = {
    contractId, protoObject: voteTxn, tokenInfoMap: new Map(), baseFeeId: effectiveFeeId, grpcConfig,
    ...(options.proofLayout ? { proofLayout: options.proofLayout } : {}),
    ...(feeAmountParts !== undefined && { baseFeeParts: feeAmountParts }),
    ...(options.overestimatePercent !== undefined && { overestimatePercent: options.overestimatePercent })
  };
  if (feeAmountParts === undefined) {
    await UniversalFeeCalculator.calculateFee<GovernanceVote>(feeOptions);
  }
  if (voteTxn.base?.signature !== undefined || voteTxn.base?.hash !== undefined) {
    throw new Error('Unsigned vote construction unexpectedly produced signature material');
  }

  return voteTxn;
}

// ============================================================================
// PUBLIC API — CONVENIENCE (build + sign)
// ============================================================================

/**
 * Create a GovernanceVote transaction.
 *
 * Convenience wrapper: builds with `buildVoteTXN()` then signs with the provided private key.
 */
export async function createVoteTXN(
  contractId: string,
  proposalIdHex: string,
  publicKeyBase58Identifier: string,
  privateKeyBase58: SigningKey,
  options: CreateVoteTXNOptions = {}
): Promise<GovernanceVote> {
  if (!privateKeyBase58) throw new Error('privateKey is required');

  // Build unsigned transaction (validation, nonce, fees all handled inside)
  const buildOptions = optionsForSigner(options, privateKeyBase58);
  const voteTxn = await buildVoteTXN(contractId, proposalIdHex, publicKeyBase58Identifier, buildOptions);

  // Sign and hash
  return signBuiltTransaction(voteTxn, privateKeyBase58, publicKeyBase58Identifier, buildOptions.grpcConfig?.transactionContext);
}

// ============================================================================
// PUBLIC API — SEND
// ============================================================================

/**
 * Submit a GovernanceVote to the network via gRPC.
 */
export async function sendVoteTXN(vote: GovernanceVote, grpcConfig: GRPCConfig = {}): Promise<string> {
  const { submitTransaction } = await import('../grpc/transaction/transaction-client.js');
  return submitTransaction(vote, grpcConfig);
}
