/**
 * Shared utilities for contract operations
 */

import { generateAddressFromPublicKey } from '../../shared/crypto/address-utils.js';
import { toSmallestUnits } from '../../shared/utils/unified-amount-conversion.js';
import { isValidContractId } from '../../shared/utils/validation.js';
import type { AmountInput } from '../../types/index.js';

/**
 * Validates contract creation options
 */
export function validateCreateContractOptions(options: {
  contractId: string;
  symbol: string;
  name: string;
  contractVersion: bigint;
  type: unknown;
}): void {
  if (!options.contractId || !isValidContractId(options.contractId)) {
    throw new Error('ContractId must be a valid Kalvora mint ID (e.g., KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao)');
  }

  if (!options.symbol || options.symbol.trim() === '') {
    throw new Error('Symbol must be provided and non-empty');
  }

  if (!options.name || options.name.trim() === '') {
    throw new Error('Name must be provided and non-empty');
  }

  if (options.contractVersion < 0) {
    throw new Error('Contract version must be non-negative');
  }

  if (!options.type && options.type !== 0) {
    throw new Error('Contract type must be provided (TOKEN=0, NFT=1, SBT=2)');
  }
}

/**
 * Validates contract update options
 */
export function validateUpdateContractOptions(options: {
  contractId: string;
  contractVersion: bigint;
}): void {
  if (!options.contractId || !isValidContractId(options.contractId)) {
    throw new Error('ContractId must be a valid Kalvora mint ID (e.g., KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao)');
  }

  if (options.contractVersion < 1) {
    throw new Error('Contract version must be at least 1 for updates');
  }
}

/**
 * Validates public key and private key are provided
 */
export function validateKeyPair(options: {
  publicKeyBase58Identifier: string;
  privateKeyBase58: string;
}): void {
  if (!options.publicKeyBase58Identifier) {
    throw new Error('Public key identifier is required');
  }

  if (!options.privateKeyBase58) {
    throw new Error('Private key is required');
  }

  // Validate address can be generated from public key
  try {
    generateAddressFromPublicKey(options.publicKeyBase58Identifier);
  } catch (error) {
    throw new Error(`Invalid public key identifier: ${(error as Error).message}`);
  }
}

/**
 * Validates that premint wallets are only used with TOKEN contract type
 */
export function validatePremintWallets(options: {
  contractType: unknown;
  premintWallets?: unknown[];
}): void {
  if (options.premintWallets && options.premintWallets.length > 0) {
    // Check if contract type is TOKEN (0)
    // CONTRACT_TYPE.TOKEN = 0, CONTRACT_TYPE.NFT = 1, CONTRACT_TYPE.SBT = 2
    if (options.contractType !== 0) {
      const typeNames: Record<number, string> = {
        1: 'NFT',
        2: 'SBT'
      };
      const typeName = typeNames[options.contractType as number] || 'non-TOKEN';
      throw new Error(
        'Premint wallets can only be used with TOKEN contract type. ' +
        `Current contract type is ${typeName} (${options.contractType}). ` +
        'Please remove premintWallets or change contract type to TOKEN.'
      );
    }
  }
}

/**
 * Converts a decimal amount (e.g., 1.5 for 1.5 tokens) to parts based on denomination.
 * This is useful for premint wallets and other places where you want to specify amounts
 * in human-readable format rather than raw parts.
 * 
 * @param amount - Decimal amount (e.g., 1.5 for 1.5 tokens)
 * @param contractId - Contract ID for the token
 * @param denomination - Optional denomination string (e.g., 'KALV' or '1000000000000000000')
 * @returns string - Amount in parts (smallest units)
 * 
 * @example
 * ```typescript
 * // With denomination
 * const parts = convertAmountToParts(1.5, 'MYT0000', '1000000000000000000');
 * // Returns: '1500000000000000000' (1.5 tokens with 18 decimals)
 * 
 * // Without denomination (uses token cache)
 * const parts = convertAmountToParts(1.5, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
 * ```
 */
export function convertAmountToParts(
  amount: AmountInput,
  contractId: string,
  denomination?: string
): string {
  return toSmallestUnits(amount, contractId, denomination ? { denomination } : {});
}

/**
 * Converts a percentage value (with max 2 decimal precision) to regular quorum format.
 * Regular quorum uses 10000 = 100% (basis points × 100)
 * 
 * @param percent - Percentage value (e.g., 50.5 for 50.5%)
 * @returns number - Quorum value (e.g., 50.5% = 5050)
 * 
 * @example
 * ```typescript
 * const quorum = convertPercentToRegularQuorum(50.5); // Returns: 5050
 * ```
 */
export function convertPercentToRegularQuorum(percent: number): number {
  if (percent < 0 || percent > 100) {
    throw new Error('Percent must be between 0 and 100');
  }
  // Round to 2 decimal places, then convert: 50.5% = 5050 (10000 = 100%)
  return Math.round(percent * 100);
}

/**
 * Converts a percentage value (with max 2 decimal precision) to threshold format.
 * Threshold uses 1000 = 100% (basis points × 10)
 * 
 * @param percent - Percentage value (e.g., 20.5 for 20.5%)
 * @returns number - Threshold value (e.g., 20.5% = 205)
 * 
 * @example
 * ```typescript
 * const threshold = convertPercentToThreshold(20.5); // Returns: 205
 * ```
 */
export function convertPercentToThreshold(percent: number): number {
  if (percent < 0 || percent > 100) {
    throw new Error('Percent must be between 0 and 100');
  }
  // Round to 2 decimal places, then convert: 20.5% = 205 (1000 = 100%)
  return Math.round(percent * 10);
}

/**
 * Converts a percentage value (with max 2 decimal precision) to contract fee percentage format.
 * Used for: fee (when type is PERCENTAGE), burn, and validator fields.
 * Contract fees use 100% = 1,000,000,000,000,000,000 (quintillion)
 * 
 * @param percent - Percentage value (e.g., 50.5 for 50.5%)
 * @returns string - Fee value in parts (e.g., 50.5% = "505000000000000000")
 * 
 * @example
 * ```typescript
 * const feePercent = convertPercentToContractFeePercent(50.5); // Returns: "505000000000000000"
 * ```
 */
export function convertPercentToContractFeePercent(percent: number): string {
  if (percent < 0 || percent > 100) {
    throw new Error('Percent must be between 0 and 100');
  }
  // Round to 2 decimal places, then convert: 50.5% = 505000000000000000 (100% = 1000000000000000000)
  const quintillion = 1000000000000000000n;
  const percentScaled = Math.round(percent * 100); // 50.5% = 5050 (basis points)
  const result = (BigInt(percentScaled) * quintillion) / 10000n;
  return result.toString();
}

/**
 * Converts a dollar amount (with max 2 decimal precision) to contract fee format.
 * Used for: fee field when type is FIXED or CUR_EQUIVALENT.
 * Contract fees use $1.00 = 1,000,000,000,000,000,000 (quintillion)
 * 
 * @param dollars - Dollar amount (e.g., 1.50 for $1.50)
 * @returns string - Fee value in parts (e.g., $1.50 = "1500000000000000000")
 * 
 * @example
 * ```typescript
 * const feeAmount = convertDollarAmountToContractFee(1.50); // Returns: "1500000000000000000"
 * ```
 */
export function convertDollarAmountToContractFee(dollars: number): string {
  if (dollars < 0) {
    throw new Error('Dollar amount must be non-negative');
  }
  // Round to 2 decimal places, then convert: $1.50 = 1500000000000000000
  const quintillion = 1000000000000000000n;
  const cents = Math.round(dollars * 100); // $1.50 = 150 cents
  const result = (BigInt(cents) * quintillion) / 100n;
  return result.toString();
}
