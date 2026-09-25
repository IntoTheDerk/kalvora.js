/**
 * Shared smart contract parameter helpers.
 */

import { create } from '@bufbuild/protobuf';

import { ParametersSchema } from '../../../proto/generated/txn_pb.js';
import type { Parameters } from '../../../proto/generated/txn_pb.js';

/**
 * Valid parameter types for smart contract calls.
 */
export type ParameterType =
  | 'bytes'
  | 'uint32'
  | 'uint64'
  | 'string';

/**
 * Helper constants for parameter types.
 */
export const ParamType = {
  BYTES: 'bytes' as const,
  UINT32: 'uint32' as const,
  UINT64: 'uint64' as const,
  STRING: 'string' as const
} as const;

/**
 * Parameter for smart contract execution or instantiation.
 */
export type SmartContractParameter = {
  type: ParameterType | string;
  value: string | Uint8Array | number | boolean;
};

function toBytes(value: string | Uint8Array | number | boolean): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (typeof value === 'number') return new TextEncoder().encode(value.toString());
  if (typeof value === 'boolean') return new TextEncoder().encode(value ? '1' : '0');
  return new Uint8Array();
}

export function buildSmartContractParameters(
  parameters: SmartContractParameter[] = []
): Parameters[] {
  return parameters.map((parameter) => create(ParametersSchema, {
    value: toBytes(parameter.value),
    type: parameter.type
  }));
}
