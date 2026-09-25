/**
 * Validator Fee Info Service
 * 
 * Handles fee information retrieval from the Kalvora validator via gRPC.
 * Uses the GetTokenFeeInfo API to get comprehensive token fee information.
 */

import type { TokenFeeInfoResponse } from '../../../../proto/generated/api_pb.js';
import { CONTRACT_FEE_TYPE } from '../../../../proto/generated/txn_pb.js';
import { createValidatorAPIClient } from '../../../grpc/api/validator-api-client.js';
import { logger } from '../../../shared/monitoring/index.js';
import type { GRPCConfig } from '../../../types/index.js';

/**
 * Parameters for GetTokenFeeInfo API call
 */
export interface GetTokenFeeInfoParams {
  contractIds?: string[];
  includeRates?: boolean;
  includeContractFees?: boolean;
}

/**
 * Helper to default empty strings to "0"
 */
function defaultToZero(val: string | undefined): string {
  return val && val.length > 0 ? val : '0';
}

/**
 * Helper to default empty denomination to "1"
 */
function defaultDenomination(val: string | undefined): string {
  return val && val.length > 0 ? val : '1';
}

/**
 * Get comprehensive token fee information from the validator
 * 
 * @param params - Parameters to customize the fee information retrieval
 * @param options - gRPC configuration options
 * @returns Promise<TokenFeeInfoResponse> - Token fee information response
 */
export async function getTokenFeeInfo(
  params: GetTokenFeeInfoParams = {},
  options: GRPCConfig = {}
): Promise<TokenFeeInfoResponse> {
  try {
    const client = createValidatorAPIClient(options);
    
    // Call the new GetTokenFeeInfo API
    const response = await client.getTokenFeeInfo({
      contractIds: params.contractIds || []
    });

    // Process response to ensure defaults
    response.tokens.forEach(token => {
      // Default rate to "0" if empty
      token.rate = defaultToZero(token.rate);
      
      // Default denomination to "1" if empty (avoid division by zero/empty)
      token.denomination = defaultDenomination(token.denomination);

      // Default allowed_fees and used_fees to "0" if empty
      token.allowedFees = defaultToZero(token.allowedFees);
      token.usedFees = defaultToZero(token.usedFees);

      if (token.contractFees) {
        // Default fee amounts to "0" if empty
        token.contractFees.fee = defaultToZero(token.contractFees.fee);
        token.contractFees.burn = defaultToZero(token.contractFees.burn);
        token.contractFees.validator = defaultToZero(token.contractFees.validator);

        // Process contract fee type
        const feeType = token.contractFees.contractFeeType;
        
        // Always ensure contractFeeType is set to a valid numeric enum value
        if (feeType === undefined || feeType === null) {
          // Default to FIXED (value 0) if not specified by validator
          token.contractFees.contractFeeType = CONTRACT_FEE_TYPE.FIXED;
        } else if (typeof feeType === 'string') {
          // Handle string representations from validator
          const feeTypeStr = (feeType as string).toUpperCase();
          switch (feeTypeStr) {
          case 'FIXED':
            token.contractFees.contractFeeType = CONTRACT_FEE_TYPE.FIXED;
            break;
          case 'CUR_EQUIVALENT':
            token.contractFees.contractFeeType = CONTRACT_FEE_TYPE.CUR_EQUIVALENT;
            break;
          case 'PERCENTAGE':
            token.contractFees.contractFeeType = CONTRACT_FEE_TYPE.PERCENTAGE;
            break;
          case 'NONE':
            token.contractFees.contractFeeType = CONTRACT_FEE_TYPE.NONE;
            break;
          default:
            logger.warn('Unknown contract fee type, defaulting to FIXED', {
              contractId: token.contractId,
              feeType,
              operation: 'parseContractFeeType'
            });
            token.contractFees.contractFeeType = CONTRACT_FEE_TYPE.FIXED;
            break;
          }
        }
      }
    });

    // Return the proto response directly
    return response;
  } catch (error) {
    throw new Error(`Failed to get token fee info from validator: ${(error as Error).message}`);
  }
}
