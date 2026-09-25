/**
 * Universal Fee Calculator for Kalvora JS SDK
 * Handles network fees (base fees), contract-specific fees, and interface fees with automatic or manual specification
 */

import { toBinary } from '@bufbuild/protobuf';
import bs58 from 'bs58';

import { CONTRACT_FEE_TYPE } from '../../../proto/generated/txn_pb.js';
import type {
  CoinTXN,
  MintTXN,
  ItemizedMintTXN,
  InstrumentContract,
  GovernanceVote,
  GovernanceProposal,
  SmartContractTXN,
  SmartContractExecuteTXN,
  SmartContractInstantiateTXN,
  ExpenseRatioTXN,
  NFTTXN,
  ContractUpdateTXN,
  DelegatedTXN,
  QuashTXN,
  RevokeTXN,
  ComplianceTXN,
  BurnSBTTXN,
  AllowanceTXN,
  ProposalCancelTXN,
  ValidatorRegistration,
  ValidatorHeartbeat,
  ProposalResult,
  RequiredVersion,
  ContractFees
} from '../../../proto/generated/txn_pb.js';
import type { PublicKey } from '../../../proto/generated/txn_pb.js';
import { getSchemaForTypeName } from '../../adapter/serialization.js';
import { getTokenFeeInfo } from '../../api/handler/token-info/service.js';
import { getBalance } from '../../api/validator/balance/service.js';
import { getBaseFee, type EnhancedBaseFeeResponse } from '../../api/validator/base-fee/service.js';
import type { 
  AmountInput,
  GRPCConfig
} from '../../types/index.js';
import { getKeyTypeFromPublicKey, getPublicKeyIdentifierFromBytes, sanitizeAndDecodeAddress } from '../crypto/address-utils.js';
import { KEY_TYPE } from '../crypto/constants.js';
import { logger } from '../monitoring/index.js';
import { KALVORA_NATIVE_TOKEN } from '../network/constants.js';
import { 
  TRANSACTION_TYPE
} from '../protobuf/index.js';
import { 
  toDecimal, 
  Decimal 
} from '../utils/amount-utils.js';
import { type TokenInfo, normalizeContractId } from '../utils/token-info.js';
import { toSmallestUnits } from '../utils/unified-amount-conversion.js';

import { 
  HASH_SIZE, 
  PROTOBUF_HASH_OVERHEAD,
  PROTOBUF_BASE_SIGNATURE_OVERHEAD,
  PROTOBUF_AUTH_SIGNATURE_OVERHEAD,
  getSignatureSize
} from './base-fee-constants.js';
import { getDenominationFallback, getDecimalPlacesFromDenomination } from './denomination-fallback.js';
import { ExchangeRateService } from './exchange-rate-service.js';

/**
 * Union type of all possible transaction types
 */
export type TransactionMessage = 
  | CoinTXN
  | MintTXN
  | ItemizedMintTXN
  | InstrumentContract
  | GovernanceVote
  | GovernanceProposal
  | SmartContractTXN
  | SmartContractExecuteTXN
  | SmartContractInstantiateTXN
  | ExpenseRatioTXN
  | NFTTXN
  | ContractUpdateTXN
  | DelegatedTXN
  | QuashTXN
  | RevokeTXN
  | ComplianceTXN
  | BurnSBTTXN
  | AllowanceTXN
  | ProposalCancelTXN
  | ValidatorRegistration
  | ValidatorHeartbeat
  | ProposalResult
  | RequiredVersion;

/**
 * Type guard to check if an object is a CoinTXN
 */
function isCoinTXN(obj: unknown): obj is CoinTXN {
  return !!(obj && typeof obj === 'object' && '$typeName' in obj && (obj as { $typeName: string }).$typeName === 'zera_txn.CoinTXN');
}

/**
 * Type guard to check if an object has auth property (CoinTXN)
 */
function hasAuthProperty(obj: unknown): obj is { auth: unknown } {
  return !!(obj && typeof obj === 'object' && 'auth' in (obj as Record<string, unknown>));
}

/**
 * Type guard to check if an object has base property
 */
function hasBaseProperty(obj: unknown): obj is { base: unknown } {
  return !!(obj && typeof obj === 'object' && 'base' in (obj as Record<string, unknown>));
}

/**
 * Fee configuration (user-configurable)
 * Will automatically calculate base fee is baseFee is not provide (baseFeeId can be provided, but defaults to 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' if not provided)
 * Will automatically calculate contract fee if contractFee is not provided (contractFeeId can be provided, but defaults to contractId if not provided)
 * Will never auto calculate interface fee. You must specify interfaceFeeId and interfaceFee
 * Any specification of fee units can be done in the WHOLE amount of the token. Example, 1.5 KALV will be converted to 1500000000
 * overestimatePercent is the MAXIMUM overestimate - the network will only take the correct amount. Only applies to base fee and contract fee, not interface fee. Applies to auto calculation and manual specification. Specify 0% if you do not want any overestimate buffer!
 */
export interface FeeConfig {
  /** Base fee instrument ID (defaults to `KALVORA_NATIVE_TOKEN`) */
  baseFeeId?: string;
  /** Base fee amount in user-friendly units (auto-calculated if not provided) */
  baseFee?: AmountInput;
  /** Base fee amount in smallest units/parts (used exactly, skips conversion and recalculation) */
  baseFeeParts?: string;
  /** Contract fee instrument (defaults to contractId) */
  contractFeeId?: string;
  /** Contract fee amount in user-friendly units (auto-calculated if not provided) */
  contractFee?: AmountInput;
  /** Contract fee amount in smallest units/parts (used exactly, skips conversion and recalculation) */
  contractFeeParts?: string;
  /** Interface fee contract ID (triggers interface fee calculation) */
  interfaceFeeId?: string;
  /** Interface fee amount (required if interfaceFeeId is specified) */
  interfaceFee?: AmountInput;
  /** Interface provider address (required if interfaceFeeId is specified) */
  interfaceAddress?: string;
  /** 
   * Overestimate percentage to add to final fee (defaults to 5.0%)
   * Supports decimal values (e.g., 0.1 for 0.1%, 5.0 for 5.0%)
   * This is the MAXIMUM overestimate - the network will only take the correct amount
   */
  overestimatePercent?: number;
  /**
   * Gas fee in USD. Only applicable for SmartContractExecuteTXN transactions.
   * This represents the computational cost fee for smart contract execution.
   * Gas costs vary significantly - simple functions may cost a few cents (1500-2000 gas units),
   * while complex operations can cost much more (tens of thousands of gas units).
   * The gas price is set by the network (currently 0.0025 cents per gas unit, configurable via governance).
   * This fee is added on top of the base transaction fee (which covers transaction size).
   * If enough gas is not provided, the execution will fail and ALL transactions run or states within will be reverted as if the execute never happened.
   * 
   * @example
   * gasFeeInUsd: 0.50  // 50 cents USD
   * gasFeeInUsd: 1.0   // 1 dollar USD
   */
  gasFeeInUsd?: number;
  /** Optional gRPC configuration for network calls */
  grpcConfig?: GRPCConfig;
  /**
   * Override for the new token balance fee check (CoinTXN only).
   * 
   * By default (undefined), the SDK calls getBalance() to check if the recipients
   * hold the transferred token and adds the network-sourced new_wallet_fee per address that doesn't.
   * 
   * - `true`  — Always add the fee per address (skip the API call). Useful when you
   *             know the destination doesn't hold the token yet, or to avoid an extra network round-trip.
   * - `false` — Never add the fee (skip the API call). Useful when you know all addresses
   *             already hold the token.
   * - `undefined` (default) — Auto-detect via getBalance() API call.
   * 
   * @example
   * // Skip balance check, always add initialization fee
   * feeConfig: { needsInitialization: true }
   * 
   * // Skip balance check, never add initialization fee  
   * feeConfig: { needsInitialization: false }
   */
  needsInitialization?: boolean;
}

/**
 * Fee config helper with for use within fee calculation -- internally filled
 */
export interface FeeConfigHelper<T extends TransactionMessage = TransactionMessage> extends FeeConfig {
  /**
   * Contract ID. Only required for CoinTXN transactions (for contract fee calculation).
   * For other transaction types, this can be omitted.
   */
  contractId?: string;
  protoObject: T;
  tokenInfoMap: Map<string, TokenInfo>;
  onBaseFeeCalculated?: (details: BaseFeeCalculationDetails) => void;
}

export interface BaseFeeCalculationDetails {
  transactionType: number;
  baseFeeId: string;
  publicKey?: PublicKey;
  baseFeeResponse: EnhancedBaseFeeResponse;
  feeMultiplier: number;
  transactionSize: number;
  feeAmountParts: string;
  newWalletFeeScaled: string;
}


/**
 * Extract transaction type from a protobuf object
 */
function extractTransactionTypeFromProtoObject(protoObject: TransactionMessage): number {
  try {
    const typeName = (protoObject as { $typeName?: string }).$typeName;
    if (typeName === 'zera_txn.CoinTXN') return TRANSACTION_TYPE.COIN_TYPE;
    if (typeName === 'zera_txn.MintTXN') return TRANSACTION_TYPE.MINT_TYPE;
    if (typeName === 'zera_txn.ItemizedMintTXN') return TRANSACTION_TYPE.ITEM_MINT_TYPE;
    if (typeName === 'zera_txn.InstrumentContract') return TRANSACTION_TYPE.CONTRACT_TXN_TYPE;
    if (typeName === 'zera_txn.GovernanceVote') return TRANSACTION_TYPE.VOTE_TYPE;
    if (typeName === 'zera_txn.GovernanceProposal') return TRANSACTION_TYPE.PROPOSAL_TYPE;
    if (typeName === 'zera_txn.SmartContractTXN') return TRANSACTION_TYPE.SMART_CONTRACT_TYPE;
    if (typeName === 'zera_txn.SmartContractExecuteTXN') return TRANSACTION_TYPE.SMART_CONTRACT_EXECUTE_TYPE;
    if (typeName === 'zera_txn.ExpenseRatioTXN') return TRANSACTION_TYPE.EXPENSE_RATIO_TYPE;
    if (typeName === 'zera_txn.NFTTXN') return TRANSACTION_TYPE.NFT_TYPE;
    if (typeName === 'zera_txn.ContractUpdateTXN') return TRANSACTION_TYPE.UPDATE_CONTRACT_TYPE;
    if (typeName === 'zera_txn.ValidatorRegistration') return TRANSACTION_TYPE.VALIDATOR_REGISTRATION_TYPE;
    if (typeName === 'zera_txn.ValidatorHeartbeat') return TRANSACTION_TYPE.VALIDATOR_HEARTBEAT_TYPE;
    if (typeName === 'zera_txn.ProposalResult') return TRANSACTION_TYPE.PROPOSAL_RESULT_TYPE;
    if (typeName === 'zera_txn.DelegatedTXN') return TRANSACTION_TYPE.DELEGATED_VOTING_TYPE;
    if (typeName === 'zera_txn.RevokeTXN') return TRANSACTION_TYPE.REVOKE_TYPE;
    if (typeName === 'zera_txn.QuashTXN') return TRANSACTION_TYPE.QUASH_TYPE;
    if (typeName === 'zera_txn.ComplianceTXN') return TRANSACTION_TYPE.COMPLIANCE_TYPE;
    if (typeName === 'zera_txn.BurnSBTTXN') return TRANSACTION_TYPE.SBT_BURN_TYPE;
    if (typeName === 'zera_txn.RequiredVersion') return TRANSACTION_TYPE.REQUIRED_VERSION;
    if (typeName === 'zera_txn.SmartContractInstantiateTXN') return TRANSACTION_TYPE.SMART_CONTRACT_INSTANTIATE_TYPE;
    if (typeName === 'zera_txn.AllowanceTXN') return TRANSACTION_TYPE.ALLOWANCE_TYPE;
    if (typeName === 'zera_txn.ProposalCancelTXN') return TRANSACTION_TYPE.PROPOSAL_CANCEL_TYPE;
    
    // If we can't determine the type, throw an error
    throw new Error('Unable to determine transaction type from protoObject structure');
  } catch (error) {
    throw new Error(`Failed to extract transaction type from protoObject: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Extract key types and restricted status from a transaction protobuf object
 */
function extractKeyTypesFromTransaction(protoObject: TransactionMessage): { keyTypes: string[], isRestricted: boolean } {
  const keyTypes: string[] = [];
  let isRestricted = false;
  
  try {
    // Check if this is a CoinTXN (has auth field with publicKey array)
    if (hasAuthProperty(protoObject) && 
        typeof protoObject.auth === 'object' && 
        protoObject.auth !== null &&
        'publicKey' in protoObject.auth && 
        Array.isArray((protoObject.auth as Record<string, unknown>).publicKey)) {
      // CoinTXN: extract key types from TransferAuthentication.publicKey array
      const authObj = protoObject.auth as Record<string, unknown>;
      for (const publicKey of authObj.publicKey as unknown[]) {
        if (typeof publicKey === 'object' && publicKey !== null && 'single' in publicKey) {
          const publicKeyObj = publicKey as Record<string, unknown>;
          // Single key - convert bytes back to string identifier for key type detection
          const publicKeyString = getPublicKeyIdentifierFromBytes(publicKeyObj.single as Uint8Array);
          
          // Check if this public key is restricted (starts with 'r_')
          if (publicKeyString.startsWith('r_')) {
            isRestricted = true;
          }
          
          const keyType = getKeyTypeFromPublicKey(publicKeyString);
          keyTypes.push(keyType);
        } else if (typeof publicKey === 'object' && publicKey !== null && 'multi' in publicKey) {
          const publicKeyObj = publicKey as Record<string, unknown>;
          if (publicKeyObj.multi && typeof publicKeyObj.multi === 'object' && publicKeyObj.multi !== null && 'publicKeys' in publicKeyObj.multi) {
            throw new Error('Multi-signature wallets are not currentlysupported in the SDK');
          }
        }
      }
    } else if (hasBaseProperty(protoObject) && 
               typeof protoObject.base === 'object' && 
               protoObject.base !== null &&
               'publicKey' in protoObject.base) {
      // Non-CoinTXN: extract key type from BaseTXN.public_key
      const baseObj = protoObject.base as unknown as Record<string, unknown>;
      const publicKey = baseObj.publicKey;
      if (typeof publicKey === 'object' && publicKey !== null && 'single' in publicKey) {
        const publicKeyObj = publicKey as Record<string, unknown>;
        const publicKeyString = getPublicKeyIdentifierFromBytes(publicKeyObj.single as Uint8Array);
        
        // Check if this public key is restricted (starts with 'r_')
        if (publicKeyString.startsWith('r_')) {
          isRestricted = true;
        }
        
        const keyType = getKeyTypeFromPublicKey(publicKeyString);
        keyTypes.push(keyType);
      } else if (typeof publicKey === 'object' && publicKey !== null && 'multi' in publicKey) {
        const publicKeyObj = publicKey as Record<string, unknown>;
        if (publicKeyObj.multi && typeof publicKeyObj.multi === 'object' && publicKeyObj.multi !== null && 'publicKeys' in publicKeyObj.multi) {
          logger.warn('Multi-signature wallet not currently supported', {
            operation: 'extractHashTypes',
            walletType: 'multi-signature'
          });
          throw new Error('Multi-signature wallet not currently supported in SDK');
        }
      }
    }
  } catch (error) {
    throw new Error(`Failed to extract key types from transaction: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Throw error if no key types found
  if (keyTypes.length === 0) {
    if (hasAuthProperty(protoObject) && 
        typeof protoObject.auth === 'object' && 
        protoObject.auth !== null &&
        'publicKey' in protoObject.auth) {
      throw new Error('Failed to detect key types from CoinTXN transaction. Check that publicKey array contains valid key structures.');
    } else if (hasBaseProperty(protoObject) && 
               typeof protoObject.base === 'object' && 
               protoObject.base !== null &&
               'publicKey' in protoObject.base) {
      throw new Error('Failed to detect key type from BaseTXN transaction. Check that publicKey contains valid key structure.');
    } else {
      throw new Error('Failed to detect key types from transaction. Transaction must have either auth.publicKey (CoinTXN) or base.publicKey (other types).');
    }
  }
  
  return { keyTypes, isRestricted };
}



/**
 * Calculate total transaction size from protobuf object + signatures + hashes
 */
function calculateTotalTransactionSize(protoObject: TransactionMessage): number {
  // Auto-detect transaction type from protobuf object
  const detectedTransactionType = extractTransactionTypeFromProtoObject(protoObject);
  
  // Check if transaction type is valid (0 is a valid transaction type, so check for null/undefined)
  if (detectedTransactionType === null || detectedTransactionType === undefined) {
    throw new Error('detectedTransactionType is null or undefined');
  }
  
  // Get the serialized size of the protobuf object using v2 schema-based toBinary
  const typeName = (protoObject as { $typeName?: string }).$typeName;
  if (!typeName) {
    throw new Error('Cannot serialize transaction: missing $typeName property');
  }
  const schema = getSchemaForTypeName(typeName);
  if (!schema) {
    throw new Error(`Cannot serialize transaction: no schema found for type "${typeName}"`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const binary = toBinary(schema as any, protoObject as any);
  const protoSize = binary.length;
  
  // Auto-detect key types from transaction
  const { keyTypes } = extractKeyTypesFromTransaction(protoObject);
  
  // Calculate signature sizes
  let signatureSize = 0;
  for (const keyType of keyTypes) {
    const rawSignatureSize = getSignatureSize(keyType);

    if (detectedTransactionType === TRANSACTION_TYPE.COIN_TYPE) {
      signatureSize += rawSignatureSize + PROTOBUF_AUTH_SIGNATURE_OVERHEAD;
    } else {
      signatureSize += rawSignatureSize + PROTOBUF_BASE_SIGNATURE_OVERHEAD;
    }
  }
  
  // Accomodate single ED448 key signature overhead (inferred cause of calculation issue based on integration testing)
  if (keyTypes.length === 1 && keyTypes[0] === KEY_TYPE.ED448) {
    signatureSize += 1;
  }
    
  // Calculate hash size with protobuf overhead
  const totalHashSize = HASH_SIZE + PROTOBUF_HASH_OVERHEAD;
  
  return protoSize + signatureSize + totalHashSize;
}

/**
 * Calculate contract fee using the service
 */
function calculateContractFee(
  protoObject: TransactionMessage,
  contractFeeId: string | undefined,
  contractFee: AmountInput | undefined,
  contractFeeParts: string | undefined,
  tokenInfoMap?: Map<string, TokenInfo>,
  overestimatePercent: number = 5.0
): void {
  try {
    // Extract contract ID and outputs directly from the protobuf object
    const contractId = isCoinTXN(protoObject) ? protoObject.contractId : 'invalid';

    if (contractId === 'invalid') {
      throw new Error('contractId not found');
    }

    // Handle manual contract fee in smallest units/parts - skip all calculation and conversion
    if (contractFeeParts !== undefined && contractFeeId) {
      logger.warn('Manual contract fee parts specified - skipping fee calculation and conversion. Fee is not validated and may be insufficient, causing transaction failure.', {
        contractFeeId,
        providedFeeParts: contractFeeParts,
        operation: 'manualContractFeeParts'
      });

      const coinTxnProto = protoObject as CoinTXN;
      coinTxnProto.contractFeeId = contractFeeId;
      coinTxnProto.contractFeeAmount = contractFeeParts;
      return;
    }

    // Handle manual contract fee - skip all calculation, validation, and overestimation
    if (contractFee !== undefined && contractFeeId) {
      const contractFeeInSmallestUnits = toSmallestUnits(contractFee, contractFeeId, tokenInfoMap ? { tokenInfoMap } : {});

      logger.warn('Manual contract fee specified - skipping fee calculation and validation. Fee is not validated and may be insufficient, causing transaction failure.', {
        contractFeeId,
        providedFee: contractFeeInSmallestUnits,
        operation: 'manualContractFee'
      });

      // Set the contract fee directly (no overestimation for manual fees)
      const coinTxnProto = protoObject as CoinTXN;
      coinTxnProto.contractFeeId = contractFeeId;
      coinTxnProto.contractFeeAmount = contractFeeInSmallestUnits;
      return;
    }

    const outputTransfers = isCoinTXN(protoObject) ? (protoObject.outputTransfers || []) : [];

    const contractFeeInfo = tokenInfoMap?.get(contractId)?.contractFees;

    let transactionAmount = '0';
    if (contractFeeInfo && Object.keys(contractFeeInfo).length > 0) {

      // Check if contract allows any fee instruments at all
      if (!contractFeeInfo.allowedFeeInstrument || contractFeeInfo.allowedFeeInstrument.length === 0) {
        // Contract doesn't allow fee instruments, skip contract fee
        return;
      }

      // Default contractFeeId to contractId if undefined
      contractFeeId = contractFeeId || contractId;

      // Check to see is contractFeeId is a valid for this contractID
      if (contractFeeInfo.allowedFeeInstrument && !contractFeeInfo.allowedFeeInstrument.includes(contractFeeId)) {
        logger.warn('Contract fee ID not allowed for contract', {
          contractId,
          contractFeeId,
          allowedFeeInstrument: contractFeeInfo.allowedFeeInstrument,
          operation: 'validateContractFeeId'
        });
      }
      
      // Get the current token rate for converting transaction amount to USD
      const currentTokenInfo = tokenInfoMap?.get(contractId);
      if (!currentTokenInfo?.rate) {
        throw new Error(`Exchange rate not available for contract ${contractId}`);
      }
      
      // Calculate total transaction amount
      const outputAmounts = outputTransfers.map((o: { amount: string | number }) => toDecimal(o.amount));
      const totalTransactionAmountInSmallestUnits = outputAmounts.reduce((sum: Decimal, amount: Decimal) => {
        return sum.add(amount);
      }, new Decimal(0));
      let denominationDecimals: number;
      if (currentTokenInfo.denomination) {
        denominationDecimals = getDecimalPlacesFromDenomination(currentTokenInfo.denomination);
      } else {
        const fallbackDenomination = getDenominationFallback(contractId);
        denominationDecimals = getDecimalPlacesFromDenomination(fallbackDenomination);
      }
      
      // Convert smallest units to USD value
      // Formula: ((smallest_units / 10^denomination_decimals) * rate) / 1e18 = USD value
      const transactionAmountInTokenUnits = toDecimal(totalTransactionAmountInSmallestUnits).div(new Decimal(10).pow(denominationDecimals));
      const rateDecimal = toDecimal(currentTokenInfo.rate);
      const usdValueScaled = transactionAmountInTokenUnits.mul(rateDecimal);
      
      // Helper function to get fee token info and decimals
      const getFeeTokenInfo = (feeContractId: string) => {
        const feeTokenInfo = tokenInfoMap?.get(feeContractId);
        if (!feeTokenInfo?.rate) {
          throw new Error(`Exchange rate not available for fee contract ${feeContractId}`);
        }
        
        let feeTokenDecimals: number;
        if (feeTokenInfo.denomination) {
          feeTokenDecimals = getDecimalPlacesFromDenomination(feeTokenInfo.denomination);
        } else {
          const feeTokenFallbackDenomination = getDenominationFallback(feeContractId);
          feeTokenDecimals = getDecimalPlacesFromDenomination(feeTokenFallbackDenomination);
        }
        
        return { feeTokenInfo, feeTokenDecimals };
      };

      // Helper function to convert USD amount to fee token smallest units
      const convertUsdToFeeTokenSmallestUnits = (usdAmount: Decimal, feeContractId: string): string => {
        const { feeTokenInfo, feeTokenDecimals } = getFeeTokenInfo(feeContractId);
        const feeTokenRateDecimal = toDecimal(feeTokenInfo.rate);
        const feeTokenUnitsDecimal = usdAmount.div(feeTokenRateDecimal);
        const feeTokenAmountDecimal = feeTokenUnitsDecimal.mul(new Decimal(10).pow(feeTokenDecimals));
        return feeTokenAmountDecimal.floor().toString();
      };

      // Calculate transaction amount based on fee type
      if (contractFeeInfo.contractFeeType === CONTRACT_FEE_TYPE.FIXED) {
        // Fixed fee - feeAmountDecimal is the number of token units, not USD value
        transactionAmount = contractFeeInfo.fee;
        
        // If fee is not in the contractId token, need conversions
        if (contractFeeId !== contractId) {
          const feeAmountDecimal = toDecimal(contractFeeInfo.fee);
          const feeAmountInUsd = feeAmountDecimal.mul(new Decimal(10).pow(-denominationDecimals)).mul(rateDecimal);
          transactionAmount = convertUsdToFeeTokenSmallestUnits(feeAmountInUsd, contractFeeId);
        }
        
      } else if (contractFeeInfo.contractFeeType === CONTRACT_FEE_TYPE.CUR_EQUIVALENT) { 
        // Currency equivalent fee - convert USD amount to fee contract ID
        const feeAmountDecimal = toDecimal(contractFeeInfo.fee);
        
        transactionAmount = convertUsdToFeeTokenSmallestUnits(feeAmountDecimal, contractFeeId);        
      } else if (contractFeeInfo.contractFeeType === CONTRACT_FEE_TYPE.PERCENTAGE){
        // Percentage fee - contractFeeInfo.fee is in smallest units where 1e18 = 100%
        const feePercentageDecimal = toDecimal(contractFeeInfo.fee);
        
        if (contractFeeId !== contractId) {
          // Convert smallest units to percentage (1e18 = 100%), then calculate USD equivalent
          const percentageValue = feePercentageDecimal.div(new Decimal(10).pow(18)).mul(100);
          const percentageOfTransactionUSD = usdValueScaled.mul(percentageValue).div(100);
          transactionAmount = convertUsdToFeeTokenSmallestUnits(percentageOfTransactionUSD, contractFeeId);
        } else {
          // Same currency - convert smallest units to percentage, then calculate directly
          const percentageValue = feePercentageDecimal.div(new Decimal(10).pow(18)).mul(100);
          const percentageOfTransaction = totalTransactionAmountInSmallestUnits.mul(percentageValue).div(100);
          transactionAmount = percentageOfTransaction.floor().toString();
        }

      } else if (contractFeeInfo.contractFeeType === CONTRACT_FEE_TYPE.NONE) {
        return;
      } else {
        logger.warn('Unsupported contract fee type', {
          contractFeeType: contractFeeInfo.contractFeeType,
          operation: 'calculateContractFee'
        });
        return;
      }
                  
    } else {
      return;
    }

    // Apply overestimation to fee
    if (overestimatePercent > 0) {
      const overestimateMultiplier = new Decimal(100 + overestimatePercent).div(100);
      const overestimatedFeeDecimal = toDecimal(transactionAmount).mul(overestimateMultiplier);
      transactionAmount = overestimatedFeeDecimal.floor().toString();
    }

    // Add contract fee fields to protoObject for TRANSACTION_TYPE.COIN_TYPE
    if (contractFeeId && transactionAmount) {
      const coinTxnProto = protoObject as CoinTXN;
      coinTxnProto.contractFeeId = contractFeeId;
      coinTxnProto.contractFeeAmount = transactionAmount;
    }
    
  } catch (error) {
    throw new Error(`Contract fee calculation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Calculate interface fee
 */
function calculateInterfaceFee(
  protoObject: TransactionMessage,
  interfaceFeeAmount?: AmountInput,
  interfaceFeeId?: string,
  interfaceAddress?: string,
  tokenInfoMap?: Map<string, TokenInfo>
): void {
  if (!interfaceFeeAmount || !interfaceFeeId) {
    return;
  }

  if (!interfaceAddress){
    logger.warn('Interface address required for interface fee', {
      operation: 'calculateInterfaceFee'
    });
    return;
  }

  // Convert interface fee to smallest units
  const feeInSmallestUnits = toSmallestUnits(interfaceFeeAmount, interfaceFeeId, tokenInfoMap ? { tokenInfoMap } : {});

  // Add interface fee fields to base object (works for all transaction types)
  const txnProto = protoObject as { base?: { interfaceFee?: string; interfaceFeeId?: string; interfaceAddress?: Uint8Array } };
  if (txnProto.base) {
    txnProto.base.interfaceFee = feeInSmallestUnits;
    txnProto.base.interfaceFeeId = interfaceFeeId;
    if (interfaceAddress) {
      txnProto.base.interfaceAddress = sanitizeAndDecodeAddress(interfaceAddress);
    }
  }
}

/**
 * Calculate gas fee in smallest units from USD
 */
function calculateGasFee(
  gasFeeInUsd: number,
  baseFeeId: string,
  tokenInfoMap?: Map<string, TokenInfo>
): string {
  const tokenInfo = tokenInfoMap?.get(baseFeeId);
  if (!tokenInfo) {
    throw new Error(`Token info not found for fee ID ${baseFeeId} when calculating gas fee`);
  }

  // Non-native fee instruments (anything other than KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao) incur a 10x cost multiplier
  const NON_NATIVE_FEE_MULTIPLIER = 10;
  const feeMultiplier = baseFeeId !== KALVORA_NATIVE_TOKEN ? NON_NATIVE_FEE_MULTIPLIER : 1;

  // Gas fee is provided in USD (e.g., 0.50 for 50 cents)
  // Scale to 1e18 for precision: convert USD to scaled cents (multiply by 100 to get cents, then by 1e18)
  const gasFeeInUsdScaled = new Decimal(gasFeeInUsd).mul(1e18).mul(feeMultiplier);
  
  // Convert USD cents to fee token units using exchange rate
  // Exchange rate is stored as: 1 fee token = X USD cents
  const exchangeRate = tokenInfo.rate ? toDecimal(tokenInfo.rate) : new Decimal(1);
  
  // Gas fee in fee token units = gasFeeInCents / exchangeRate
  const gasFeeInTokenUnits = gasFeeInUsdScaled.div(exchangeRate);
  
  // Get decimals for precision handling
  let decimals: number;
  if (tokenInfo.denomination) {
    decimals = getDecimalPlacesFromDenomination(tokenInfo.denomination);
  } else {
    throw new Error(`Token info missing denomination for ${baseFeeId}`);
  }
  
  // Round to proper precision
  const precisionMultiplier = new Decimal(10).pow(decimals);
  const roundedGasFee = gasFeeInTokenUnits.mul(precisionMultiplier).floor().div(precisionMultiplier);
  
  // Ensure minimum if rounding results in zero but original was > 0
  const finalGasFee = roundedGasFee.equals(0) && gasFeeInTokenUnits.greaterThan(0)
    ? new Decimal(10).pow(-decimals)
    : roundedGasFee;
  
  // Convert to smallest units
  return toSmallestUnits(finalGasFee.toString(), baseFeeId, tokenInfoMap ? { tokenInfoMap } : {});
}

/**
 * Extract the first PublicKey protobuf object from a transaction.
 * Used to pass the public key to the BaseFee API for accurate fee calculation.
 */
function extractPublicKeyFromTransaction(protoObject: TransactionMessage): PublicKey | undefined {
  try {
    // CoinTXN: public keys are in auth.publicKey[]
    if (hasAuthProperty(protoObject) && 
        typeof protoObject.auth === 'object' && 
        protoObject.auth !== null &&
        'publicKey' in protoObject.auth && 
        Array.isArray((protoObject.auth as Record<string, unknown>).publicKey)) {
      const authObj = protoObject.auth as Record<string, unknown>;
      const publicKeys = authObj.publicKey as unknown[];
      if (publicKeys.length > 0) {
        return publicKeys[0] as PublicKey;
      }
    }
    // Other transaction types: public key is in base.publicKey
    else if (hasBaseProperty(protoObject) && 
             typeof protoObject.base === 'object' && 
             protoObject.base !== null &&
             'publicKey' in protoObject.base) {
      const baseObj = protoObject.base as unknown as Record<string, unknown>;
      return baseObj.publicKey as PublicKey | undefined;
    }
  } catch {
    // If extraction fails, return undefined (will use fallback constants)
  }
  return undefined;
}

/**
 * Calculate network fee based on proto object.
 * 
 * Tries the BaseFee gRPC API first to get network-sourced key_fee and byte_fee.
 * Falls back to hardcoded constants if the API call fails.
 * 
 * Returns the newWalletFee from the BaseFee API response (in 1e18 = $1.00 format)
 * for use in new token balance fee calculation.
 * 
 *! Note: This function may not be 100% accurate. Nominal testing indicates accuracy within >= 99.999999% (usually exact or 1 denomination unit greater). Minimal accuracy difference design choice for better code understandability rather than working strictly with scaled numbers.
 *! Note: Suggest 'maximum' overestimation to account for edge cases such as changes in ACE rates after transaction calculation.
 */
async function calculateNetworkFee(
  protoObject: TransactionMessage,
  transactionType: number,
  baseFeeId: string = KALVORA_NATIVE_TOKEN,
  baseFee: AmountInput | undefined,
  baseFeeParts: string | undefined,
  tokenInfoMap?: Map<string, TokenInfo>,
  overestimatePercent: number = 5.0,
  gasFeeInUsd?: number,
  grpcConfig?: GRPCConfig,
  onBaseFeeCalculated?: (details: BaseFeeCalculationDetails) => void
): Promise<string> {
  // Handle manual base fee in smallest units/parts - skip all calculation and conversion
  if (baseFeeParts !== undefined) {
    logger.warn('Manual base fee parts specified - skipping fee calculation and conversion. Fee is not validated and may be insufficient, causing transaction failure.', {
      baseFeeId,
      providedFeeParts: baseFeeParts,
      operation: 'manualBaseFeeParts'
    });

    let finalFee = baseFeeParts;

    // Add gas fee if provided (only applicable for SmartContractExecuteTXN)
    if (gasFeeInUsd !== undefined && gasFeeInUsd > 0) {
      const gasFeeInSmallestUnits = calculateGasFee(gasFeeInUsd, baseFeeId, tokenInfoMap);
      const baseFeeDecimal = toDecimal(finalFee);
      const gasFeeDecimal = toDecimal(gasFeeInSmallestUnits);
      finalFee = baseFeeDecimal.add(gasFeeDecimal).floor().toString();
    }

    const txnProto = protoObject as { base?: { feeAmount?: string; feeId?: string } };
    if (txnProto.base) {
      txnProto.base.feeAmount = finalFee;
      txnProto.base.feeId = baseFeeId;
    }
    return '0';
  }

  // Handle manual base fee - skip all calculation, validation, and overestimation
  if (baseFee !== undefined) {
    const baseFeeInSmallestUnits = toSmallestUnits(baseFee, baseFeeId, tokenInfoMap ? { tokenInfoMap } : {});

    logger.warn('Manual base fee specified - skipping fee calculation and validation. Fee is not validated and may be insufficient, causing transaction failure.', {
      baseFeeId,
      providedFee: baseFeeInSmallestUnits,
      operation: 'manualBaseFee'
    });

    // Use the manual fee directly (no overestimation for manual fees)
    let finalFee = baseFeeInSmallestUnits;

    // Add gas fee if provided (only applicable for SmartContractExecuteTXN)
    if (gasFeeInUsd !== undefined && gasFeeInUsd > 0) {
      const gasFeeInSmallestUnits = calculateGasFee(gasFeeInUsd, baseFeeId, tokenInfoMap);
      const baseFeeDecimal = toDecimal(finalFee);
      const gasFeeDecimal = toDecimal(gasFeeInSmallestUnits);
      finalFee = baseFeeDecimal.add(gasFeeDecimal).floor().toString();
    }

    // Set the base fee directly
    const txnProto = protoObject as { base?: { feeAmount?: string; feeId?: string } };
    if (txnProto.base) {
      txnProto.base.feeAmount = finalFee;
      txnProto.base.feeId = baseFeeId;
    }
    return '0';
  }

  // Calculate initial transaction size (with placeholder fee amount)
  let transactionSize = calculateTotalTransactionSize(protoObject);
  
  // Get fees from the BaseFee API (network-sourced, always up to date)
  const publicKey = extractPublicKeyFromTransaction(protoObject);
  const baseFeeResponse = await getBaseFee(
    transactionType as TRANSACTION_TYPE,
    publicKey ?? undefined,
    grpcConfig
  );

  // Capture the new wallet fee from the API response (1e18 = $1.00 format)
  const newWalletFeeScaled = baseFeeResponse.newWalletFee || '0';
  
  // Non-native fee instruments (anything other than KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao) incur a 10x cost multiplier
  const NON_NATIVE_FEE_MULTIPLIER = 10;
  const feeMultiplier = baseFeeId !== KALVORA_NATIVE_TOKEN ? NON_NATIVE_FEE_MULTIPLIER : 1;

  // API returns fees in 1e18 = $1.00 format, convert to USD
  // byte_fee is per-byte, key_fee is the total key+hash fee for this signer
  const perByteFee = new Decimal(baseFeeResponse.byteFee || '0').div(new Decimal(10).pow(18));
  const totalKeyAndHashFees = new Decimal(baseFeeResponse.keyFee || '0').div(new Decimal(10).pow(18)).mul(feeMultiplier);

  // Calculate initial base network fee: transaction size * per-byte fee (with non-native multiplier)
  const baseNetworkFeeEquiv = toDecimal(transactionSize).mul(perByteFee).mul(feeMultiplier);
  
  // Calculate initial total network fee: base fee + key fees + hash fees
  const totalNetworkFeeScaled = baseNetworkFeeEquiv.add(totalKeyAndHashFees).mul(1e18);
  
  // Get exchange rate for base fee
  const tokenInfo = tokenInfoMap?.get(baseFeeId);
  const exchangeRate = tokenInfo?.rate ? toDecimal(tokenInfo.rate) : new Decimal(1);

  // Use precise division with proper rounding for base fees
  const totalNetworkFee = totalNetworkFeeScaled.div(exchangeRate);
  
  // Get token fee info to determine precision from denomination
  let decimals: number;
  if (tokenInfoMap && tokenInfoMap.has(baseFeeId)) {
    // Use cached token info for faster access and consistency
    const tokenInfo = tokenInfoMap.get(baseFeeId);
    if (tokenInfo?.denomination) {
      decimals = getDecimalPlacesFromDenomination(tokenInfo.denomination);
    } else {
      throw new Error(`Unexpected error: Token info found but missing denomination for ${baseFeeId}`);
    }
  } else {
    throw new Error(`Token info not found for base fee ID ${baseFeeId}`);
  }
  
  // Round to the precision specified by the denomination
  const precisionMultiplier = new Decimal(10).pow(decimals);
  let roundedFee = totalNetworkFee.mul(precisionMultiplier).floor().div(precisionMultiplier);
  
  // Ensure minimum fee if rounding results in zero but original fee was > 0
  if (roundedFee.equals(0) && totalNetworkFee.greaterThan(0)) {
    roundedFee = new Decimal(10).pow(-decimals); // Set to minimum unit (1 satoshi)
  }
  
  // Convert to smallest units with precise denomination-based precision
  const conversionOptions: { isBaseFee: boolean; tokenInfoMap?: Map<string, TokenInfo> } = { isBaseFee: true };
  if (tokenInfoMap) {
    conversionOptions.tokenInfoMap = tokenInfoMap;
  }
  
  let transactionAmount = toSmallestUnits(roundedFee.toString(), baseFeeId, conversionOptions);
  
  // Calculate the difference in size between placeholder '1' and actual fee
  const placeholderFeeSize = 1; // Size of '1' in bytes
  const actualFeeSize = transactionAmount.length; // Size of actual fee string in bytes
  const feeSizeDifference = actualFeeSize - placeholderFeeSize;
  
  // If there's a size difference, recalculate the fee with the corrected transaction size
  if (feeSizeDifference > 0) {
    // Add the size difference to transaction size
    const correctedTransactionSize = transactionSize + feeSizeDifference;
    
    // Recalculate base network fee with corrected size (with non-native multiplier)
    const correctedBaseNetworkFeeEquiv = toDecimal(correctedTransactionSize).mul(perByteFee).mul(feeMultiplier);
    
    // Recalculate total network fee
    const correctedTotalNetworkFeeEquiv = correctedBaseNetworkFeeEquiv.add(totalKeyAndHashFees).mul(1e18);
    // Use precise division with proper rounding for base fees
    const correctedTotalNetworkFee = correctedTotalNetworkFeeEquiv.div(exchangeRate);
    
    // Round to the precision specified by the denomination
    const precisionMultiplier = new Decimal(10).pow(decimals);
    const correctedRoundedFee = correctedTotalNetworkFee.mul(precisionMultiplier).floor().div(precisionMultiplier);
    
    // Update the fee in smallest units with precise denomination-based precision
    transactionAmount = toSmallestUnits(correctedRoundedFee.toString(), baseFeeId, conversionOptions);
    
    // Update transaction size for return value
    transactionSize = correctedTransactionSize;
  }

  // Apply overestimation to fee
  if (overestimatePercent > 0) {
    const overestimateMultiplier = new Decimal(100 + overestimatePercent).div(100);
    const overestimatedFeeDecimal = toDecimal(transactionAmount).mul(overestimateMultiplier);
    transactionAmount = overestimatedFeeDecimal.floor().toString();
  }
  
  // Add gas fee if provided (only applicable for SmartContractExecuteTXN)
  if (gasFeeInUsd !== undefined && gasFeeInUsd > 0) {
    const gasFeeInSmallestUnits = calculateGasFee(gasFeeInUsd, baseFeeId, tokenInfoMap);
    const baseFeeDecimal = toDecimal(transactionAmount);
    const gasFeeDecimal = toDecimal(gasFeeInSmallestUnits);
    const totalFeeDecimal = baseFeeDecimal.add(gasFeeDecimal);
    transactionAmount = totalFeeDecimal.floor().toString();
  }
  
  // Add base fee fields to base object (works for all transaction types)
  const txnProto = protoObject as { base?: { feeAmount?: string; feeId?: string } };
  if (txnProto.base) {
    txnProto.base.feeAmount = transactionAmount;
    txnProto.base.feeId = baseFeeId;
  }

  onBaseFeeCalculated?.({
    transactionType,
    baseFeeId,
    ...(publicKey ? { publicKey } : {}),
    baseFeeResponse,
    feeMultiplier,
    transactionSize,
    feeAmountParts: transactionAmount,
    newWalletFeeScaled
  });

  return newWalletFeeScaled;
}

/**
 * Calculate additional network fee for addresses that don't hold the transferred token.
 * 
 * For CoinTXN (token transfers), the network charges an additional fee when a recipient
 * address doesn't currently have that token. This function checks all destination
 * addresses, adding the network-sourced new wallet fee per recipient without a balance.
 * 
 * @note The sender is NOT checked — only output (recipient) addresses are relevant.
 * 
 * @param protoObject - The CoinTXN protobuf object (must have outputTransfers)
 * @param baseFeeId - The base fee instrument ID (e.g., 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao')
 * @param contractId - The contract ID of the token being transferred
 * @param tokenInfoMap - Map of token info including exchange rates
 * @param newWalletFeeScaled - The new wallet fee from BaseFee API in 1e18 = $1.00 format
 * @param grpcConfig - gRPC configuration for balance lookups
 * @param needsInitialization - Optional override: true = always add fee, false = never add fee, undefined = auto-detect
 */
async function calculateNewTokenBalanceFee(
  protoObject: TransactionMessage,
  baseFeeId: string,
  contractId: string,
  tokenInfoMap: Map<string, TokenInfo>,
  newWalletFeeScaled: string,
  grpcConfig?: GRPCConfig,
  needsInitialization?: boolean
): Promise<void> {
  if (!isCoinTXN(protoObject)) return;

  const coinTxn = protoObject as CoinTXN;
  const addressesToCheck: string[] = [];

  // 1. Extract destination addresses from outputTransfers (stored as base58-decoded Uint8Array)
  if (coinTxn.outputTransfers && coinTxn.outputTransfers.length > 0) {
    for (const output of coinTxn.outputTransfers) {
      if (output.walletAddress && output.walletAddress.length > 0) {
        try {
          const addressString = bs58.encode(output.walletAddress);
          if (addressString && !addressesToCheck.includes(addressString)) {
            addressesToCheck.push(addressString);
          }
        } catch {
          // Skip addresses that can't be decoded — shouldn't happen with valid transactions
        }
      }
    }
  }

  if (addressesToCheck.length === 0) return;

  // 3. Determine how many addresses don't hold the token
  let addressesWithoutBalance = 0;

  if (needsInitialization === true) {
    // Override: user says all addresses need initialization — skip API calls entirely
    addressesWithoutBalance = addressesToCheck.length;
    logger.info('needsInitialization=true override: treating all addresses as needing initialization', {
      addressCount: addressesToCheck.length,
      operation: 'calculateNewTokenBalanceFee'
    });
  } else if (needsInitialization === false) {
    // Override: user says no addresses need initialization — skip API calls entirely
    logger.info('needsInitialization=false override: skipping new token balance fee', {
      operation: 'calculateNewTokenBalanceFee'
    });
    return;
  } else {
    // Default: check balance for each address via API
    for (const address of addressesToCheck) {
      try {
        const balanceResponse = await getBalance(address, contractId, grpcConfig || {});
        // The validator returns balance: '0' when the wallet doesn't have that token
        if (balanceResponse.balance === '0') {
          addressesWithoutBalance++;
        }
      } catch {
        // If we can't check balance, assume the address doesn't have it (safer to overestimate)
        addressesWithoutBalance++;
        logger.warn('Failed to check balance for new token fee estimation, assuming address does not hold token', {
          address,
          contractId,
          operation: 'calculateNewTokenBalanceFee'
        });
      }
    }
  }

  if (addressesWithoutBalance === 0) return;

  // 4. Calculate new wallet fee per address in the base fee token's smallest units
  // newWalletFeeScaled is in 1e18 = $1.00 format from the BaseFee API
  // Non-native fee instruments (anything other than KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao) incur a 10x cost multiplier
  const NON_NATIVE_FEE_MULTIPLIER = 10;
  const feeMultiplier = baseFeeId !== KALVORA_NATIVE_TOKEN ? NON_NATIVE_FEE_MULTIPLIER : 1;
  const feePerAddressScaled = new Decimal(newWalletFeeScaled);
  const totalFeeScaled = feePerAddressScaled.mul(addressesWithoutBalance).mul(feeMultiplier);

  // Convert USD to base fee token smallest units using exchange rate
  const tokenInfo = tokenInfoMap.get(baseFeeId);
  if (!tokenInfo?.rate) {
    logger.warn('Cannot calculate new token balance fee: missing exchange rate for base fee token', {
      baseFeeId,
      operation: 'calculateNewTokenBalanceFee'
    });
    return;
  }

  const exchangeRate = toDecimal(tokenInfo.rate);
  // totalFeeScaled is already in 1e18 precision (from the BaseFee API)
  const feeInTokenUnits = totalFeeScaled.div(exchangeRate);

  // Get denomination decimals
  let decimals: number;
  if (tokenInfo.denomination) {
    decimals = getDecimalPlacesFromDenomination(tokenInfo.denomination);
  } else {
    throw new Error(`Token info missing denomination for ${baseFeeId}`);
  }

  // Convert to smallest units
  const precisionMultiplier = new Decimal(10).pow(decimals);
  const feeInSmallestUnits = feeInTokenUnits.mul(precisionMultiplier).floor();

  // 5. Add the fee to the existing base fee
  const txnProto = protoObject as { base?: { feeAmount?: string; feeId?: string } };
  if (txnProto.base?.feeAmount) {
    const currentFee = toDecimal(txnProto.base.feeAmount);
    const newFee = currentFee.add(feeInSmallestUnits);
    txnProto.base.feeAmount = newFee.floor().toString();

    logger.info('Added new token balance fee to base fee', {
      addressesChecked: addressesToCheck.length,
      addressesWithoutBalance,
      feePerAddressScaled: feePerAddressScaled.toString(),
      totalAdditionalFeeSmallestUnits: feeInSmallestUnits.toString(),
      newTotalBaseFee: txnProto.base.feeAmount,
      operation: 'calculateNewTokenBalanceFee'
    });
  }
}

/**
 * Universal Fee Calculator class
 */
export class UniversalFeeCalculator {
  /**
   * Unified fee calculation method
   * Calculates network fees, contract fees, and interface fees
   * Returns the modified proto object with all fee fields populated
   * @param options - Fee calculation parameters
   * @returns Modified proto object with fee fields
   */
  static async calculateFee<T extends TransactionMessage>(
    options: FeeConfigHelper<T>
  ): Promise<T> {
    // Ensure base fee id default and normalize casing
    const effectiveBaseFeeId = normalizeContractId(options.baseFeeId || KALVORA_NATIVE_TOKEN);

    // Ensure tokenInfoMap includes base fee token info
    const workingTokenInfoMap: Map<string, TokenInfo> = options.tokenInfoMap || new Map<string, TokenInfo>();
    if (!workingTokenInfoMap.has(effectiveBaseFeeId)) {
      try {
        const response = await getTokenFeeInfo({
          contractIds: [effectiveBaseFeeId],
          includeRates: true,
          includeContractFees: true
        }, options.grpcConfig);
        for (const token of response.tokens) {
          workingTokenInfoMap.set(token.contractId, token);
          // Also store under normalized form if API-returned case differs
          const normalized = normalizeContractId(token.contractId);
          if (normalized !== token.contractId) {
            workingTokenInfoMap.set(normalized, token);
          }
        }
      } catch {
        // If we cannot fetch, proceed; downstream will error with a precise message if needed
      }
    }

    // Check if this is a CoinTXN transaction and contractFeeId is provided
    const transactionType = extractTransactionTypeFromProtoObject(options.protoObject);

    // STEP 1: Calculate contract fee FIRST (if applicable)
    // Extract contractId from protoObject for CoinTXN (contractId in options is only for convenience)
    const contractIdForFeeCheck = transactionType === TRANSACTION_TYPE.COIN_TYPE && isCoinTXN(options.protoObject)
      ? options.protoObject.contractId
      : options.contractId;
    
    if (transactionType === TRANSACTION_TYPE.COIN_TYPE && contractIdForFeeCheck && options.tokenInfoMap?.get(contractIdForFeeCheck)?.contractFees) {
      try {
        calculateContractFee(
          options.protoObject,
          options.contractFeeId,
          options.contractFee,
          options.contractFeeParts,
          options.tokenInfoMap,
          options.overestimatePercent
        );

      } catch (error) {
        throw new Error(`Contract fee calculation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // STEP 2: Calculate interface fee (if specified)
    if (options.interfaceFeeId && options.interfaceFee) {
      try {
        calculateInterfaceFee(
          options.protoObject,
          options.interfaceFee,
          options.interfaceFeeId,
          options.interfaceAddress,
          options.tokenInfoMap
        );
      } catch (error) {
        throw new Error(`Interface fee calculation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // STEP 3: Calculate network fee based on the proto object (uses BaseFee API)
    // Returns the newWalletFee from the API response for use in Step 4
    const newWalletFeeScaled = await calculateNetworkFee(
      options.protoObject,
      transactionType,
      effectiveBaseFeeId,
      options.baseFee,
      options.baseFeeParts,
      workingTokenInfoMap,
      options.overestimatePercent,
      options.gasFeeInUsd,
      options.grpcConfig,
      options.onBaseFeeCalculated
    );

    // STEP 4: Add new token balance fee for CoinTXN (only for auto-calculated base fees)
    // Checks if any destination address doesn't hold the transferred token,
    // and adds the network-sourced new_wallet_fee per such address to the base network fee.
    if (transactionType === TRANSACTION_TYPE.COIN_TYPE && options.baseFee === undefined && options.baseFeeParts === undefined) {
      const coinContractId = isCoinTXN(options.protoObject) ? options.protoObject.contractId : undefined;
      if (coinContractId) {
        try {
          await calculateNewTokenBalanceFee(
            options.protoObject,
            effectiveBaseFeeId,
            coinContractId,
            workingTokenInfoMap,
            newWalletFeeScaled,
            options.grpcConfig,
            options.needsInitialization
          );
        } catch (error) {
          // Non-fatal: if balance check fails, proceed without the additional fee.
          // The network will reject the transaction if fees are insufficient,
          // but we don't want to block transaction creation due to balance lookup failures.
          logger.warn('New token balance fee check failed, proceeding without additional fee', {
            error: error instanceof Error ? error.message : String(error),
            operation: 'calculateFee'
          });
        }
      }
    }

    return options.protoObject;
  }
  


  /**
   * Get exchange rate for a given contract ID
   */
  static async getExchangeRate(contractId: string): Promise<Decimal> {
    return ExchangeRateService.getExchangeRate(contractId);
  }

  /**
   * Get comprehensive fee information for contracts
   * 
   * @param contractIds - Array of contract IDs to get fee info for
   * @param options - Optional gRPC configuration
   * @returns Promise with fee information including rates and contract details
   */
  static async getTokenFeeInfo(
    contractIds: string[],
    options: GRPCConfig = {}
  ): Promise<{
    contractId: string;
    rate: Decimal;
    authorized: boolean;
    denomination: string;
    contractFees?: {
      fee: string;
      feeAddress?: Uint8Array;
      burn: string;
      validator: string;
    } | undefined;
  }[]> {
    const response = await getTokenFeeInfo({
      contractIds,
      includeRates: true,
      includeContractFees: true
    }, options);

    // Transform the response to match the expected return type
  
    return response.tokens.map((token: { contractId: string; rate: string; authorized: boolean; denomination: string; contractFees?: ContractFees }) => ({
      contractId: token.contractId,
      rate: toDecimal(token.rate),
      authorized: token.authorized,
      denomination: token.denomination,
      contractFees: token.contractFees ? {
        fee: token.contractFees.fee,
        ...(token.contractFees.feeAddress && { feeAddress: token.contractFees.feeAddress }),
        burn: token.contractFees.burn,
        validator: token.contractFees.validator
      } : undefined
    }));
  }
}
