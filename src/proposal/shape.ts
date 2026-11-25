/**
 * Governance proposal shape checks shared by the proposal builder.
 *
 * Option 0 is the exact string `against` and must not carry execution
 * transactions. A proposal uses either top-level `governance_txn` or
 * `options`, never both. Other option text must not contain the words the
 * node rejects in `contains_forbidden_words`.
 */

import { GOVERNANCE_TYPE, type Governance, type GovernanceTXN, type PreGovernance, type VotingInstrumentRatio } from '../../proto/generated/txn_pb.js';
import { isKalvoraMintId } from '../shared/network/constants.js';

export function assertBasisPoints(value: number | undefined, field: string): void {
  if (value === undefined || !Number.isInteger(value) || value < 1 || value > 10000) {
    throw new RangeError(`${field} must be an integer from 1 to 10000`);
  }
}

export function validateCouncilStage(stage: Omit<PreGovernance, '$typeName'>): void {
  if (!isKalvoraMintId(stage.votingInstrument)) throw new Error('Council voting instrument must be a canonical contract ID');
  if (!Number.isInteger(stage.days) || stage.days < 1 || stage.days > 0xffffffff) throw new RangeError('Invalid council duration');
  assertBasisPoints(stage.threshold, 'council threshold');
  assertBasisPoints(stage.regularQuorum, 'council regularQuorum');
}

/** Validate ratios and council configuration at contract creation or update. */
export function validateGovernanceSettings(governance: Governance): void {
  const { votingInstrument, votingRatio, preGovernance, preGovernanceStages, postGovernanceStages } = governance;
  if (preGovernance && preGovernanceStages.length) throw new Error('Set either singleton or array PRE councils');
  if (preGovernanceStages.length > 32 || postGovernanceStages.length > 32) throw new Error('At most 32 councils per phase');
  if (governance.type === GOVERNANCE_TYPE.GRANULAR && (preGovernance || preGovernanceStages.length ||
      postGovernanceStages.length || governance.allowProposalCouncils || votingInstrument.length || votingRatio.length ||
      governance.regularQuorum || governance.threshold || governance.stageLength.length || governance.startTimestamp ||
      governance.votingPeriod !== undefined || governance.proposalPeriod !== undefined || governance.maxApproved !== undefined ||
      governance.chickenDinner !== undefined)) throw new Error('Granular governance uses proposal-specific rules and no councils');
  if (preGovernance) validateCouncilStage(preGovernance);
  preGovernanceStages.forEach(validateCouncilStage);
  postGovernanceStages.forEach(validateCouncilStage);
  const unmatched = new Set(votingInstrument);
  if (unmatched.size !== votingInstrument.length) throw new Error('Duplicate voting instrument');
  for (const ratio of votingRatio) {
    if (!unmatched.delete(ratio.contractId)) throw new Error('Voting ratio must match one distinct instrument');
    assertVotingRatio(ratio);
  }
  if (unmatched.size) throw new Error('Each voting instrument requires one ratio');
}

function assertVotingRatio(ratio: Pick<VotingInstrumentRatio, 'numerator' | 'denominator'>): void {
  const max = (1n << 64n) - 1n;
  if (ratio.numerator < 1n || ratio.denominator < 1n || ratio.numerator > max || ratio.denominator > max) {
    throw new RangeError('Voting ratios must be positive uint64 values');
  }
}

/** Convert one instrument/choice aggregate with its frozen ratio. Pass denomination 1 for NFTs or SBTs. */
export function regularVotingUnits(raw: bigint, denomination: bigint, ratio: Pick<VotingInstrumentRatio, 'numerator' | 'denominator'>): bigint {
  assertVotingRatio(ratio);
  if (raw < 0n || denomination < 1n) throw new RangeError('Invalid vote weight or denomination');
  return raw * ratio.numerator / (denomination * ratio.denominator);
}

export const FORBIDDEN_OPTION_WORDS = [
  'against', 'fail', 'no', 'yes', 'pass', 'reject', 'oppose', 'negative',
  'decline', 'deny', 'veto', 'refuse', 'nay', 'cancel',
  'abort', 'stop', 'block', 'disapprove', 'dissent', 'nothing'
] as const;

export interface GovernanceOptionInput {
  optionIndex: number;
  governanceTxn: GovernanceTXN[];
}

/**
 * Extra fee divisor applied when the contract has pre-governance.
 * Matches `process_proposal.cpp`: `stage_length_size + 1`, or `2` when the
 * contract has no stage lengths. Contracts without pre-governance use `0`.
 */
export function proposalAdditionalStageDivisor(stageLengthCount: number, hasPreGovernance: boolean): number {
  if (!hasPreGovernance) return 0;
  if (!Number.isInteger(stageLengthCount) || stageLengthCount < 0) {
    throw new RangeError('stageLengthCount must be a non-negative integer');
  }
  return stageLengthCount > 0 ? stageLengthCount + 1 : 2;
}

/** Add the pre-governance stage surcharge: `fee + ceil(fee / divisor)`. */
export function applyProposalStageFee(feeParts: string, stageLengthCount: number, councils: boolean | number): string {
  const count = Number(councils);
  if (!Number.isInteger(count) || count < 0 || count > 64) throw new RangeError('Invalid council count');
  const divisor = proposalAdditionalStageDivisor(stageLengthCount, count > 0);
  const fee = BigInt(feeParts);
  if (divisor === 0) return fee.toString();
  const extra = (fee + BigInt(divisor) - 1n) / BigInt(divisor);
  return (fee + BigInt(count) * extra).toString();
}

function containsForbiddenWord(option: string): boolean {
  const lower = option.toLowerCase();
  return FORBIDDEN_OPTION_WORDS.some(word => lower.includes(word));
}

export function assertGovernanceProposalShape(input: {
  options?: readonly string[];
  governanceTxn?: readonly GovernanceTXN[];
  governanceOptionTxns?: readonly GovernanceOptionInput[];
  allowMulti?: boolean;
}): void {
  const options = input.options ?? [];
  const governanceTxn = input.governanceTxn ?? [];
  const optionTxns = input.governanceOptionTxns ?? [];
  if (options.length > 0 && governanceTxn.length > 0) {
    throw new Error('a proposal cannot set both options and governance_txn');
  }
  if (input.allowMulti === false && options.length > 0) {
    throw new Error('this contract does not allow multi-option proposals');
  }
  if (options.length === 0) {
    if (optionTxns.length > 0) {
      throw new Error('governance_option_txns require options');
    }
    return;
  }
  if (options[0] !== 'against') {
    throw new Error('option 0 must be the exact string "against"');
  }
  const seen = new Set<string>();
  options.forEach((option, index) => {
    if (option !== option.trim() || option.length === 0) {
      throw new Error(`options[${index}] must be non-empty canonical text`);
    }
    if (seen.has(option)) throw new Error(`duplicate option "${option}"`);
    seen.add(option);
    if (index > 0 && containsForbiddenWord(option)) {
      throw new Error(`options[${index}] contains a forbidden word`);
    }
  });
  const used = new Set<number>();
  for (const entry of optionTxns) {
    if (!Number.isInteger(entry.optionIndex) || entry.optionIndex <= 0 || entry.optionIndex >= options.length) {
      throw new Error('governance option indexes must be unique, greater than 0, and less than options.length');
    }
    if (used.has(entry.optionIndex)) {
      throw new Error(`duplicate governance option index ${entry.optionIndex}`);
    }
    used.add(entry.optionIndex);
  }
}
