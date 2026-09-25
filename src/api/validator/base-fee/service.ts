/**
 * Validator Base Fee Service
 * 
 * Retrieves base fee information (key fee and byte fee) from the Kalvora validator via gRPC.
 * This replaces locally hardcoded fee constants with network-sourced values.
 */

import type { BaseFeeResponse } from '../../../../proto/generated/api_pb.js';
import type { PublicKey } from '../../../../proto/generated/txn_pb.js';
import { TRANSACTION_TYPE } from '../../../../proto/generated/txn_pb.js';
import { createValidatorAPIClient } from '../../../grpc/api/validator-api-client.js';
import type { GRPCConfig } from '../../../types/index.js';

/**
 * Enhanced Base Fee Response with human-readable computed fields
 */
export interface EnhancedBaseFeeResponse extends BaseFeeResponse {
  /**
   * Human-readable key fee in USD (key_fee / 1e18)
   */
  keyFeeUsd: string;
  
  /**
   * Human-readable byte fee in USD (byte_fee / 1e18)
   */
  byteFeeUsd: string;
}

/**
 * Get the base fee rates for a transaction type and public key
 * 
 * The validator returns:
 * - `key_fee`: Total fee for the signer's key type (includes key, hash, and restricted multiplier)
 * - `byte_fee`: Per-byte fee for the given transaction type
 * 
 * Both values are in 1e18 = $1.00 format.
 * 
 * @param txnType - The transaction type (from TRANSACTION_TYPE enum)
 * @param publicKey - Optional public key (determines key type fee, hash fee, restricted multiplier)
 * @param options - gRPC configuration options
 * @returns Promise<EnhancedBaseFeeResponse> - Base fee information
 */
export async function getBaseFee(
  txnType: TRANSACTION_TYPE,
  publicKey?: PublicKey,
  options: GRPCConfig = {}
): Promise<EnhancedBaseFeeResponse> {
  try {
    const client = createValidatorAPIClient(options);
    const response: BaseFeeResponse = await client.getBaseFee(publicKey, txnType);

    return enhanceBaseFeeResponse(response);
  } catch (error) {
    throw new Error(`Failed to get base fee from validator: ${(error as Error).message}`);
  }
}

/**
 * Enhance base fee response with human-readable USD values
 */
function enhanceBaseFeeResponse(response: BaseFeeResponse): EnhancedBaseFeeResponse {
  // Convert from 1e18 format to USD
  const keyFeeNum = Number(BigInt(response.keyFee || '0')) / 1e18;
  const byteFeeNum = Number(BigInt(response.byteFee || '0')) / 1e18;

  return {
    ...response,
    keyFeeUsd: keyFeeNum.toString(),
    byteFeeUsd: byteFeeNum.toString()
  } as unknown as EnhancedBaseFeeResponse;
}
