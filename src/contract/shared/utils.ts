/**
 * Shared utilities for contract operations
 */

import bs58 from 'bs58';

import { GOVERNANCE_TYPE, type ContractFees, type Governance, type PreMintWallet, type RestrictedKey } from '../../../proto/generated/txn_pb.js';
import { validateGovernanceSettings } from '../../proposal/shape.js';
import { isCanonicalContractId } from '../../protocol/contract-id.js';
import { generateAddressFromPublicKey, isPaymentRecipientBytes } from '../../shared/crypto/address-utils.js';
import { isWalletAddressBytes } from '../../shared/crypto/falcon-address.js';
import { parseUint256 } from '../../shared/tx/standard.js';
import { toSmallestUnits } from '../../shared/utils/unified-amount-conversion.js';
import { isValidContractId } from '../../shared/utils/validation.js';
import type { SigningKey } from '../../sign/builder.js';
import type { AmountInput } from '../../types/index.js';

/**
 * Validates contract creation options
 */
const TOKEN_SYMBOL = /^[A-Z0-9]{3,20}$/u;
const TOKEN_NAME = /^[A-Za-z0-9 ]{3,200}$/u;

/** Reject options removed at clean genesis before protobuf creation drops them. */
export function validateCurrentContractFields(options: {
  restrictedKeys?: readonly RestrictedKey[];
  governance?: Governance;
  contractId?: string;
  contractFees?: ContractFees;
}): void {
  if ('quashThreshold' in options) {
    throw new Error('quashThreshold is retired and must not be supplied');
  }
  const keys = options.restrictedKeys ?? [];
  if (keys.length > 50) throw new Error('restrictedKeys cannot exceed 50');
  let parents = 0;
  let directRecovery = false;
  const directAuthorities = new Set<string>();
  for (const key of keys) {
    for (const field of ['timeDelay', 'global', 'quash']) {
      if (field in key) {
        throw new Error(`restrictedKeys.${field} is retired and must not be supplied`);
      }
    }
    const id = key.publicKey;
    if (!id || id.single.length || id.multi || id.witnesses.length ||
        [id.parentContract, id.walletAddress, id.smartContractAuth, id.governanceAuth].filter(value => value !== undefined).length !== 1) {
      throw new Error('Each restricted key must have exactly one typed authority and no witnesses');
    }
    if (id.walletAddress !== undefined && !isWalletAddressBytes(id.walletAddress)) throw new Error('Invalid grant wallet address');
    if (id.parentContract !== undefined) {
      if (!isCanonicalContractId(id.parentContract)) throw new Error('Invalid parent contract ID');
      if (id.parentContract === options.contractId) throw new Error('A contract cannot be its own parent');
      parents++;
      continue;
    }
    let authority: string;
    if (id.walletAddress !== undefined) {
      authority = `wallet:${bs58.encode(id.walletAddress)}`;
    } else if (id.governanceAuth !== undefined) {
      authority = new TextDecoder().decode(id.governanceAuth);
      if (!authority.startsWith('gov_') || !isCanonicalContractId(authority.slice(4))) throw new Error('Invalid governance authority');
    } else {
      authority = new TextDecoder().decode(id.smartContractAuth);
      if (!/^sc_[A-Za-z0-9_]+_(?:0|[1-9][0-9]*)$/u.test(authority)) throw new Error('Invalid smart contract authority');
    }
    if (directAuthorities.has(authority)) throw new Error('Duplicate direct grant authority');
    directAuthorities.add(authority);
    if (key.updateContract) directRecovery = true;
  }
  if (parents > 1) throw new Error('Only one parent contract is allowed');
  if (parents && !directRecovery) throw new Error('An inherited grant requires a direct update_contract recovery grant');
  const fees = options.contractFees;
  if (fees && Number(fees.burn) !== 100 && Number(fees.validator) !== 100 &&
      (!fees.feeAddress || !isPaymentRecipientBytes(fees.feeAddress))) {
    throw new Error('The contract fee recipient must be a wallet address or the burn address');
  }
  if (options.governance?.type === GOVERNANCE_TYPE.REMOVE) {
    throw new Error('Governance REMOVE is disabled by the current network consensus policy');
  }
  if (options.governance) validateGovernanceSettings(options.governance);
}

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
  if (!TOKEN_SYMBOL.test(options.symbol)) {
    throw new Error('Symbol must be 3-20 characters from A-Z and 0-9');
  }

  if (!options.name || options.name.trim() === '') {
    throw new Error('Name must be provided and non-empty');
  }
  if (!TOKEN_NAME.test(options.name)) {
    throw new Error('Name must be 3-200 characters from letters, digits, and spaces');
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
  privateKeyBase58: SigningKey;
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
  premintWallets?: PreMintWallet[];
  maxSupply?: string;
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
    if (options.maxSupply !== undefined) {
      const addresses = new Set<string>();
      let total = 0n;
      for (const premint of options.premintWallets) {
        if (!isWalletAddressBytes(premint.address)) throw new Error('Invalid premint wallet address');
        const address = bs58.encode(premint.address);
        if (addresses.has(address)) throw new Error('Duplicate premint wallet address');
        addresses.add(address);
        total += BigInt(parseUint256(premint.amount, 'premint amount'));
      }
      if (total > BigInt(options.maxSupply)) throw new Error('Premint amounts exceed maxSupply');
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
 * Threshold uses 10000 = 100% (basis points).
 * 
 * @param percent - Percentage value (e.g., 20.5 for 20.5%)
 * @returns number - Threshold value (e.g., 20.5% = 2050)
 * 
 * @example
 * ```typescript
 * const threshold = convertPercentToThreshold(20.5); // Returns: 2050
 * ```
 */
export function convertPercentToThreshold(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error('Percent must be between 0 and 100');
  }
  return Math.round(percent * 100);
}

/**
 * Converts a percentage value (with max 2 decimal precision) to contract fee percentage format.
 * Used for the fee field when type is PERCENTAGE. The burn and validator
 * fields take whole percentages directly, with a combined maximum of 100.
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
