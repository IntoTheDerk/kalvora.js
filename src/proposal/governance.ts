/**
 * Governance proposal builder.
 *
 * Enforces `against` as option 0, forbids mixing `governance_txn` with
 * `options`, and sizes `fee_amount` for every stage including pre-governance.
 * A fee token must be qualified: the native token, or a token returned by
 * `GetAllAuthorizedFees`.
 */

import { create, fromBinary, toBinary, type Message } from '@bufbuild/protobuf';

import {
  GOVERNANCE_TYPE,
  GovernanceOptionTXNSSchema,
  GovernanceProposalSchema,
  ProposalType,
  type BaseTXN,
  type GovernanceProposal,
  type GovernanceTXN,
  type PreGovernance
} from '../../proto/generated/txn_pb.js';
import { createQueryClient } from '../query/api-client.js';
import { isWalletAddressBytes } from '../shared/crypto/falcon-address.js';
import { createTransactionHash } from '../shared/crypto/signature-utils.js';
import { KALVORA_NATIVE_TOKEN } from '../shared/network/constants.js';
import {
  buildStandardTransaction,
  requireContractId,
  type StandardTXNOptions
} from '../shared/tx/standard.js';
import { bytesEqual, bytesToHex } from '../shared/utils/byte-utils.js';
import { governanceChildSchema } from '../sign/resources.js';

import {
  assertBasisPoints,
  supportsCouncilReviews,
  validateCouncilStage,
  assertGovernanceProposalShape,
  type GovernanceOptionInput
} from './shape.js';

export interface GovernanceFeeContext {
  type: GOVERNANCE_TYPE;
  allowMulti: boolean;
  /** `governance.stage_length` count, not the sum of the lengths. */
  stageLengthCount: number;
  hasPreGovernance?: boolean;
  preGovernanceStageCount?: number;
  postGovernanceStageCount?: number;
  allowProposalCouncils?: boolean;
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
  granular?: { threshold: number; regularQuorum: number; voterWallets: Uint8Array[]; votingInstrument?: string };
  additionalPreGovernance?: Omit<PreGovernance, '$typeName'>[];
  additionalPostGovernance?: Omit<PreGovernance, '$typeName'>[];
  /**
   * Contract governance snapshot. Required when `feeAmountParts` is omitted,
   * because the fee has to cover every stage including pre-governance.
   */
  governance?: GovernanceFeeContext;
}

function assertProposalWindow(input: GovernanceProposalInput, expectedAcceptance: Date): void {
  if (input.granular || input.governance?.type === GOVERNANCE_TYPE.GRANULAR) {
    const rules = input.granular;
    if (!rules || (input.governance && input.governance.type !== GOVERNANCE_TYPE.GRANULAR)) {
      throw new Error('Granular rules are required only for granular governance');
    }
    const start = input.startTimestamp?.getTime();
    const end = input.endTimestamp?.getTime();
    if (start === undefined || end === undefined || !Number.isInteger(start / 1000) || !Number.isInteger(end / 1000) ||
        start >= end || end <= expectedAcceptance.getTime() || end > expectedAcceptance.getTime() + 90 * 86400000) {
      throw new Error('Granular proposals need whole-second start < end, ending within 90 days after acceptance');
    }
    assertBasisPoints(rules.threshold, 'threshold');
    assertBasisPoints(rules.regularQuorum, 'regularQuorum');
    if (rules.voterWallets.length < 1 || rules.voterWallets.length > 1000 || !rules.voterWallets.every(isWalletAddressBytes) ||
        new Set(rules.voterWallets.map(bytesToHex)).size !== rules.voterWallets.length) {
      throw new Error('Granular proposals require 1–1000 distinct canonical voter wallets');
    }
    if (rules.votingInstrument !== undefined) requireContractId(rules.votingInstrument, 'votingInstrument');
    return;
  }
  const adaptive = input.governance?.type === GOVERNANCE_TYPE.ADAPTIVE;
  const hasStart = input.startTimestamp !== undefined;
  const hasEnd = input.endTimestamp !== undefined;
  if (adaptive) {
    if (!hasStart || !hasEnd) {
      throw new Error('adaptive governance requires startTimestamp and endTimestamp');
    }
    const start = Math.floor((input.startTimestamp as Date).getTime() / 1000);
    const end = Math.floor((input.endTimestamp as Date).getTime() / 1000);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      throw new Error('startTimestamp must be earlier than endTimestamp');
    }
    if (end > Math.floor(expectedAcceptance.getTime() / 1000) + 90 * 86400) {
      throw new Error('Adaptive proposals must end within 90 days after acceptance');
    }
    return;
  }
  if (input.governance && (hasStart || hasEnd)) {
    throw new Error('Explicit proposal windows require adaptive or granular governance');
  }
}

function councilStepCount(input: GovernanceProposalInput): number {
  const config = input.governance;
  const mandatoryPre = config?.preGovernanceStageCount ?? Number(config?.hasPreGovernance ?? false);
  const mandatoryPost = config?.postGovernanceStageCount ?? 0;
  let total = 0;
  for (const [mandatory, additional] of [[mandatoryPre, input.additionalPreGovernance], [mandatoryPost, input.additionalPostGovernance]] as const) {
    if (additional !== undefined) {
      if (!config?.allowProposalCouncils || !additional.length) throw new Error('Additional councils must be permitted and nonempty');
      additional.forEach(validateCouncilStage);
    }
    const count = mandatory + (additional?.length ?? 0);
    if (!Number.isInteger(mandatory) || mandatory < 0 || count > 32) throw new Error('At most 32 councils per phase');
    total += count;
  }
  if (config && (total || config.allowProposalCouncils) && !supportsCouncilReviews(config.type)) {
    throw new Error('Council reviews require staged, cycle, or staggered governance');
  }
  return total;
}

function validateActionBranch(actions: readonly GovernanceTXN[], authority: Uint8Array): void {
  const hashes = new Set<string>();
  for (const action of actions) {
    const schema = governanceChildSchema(action.txnType);
    const message = fromBinary(schema, action.serializedTxn) as Message & { base?: BaseTXN };
    const base = message.base;
    if (!base?.publicKey?.governanceAuth || !bytesEqual(base.publicKey.governanceAuth, authority)) {
      throw new Error('Governance action must use the proposal contract authority');
    }
    if (base.feePayer || base.interfaceFee !== undefined || base.interfaceFeeId !== undefined || base.interfaceAddress !== undefined) {
      throw new Error('Governance actions cannot contain a sponsor or interface fees');
    }
    if (!base.hash || !bytesEqual(base.hash, action.txnHash)) throw new Error('Governance action hash mismatch');
    delete base.hash;
    if (!bytesEqual(createTransactionHash(toBinary(schema, message)), action.txnHash)) throw new Error('Governance action hash mismatch');
    const hash = bytesToHex(action.txnHash);
    if (hashes.has(hash)) throw new Error('Duplicate governance action within a branch');
    hashes.add(hash);
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
  assertProposalWindow(input, options.timestamp ?? new Date());
  const authority = new TextEncoder().encode(`gov_${contractId}`);
  validateActionBranch(input.governanceTxn ?? [], authority);
  for (const option of input.governanceOptionTxns ?? []) validateActionBranch(option.governanceTxn, authority);
  const councilCount = councilStepCount(input);
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

  return buildStandardTransaction({
    operation: 'buildGovernanceProposalTXN',
    schema: GovernanceProposalSchema,
    publicKeyId: input.publicKey,
    contractId,
    fields: {
      contractId,
      title: input.title,
      synopsis: input.synopsis,
      body: input.body,
      ...(input.granular ? { granular: input.granular } : {}),
      ...(input.additionalPreGovernance ? { additionalPreGovernance: { stages: input.additionalPreGovernance } } : {}),
      ...(input.additionalPostGovernance ? { additionalPostGovernance: { stages: input.additionalPostGovernance } } : {}),
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
    options: { ...options, ...(input.governance ? { proposalStages: {
      stageLengthCount: input.governance.stageLengthCount, councilStepCount: councilCount
    } } : {}) }
  });
}

export { buildGovernanceProposalTXN as buildGovernanceProposal };
