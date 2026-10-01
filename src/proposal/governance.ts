/**
 * Governance proposal builder.
 *
 * Enforces `against` as option 0, forbids mixing `governance_txn` with
 * `options`, and sizes `fee_amount` for every stage including pre-governance.
 * A fee token must be qualified: the native token, or a token returned by
 * `GetAllAuthorizedFees`.
 */

import { create } from '@bufbuild/protobuf';

import {
  GOVERNANCE_TYPE,
  GovernanceOptionTXNSSchema,
  GovernanceProposalSchema,
  ProposalType,
  type GovernanceProposal,
  type GovernanceTXN
} from '../../proto/generated/txn_pb.js';
import { createQueryClient } from '../query/api-client.js';
import { KALVORA_NATIVE_TOKEN } from '../shared/network/constants.js';
import {
  buildStandardTransaction,
  requireContractId,
  type StandardTXNOptions
} from '../shared/tx/standard.js';

import {
  applyProposalStageFee,
  assertGovernanceProposalShape,
  type GovernanceOptionInput
} from './shape.js';

export interface GovernanceFeeContext {
  type: GOVERNANCE_TYPE;
  allowMulti: boolean;
  /** `governance.stage_length` count, not the sum of the lengths. */
  stageLengthCount: number;
  hasPreGovernance: boolean;
}

export interface GovernanceProposalInput {
  contractId: string;
  title: string;
  synopsis: string;
  body: string;
  publicKey: string;
  proposalType?: ProposalType;
  options?: string[];
  governanceTxn?: GovernanceTXN[];
  governanceOptionTxns?: GovernanceOptionInput[];
  startTimestamp?: Date;
  endTimestamp?: Date;
  /**
   * Contract governance snapshot. Required when `feeAmountParts` is omitted,
   * because the fee has to cover every stage including pre-governance.
   */
  governance?: GovernanceFeeContext;
}

function assertAdaptiveWindow(input: GovernanceProposalInput): void {
  const adaptive = input.governance?.type === GOVERNANCE_TYPE.ADAPTIVE;
  const hasStart = input.startTimestamp !== undefined;
  const hasEnd = input.endTimestamp !== undefined;
  if (adaptive) {
    if (!hasStart || !hasEnd) {
      throw new Error('adaptive governance requires startTimestamp and endTimestamp');
    }
    if ((input.startTimestamp as Date).getTime() > (input.endTimestamp as Date).getTime()) {
      throw new Error('startTimestamp must be less than or equal to endTimestamp');
    }
    return;
  }
  if (input.governance && (hasStart || hasEnd)) {
    throw new Error('only adaptive governance sets startTimestamp and endTimestamp');
  }
}

/**
 * Build an unsigned `GovernanceProposal`.
 *
 * Pass both `nonce` and `feeAmountParts` to stay offline. `feeAmountParts`
 * must already cover every stage. When it is omitted, `governance` is
 * required and the calculated fee is increased by the pre-governance surcharge.
 */
export async function buildGovernanceProposalTXN(
  input: GovernanceProposalInput,
  options: StandardTXNOptions = {}
): Promise<GovernanceProposal> {
  if (!input || typeof input !== 'object') {
    throw new Error('proposal input is required');
  }
  const contractId = requireContractId(input.contractId, 'contractId');
  if (!input.title || !input.synopsis || !input.body) {
    throw new Error('title, synopsis, and body are required');
  }
  assertGovernanceProposalShape({
    ...(input.options !== undefined ? { options: input.options } : {}),
    ...(input.governanceTxn !== undefined ? { governanceTxn: input.governanceTxn } : {}),
    ...(input.governanceOptionTxns !== undefined ? { governanceOptionTxns: input.governanceOptionTxns } : {}),
    ...(input.governance ? { allowMulti: input.governance.allowMulti } : {})
  });
  assertAdaptiveWindow(input);
  if (options.feeAmountParts === undefined && !input.governance) {
    throw new Error('governance snapshot is required to size the proposal fee for every stage');
  }

  const offline = options.nonce !== undefined && options.feeAmountParts !== undefined;
  const feeId = requireContractId(options.feeId ?? KALVORA_NATIVE_TOKEN, 'feeId');
  if (!offline) {
    const authorized = await createQueryClient(options.grpcConfig ?? {}).getAuthorizedFeeTokens();
    const qualified = feeId === KALVORA_NATIVE_TOKEN || authorized.some(token => token.contractId === feeId);
    if (!qualified) {
      throw new Error(`feeId ${feeId} is not a qualified fee token`);
    }
  }

  const proposal = await buildStandardTransaction({
    operation: 'buildGovernanceProposalTXN',
    schema: GovernanceProposalSchema,
    publicKeyId: input.publicKey,
    contractId,
    fields: {
      contractId,
      title: input.title,
      synopsis: input.synopsis,
      body: input.body,
      options: input.options ?? [],
      governanceTxn: input.governanceTxn ?? [],
      governanceOptionTxns: (input.governanceOptionTxns ?? []).map(entry => create(GovernanceOptionTXNSSchema, {
        optionIndex: entry.optionIndex,
        governanceTxn: entry.governanceTxn
      })),
      ...(input.proposalType !== undefined ? { proposalType: input.proposalType } : {}),
      ...(input.startTimestamp ? { startTimestamp: { seconds: BigInt(Math.floor(input.startTimestamp.getTime() / 1000)), nanos: 0 } } : {}),
      ...(input.endTimestamp ? { endTimestamp: { seconds: BigInt(Math.floor(input.endTimestamp.getTime() / 1000)), nanos: 0 } } : {})
    },
    options
  });

  if (options.feeAmountParts === undefined && input.governance && proposal.base?.feeAmount) {
    proposal.base.feeAmount = applyProposalStageFee(
      proposal.base.feeAmount,
      input.governance.stageLengthCount,
      input.governance.hasPreGovernance
    );
  }
  return proposal;
}

export { buildGovernanceProposalTXN as buildGovernanceProposal };
