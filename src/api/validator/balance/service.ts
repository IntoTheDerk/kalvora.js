/**
 * Validator Balance Service
 * 
 * Handles balance retrieval from the Kalvora validator via gRPC.
 * Contains all business logic for balance operations.
 */

import { create } from '@bufbuild/protobuf';
import Decimal from 'decimal.js';


import { BalanceResponseSchema } from '../../../../proto/generated/api_pb.js';
import type { BalanceResponse } from '../../../../proto/generated/api_pb.js';
import { createValidatorAPIClient } from '../../../grpc/api/validator-api-client.js';
import type { GRPCConfig } from '../../../types/index.js';

/**
 * Enhanced Balance Response with nice computed fields
 */
export interface EnhancedBalanceResponse extends BalanceResponse {
  /**
   * Human-readable balance (balance / denomination)
   */
  balanceNice: string;
  
  /**
   * Human-readable rate (rate / 1e18)
   */
  rateNice: string;
}

/**
 * Get the balance for an address and contract ID
 * 
 * @param address - The wallet address (base58 encoded)
 * @param contractId - The contract ID to get balance for
 * @param options - gRPC configuration options
 * @returns Promise<EnhancedBalanceResponse> - Enhanced balance information response
 * 
 * @note If the wallet doesn't have that token, the validator returns values of `balance: "0"`, `rate: "0"`, and `denomination: "0"` (raw units) to indicate a zero balance. This means that when a wallet doesn't have that balance, the rate and denomination data may be inaccurate. Please process 0 accordingly to avoid division by zero errors.
 */
export async function getBalance(
  address: string,
  contractId: string,
  options: GRPCConfig = {}
): Promise<EnhancedBalanceResponse> {
  // Input validation
  if (!address || typeof address !== 'string' || address.trim() === '') {
    throw new Error('Address must be a non-empty string');
  }
  
  if (!contractId || typeof contractId !== 'string' || contractId.trim() === '') {
    throw new Error('Contract ID must be a non-empty string');
  }
  
  try {
    // Create validator API client
    const client = createValidatorAPIClient(options);
    
    // Make gRPC call using the client's getBalance method
    const response: BalanceResponse = await client.getBalance(address, contractId);

    return enhanceBalanceResponse(response);
  } catch (error) {
    // Handle invalid wallet error - return empty balance response
    const err = error as { details?: string; code?: string; message?: string };
    if ((err.details && err.details.includes('Invalid Wallet')) || (err.message && err.message.includes('Invalid Wallet')) || err.code === 'INVALID_ARGUMENT') {
      const emptyResponse = create(BalanceResponseSchema, {
        balance: '0',
        denomination: '1',
        rate: '0'
      }) as BalanceResponse;
      return enhanceBalanceResponse(emptyResponse);
    }
    throw new Error(`Failed to get balance from validator: ${(error as Error).message}`);
  }
}

/**
 * Enhance balance response with nice computed fields
 */
function enhanceBalanceResponse(response: BalanceResponse): EnhancedBalanceResponse {
  // Calculate balanceNice = balance / denomination
  const balanceDecimal = new Decimal(response.balance).div(new Decimal(response.denomination || '1'));
  const balanceNice = balanceDecimal.toString();

  // Calculate rateNice = rate / 1e18
  const rateDecimal = new Decimal(response.rate || '0').div(new Decimal(10).pow(18));
  const rateNice = rateDecimal.toString();

  return {
    ...response,
    balanceNice,
    rateNice
  } as unknown as EnhancedBalanceResponse;
}

/**
 * Get balances for multiple addresses with the same contract ID
 * 
 * @param addresses - Array of wallet addresses
 * @param contractId - The contract ID to get balance for
 * @param options - gRPC configuration options
 * @returns Promise<EnhancedBalanceResponse[]> - Array of enhanced balance information responses
 */
export async function getBalances(
  addresses: string[],
  contractId: string,
  options: GRPCConfig = {}
): Promise<EnhancedBalanceResponse[]> {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('Addresses must be a non-empty array');
  }

  if (!contractId || typeof contractId !== 'string' || contractId.trim() === '') {
    throw new Error('Contract ID must be a non-empty string');
  }

  try {
    const balances: EnhancedBalanceResponse[] = [];
    for (const address of addresses) {
      const balance = await getBalance(address, contractId, options);
      balances.push(balance);
    }
    return balances;
  } catch (error) {
    throw new Error(`Failed to get balances from validator: ${(error as Error).message}`);
  }
}
