/**
 * Governance proposal shape checks shared by the proposal builder.
 *
 * Option 0 is the exact string `against` and must not carry execution
 * transactions. A proposal uses either top-level `governance_txn` or
 * `options`, never both. Other option text must not contain the words the
 * node rejects in `contains_forbidden_words`.
 */

import type { GovernanceTXN } from '../../proto/generated/txn_pb.js';

export const FORBIDDEN_OPTION_WORDS = [
  'against', 'fail', 'no', 'reject', 'oppose', 'negative',
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
export function applyProposalStageFee(feeParts: string, stageLengthCount: number, hasPreGovernance: boolean): string {
  const divisor = proposalAdditionalStageDivisor(stageLengthCount, hasPreGovernance);
  const fee = BigInt(feeParts);
  if (divisor === 0) return fee.toString();
  const extra = (fee + BigInt(divisor) - 1n) / BigInt(divisor);
  return (fee + extra).toString();
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
