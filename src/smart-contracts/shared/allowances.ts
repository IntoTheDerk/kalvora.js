import { create } from '@bufbuild/protobuf';

import { SmartContractAllowanceSchema, type SmartContractAllowance } from '../../../proto/generated/txn_pb.js';
import { requireContractId, parseUint256 } from '../../shared/tx/standard.js';

/** A signed caller-wallet spending budget, shared across the entire execution. */
export interface SmartContractAllowanceInput {
  /** Canonical token contract ID. Unlisted tokens have a zero spending budget. */
  contractId: string;
  /** Raw token parts (uint256), or exactly `"unlimited"` for this token only. */
  allowedAmount: string;
}

/** Validate allowances before constructing an execute or instantiate transaction. */
export function buildSmartContractAllowances(
  inputs: readonly SmartContractAllowanceInput[] | undefined
): SmartContractAllowance[] {
  if (inputs === undefined) return [];
  if (!Array.isArray(inputs)) throw new Error('allowances must be an array');
  const seen = new Set<string>();
  return inputs.map((input: SmartContractAllowanceInput, index: number) => {
    const field = `allowances[${index}]`;
    if (input === null || typeof input !== 'object') throw new Error(`${field} must be an object`);
    if ('unlimited' in input) throw new Error(`${field}.unlimited is retired; use allowedAmount: "unlimited"`);
    const contractId = requireContractId(input.contractId, `${field}.contractId`);
    if (seen.has(contractId)) throw new Error(`${field}.contractId must be unique`);
    seen.add(contractId);
    if (typeof input.allowedAmount !== 'string' || !/^(?:[0-9]+|unlimited)$/u.test(input.allowedAmount)) {
      throw new Error(`${field}.allowedAmount must be uint256 decimal parts or exactly "unlimited"`);
    }
    const allowedAmount = input.allowedAmount === 'unlimited'
      ? 'unlimited'
      : parseUint256(input.allowedAmount, `${field}.allowedAmount`).toString();
    return create(SmartContractAllowanceSchema, { contractId, allowedAmount });
  });
}
