/**
 * Universal Fee Calculator for Kalvora JS SDK
 * Handles network fees (base fees), contract-specific fees, and interface fees with automatic or manual specification
 */

import { toBinary } from '@bufbuild/protobuf';
import bs58 from 'bs58';

import { CONTRACT_FEE_TYPE, type WalletRegistration } from '../../../proto/generated/txn_pb.js';
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
import { getTokenFeeInfo } from '../../api/handler/token-info/service.js';
import { getBalance } from '../../api/validator/balance/service.js';
import { getBaseFee, type EnhancedBaseFeeResponse } from '../../api/validator/base-fee/service.js';
import { assertAuthenticationBudget } from '../../sign/resources.js';
import type { 
  AmountInput,
  GRPCConfig
} from '../../types/index.js';
import { sanitizeAndDecodeAddress } from '../crypto/address-utils.js';
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

import { getDenominationFallback, getDecimalPlacesFromDenomination } from './denomination-fallback.js';
import { ExchangeRateService } from './exchange-rate-service.js';
import { signedFeeTemplate, type ProofLayout } from './proof-layout.js';

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
  | RevokeTXN
  | ComplianceTXN
  | BurnSBTTXN
  | AllowanceTXN
  | ProposalCancelTXN
  | ValidatorRegistration
  | WalletRegistration
  | ValidatorHeartbeat
  | ProposalResult
  | RequiredVersion;

/**
 * Type guard to check if an object is a CoinTXN
 */
function isCoinTXN(obj: unknown): obj is CoinTXN {
  return !!(obj && typeof obj === 'object' && '$typeName' in obj && (obj as { $typeName: string }).$typeName === 'kal_txn.CoinTXN');
}

const ONE_DOLLAR = new Decimal(10).pow(18);

/**
 * USD rate used by fee math. A missing rate, or the node's missing-schedule
 * substitute `1`, is treated as 10^18 ($1.00). The native token is never
 * priced below $1.00.
 */
function resolveUsdRate(rate: string | undefined, contractId: string): Decimal {
  if (!rate) return ONE_DOLLAR;
  const parsed = toDecimal(rate);
  if (parsed.lte(1)) return ONE_DOLLAR;
  if (contractId === KALVORA_NATIVE_TOKEN && parsed.lt(ONE_DOLLAR)) return ONE_DOLLAR;
  return parsed;
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
  proofLayout?: ProofLayout;
  proposalStages?: { stageLengthCount: number; councilStepCount: number };
  /** Applicable SAFE_SEND component in units of 10^-18 USD for a network that charges it. */
  safeSendFeeScaled?: string;
  nonNativeMultiplier?: number;
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
    if (typeName === 'kal_txn.WalletRegistration') return TRANSACTION_TYPE.REGISTER_WALLET_TYPE;
    if (typeName === 'kal_txn.CoinTXN') return TRANSACTION_TYPE.COIN_TYPE;
    if (typeName === 'kal_txn.MintTXN') return TRANSACTION_TYPE.MINT_TYPE;
    if (typeName === 'kal_txn.ItemizedMintTXN') return TRANSACTION_TYPE.ITEM_MINT_TYPE;
    if (typeName === 'kal_txn.InstrumentContract') return TRANSACTION_TYPE.CONTRACT_TXN_TYPE;
    if (typeName === 'kal_txn.GovernanceVote') return TRANSACTION_TYPE.VOTE_TYPE;
    if (typeName === 'kal_txn.GovernanceProposal') return TRANSACTION_TYPE.PROPOSAL_TYPE;
    if (typeName === 'kal_txn.SmartContractTXN') return TRANSACTION_TYPE.SMART_CONTRACT_TYPE;
    if (typeName === 'kal_txn.SmartContractExecuteTXN') return TRANSACTION_TYPE.SMART_CONTRACT_EXECUTE_TYPE;
    if (typeName === 'kal_txn.ExpenseRatioTXN') return TRANSACTION_TYPE.EXPENSE_RATIO_TYPE;
    if (typeName === 'kal_txn.NFTTXN') return TRANSACTION_TYPE.NFT_TYPE;
    if (typeName === 'kal_txn.ContractUpdateTXN') return TRANSACTION_TYPE.UPDATE_CONTRACT_TYPE;
    if (typeName === 'kal_txn.ValidatorRegistration') return TRANSACTION_TYPE.VALIDATOR_REGISTRATION_TYPE;
    if (typeName === 'kal_txn.ValidatorHeartbeat') return TRANSACTION_TYPE.VALIDATOR_HEARTBEAT_TYPE;
    if (typeName === 'kal_txn.ProposalResult') return TRANSACTION_TYPE.PROPOSAL_RESULT_TYPE;
    if (typeName === 'kal_txn.DelegatedTXN') return TRANSACTION_TYPE.DELEGATED_VOTING_TYPE;
    if (typeName === 'kal_txn.RevokeTXN') return TRANSACTION_TYPE.REVOKE_TYPE;
    if (typeName === 'kal_txn.ComplianceTXN') return TRANSACTION_TYPE.COMPLIANCE_TYPE;
    if (typeName === 'kal_txn.BurnSBTTXN') return TRANSACTION_TYPE.SBT_BURN_TYPE;
    if (typeName === 'kal_txn.RequiredVersion') return TRANSACTION_TYPE.REQUIRED_VERSION;
    if (typeName === 'kal_txn.SmartContractInstantiateTXN') return TRANSACTION_TYPE.SMART_CONTRACT_INSTANTIATE_TYPE;
    if (typeName === 'kal_txn.AllowanceTXN') return TRANSACTION_TYPE.ALLOWANCE_TYPE;
    if (typeName === 'kal_txn.ProposalCancelTXN') return TRANSACTION_TYPE.PROPOSAL_CANCEL_TYPE;
    
    // If we can't determine the type, throw an error
    throw new Error('Unable to determine transaction type from protoObject structure');
  } catch (error) {
    throw new Error(`Failed to extract transaction type from protoObject: ${error instanceof Error ? error.message : String(error)}`);
  }
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
    contractFeeId ??= contractId;

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
      const sameTokenPercentage = contractFeeInfo.contractFeeType === CONTRACT_FEE_TYPE.PERCENTAGE && contractFeeId === contractId;
      if (!currentTokenInfo || (!currentTokenInfo.rate && !sameTokenPercentage)) {
        throw new Error(`Exchange rate not available for contract ${contractId}`);
      }
      
      let denominationDecimals: number;
      if (currentTokenInfo.denomination) {
        denominationDecimals = getDecimalPlacesFromDenomination(currentTokenInfo.denomination);
      } else {
        const fallbackDenomination = getDenominationFallback(contractId);
        denominationDecimals = getDecimalPlacesFromDenomination(fallbackDenomination);
      }
      
      const rateDecimal = toDecimal(currentTokenInfo.rate || '0');
      
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
        // Match contract_fee_math::percentage with widened integer arithmetic.
        // Convert the full fraction to payment-token parts before rounding.
        const maxUint256 = (1n << 256n) - 1n;
        const unsigned = (value: string, field: string): bigint => {
          if (!/^\d+$/u.test(value)) throw new Error(`${field} must be a decimal uint256`);
          const parsed = BigInt(value);
          if (parsed > maxUint256) throw new Error(`${field} must fit in uint256`);
          return parsed;
        };
        const positive = (value: string, field: string): bigint => {
          const parsed = unsigned(value, field);
          if (parsed === 0n) throw new Error(`${field} must be greater than zero`);
          return parsed;
        };
        const amount = outputTransfers.reduce((sum, output) => sum + unsigned(output.amount, 'output amount'), 0n);
        if (amount > maxUint256) throw new Error('Total transfer amount must fit in uint256');
        const fraction = unsigned(contractFeeInfo.fee, 'percentage fee');
        const scale = 1000000000000000000n;
        const sourceDenomination = positive(currentTokenInfo.denomination || getDenominationFallback(contractId), 'source denomination');
        let numerator = amount * fraction;
        let denominator = scale;
        if (contractFeeId !== contractId) {
          const paymentToken = tokenInfoMap?.get(contractFeeId);
          if (!paymentToken) throw new Error(`Token info not found for fee contract ${contractFeeId}`);
          const sourceRate = positive(currentTokenInfo.rate, 'source exchange rate');
          const paymentRate = positive(paymentToken.rate, 'payment exchange rate');
          const paymentDenomination = positive(paymentToken.denomination || getDenominationFallback(contractFeeId), 'payment denomination');
          numerator *= sourceRate * paymentDenomination;
          denominator *= sourceDenomination * paymentRate;
        }
        let fee = numerator / denominator;
        if (amount > 0n && fraction > 0n && fee === 0n) fee = 1n;
        if (fee > maxUint256) throw new Error('Percentage contract fee must fit in uint256');
        transactionAmount = fee.toString();

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
      const FeeDecimal = Decimal.clone({ precision: 100 });
      const overestimateMultiplier = new FeeDecimal(100).add(overestimatePercent).div(100);
      const overestimatedFeeDecimal = new FeeDecimal(transactionAmount).mul(overestimateMultiplier);
      transactionAmount = overestimatedFeeDecimal.toFixed(0, Decimal.ROUND_DOWN);
    }
    if (contractFeeInfo?.contractFeeType === CONTRACT_FEE_TYPE.PERCENTAGE && BigInt(transactionAmount) >= (1n << 256n)) {
      throw new Error('Percentage contract fee cap must fit in uint256');
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
  tokenInfoMap?: Map<string, TokenInfo>,
  multiplier?: number
): string {
  const tokenInfo = tokenInfoMap?.get(baseFeeId);
  if (!tokenInfo) {
    throw new Error(`Token info not found for fee ID ${baseFeeId} when calculating gas fee`);
  }

  // Non-native fee instruments (anything other than KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao) incur a 10x cost multiplier
  const NON_NATIVE_FEE_MULTIPLIER = 10;
  const feeMultiplier = baseFeeId === KALVORA_NATIVE_TOKEN ? 1 : (multiplier ?? NON_NATIVE_FEE_MULTIPLIER);
  if (!Number.isSafeInteger(feeMultiplier) || feeMultiplier < 1) throw new Error('Invalid non-native fee multiplier');

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
  onBaseFeeCalculated?: (details: BaseFeeCalculationDetails) => void,
  options: FeeConfigHelper = { protoObject, tokenInfoMap: new Map() }
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
      const gasFeeInSmallestUnits = calculateGasFee(gasFeeInUsd, baseFeeId, tokenInfoMap, options.nonNativeMultiplier);
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
      const gasFeeInSmallestUnits = calculateGasFee(gasFeeInUsd, baseFeeId, tokenInfoMap, options.nonNativeMultiplier);
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

  if (!protoObject.base) throw new Error('Cannot quote network fees without a base envelope');
  const { copy, schema } = await signedFeeTemplate(protoObject, options.proofLayout, grpcConfig);
  const base = copy.base;
  if (!base) throw new Error('A fee quote requires a base envelope');
  const quoteKeys = copy.$typeName === 'kal_txn.CoinTXN' ? (copy.auth?.publicKey ?? []) : (base.publicKey ? [base.publicKey] : []);
  const additional = base.feePayer?.publicKey ?? (copy.$typeName === 'kal_txn.ValidatorRegistration' ? copy.generatedPublicKey : undefined);
  const quotes = await Promise.all(quoteKeys.map(key => getBaseFee(transactionType, key, grpcConfig, additional)));
  const schedule = quotes[0];
  if (!schedule) throw new Error('A fee quote requires a signing wallet');
  const newWalletFeeScaled = schedule.newWalletFee || '0';
  const token = tokenInfoMap?.get(baseFeeId);
  if (!token?.denomination) throw new Error(`Token info missing denomination for ${baseFeeId}`);
  if (base.publicKey?.walletAddress && (!token.authorized || !/^\d+$/u.test(token.rate) || BigInt(token.rate) <= 0n)) {
    throw new Error('Fee token is not authorized or has no positive network rate');
  }
  const denomination = BigInt(token.denomination);
  const usdRate = base.publicKey?.walletAddress ? BigInt(token.rate) : BigInt(resolveUsdRate(token.rate, baseFeeId).toFixed(0));
  if (denomination <= 0n || usdRate <= 0n) throw new Error('Invalid fee token conversion');
  const divideUp = (amount: bigint, divisor: bigint) => (amount + divisor - 1n) / divisor;
  const component = (scaled: bigint) => {
    if (scaled < 0n || scaled * denomination >= 1n << 256n) throw new Error('Fee component is outside uint256');
    return divideUp(scaled * denomination, usdRate);
  };
  // Validator 200030 checks the recipient on Coin and mint paths but passes false to its generic fee calculator.
  const safeSend = base.safeSend && options.safeSendFeeScaled ? component(BigInt(options.safeSendFeeScaled)) : 0n;
  const keys = quotes.reduce((sum, q) => sum + component(BigInt(q.keyFee || '0')), 0n);
  const feeMultiplier = baseFeeId === KALVORA_NATIVE_TOKEN ? 1 : (options.nonNativeMultiplier ?? 10);
  if (!Number.isSafeInteger(feeMultiplier) || feeMultiplier < 1) throw new Error('Invalid non-native fee multiplier');
  const stages = options.proposalStages;
  if (stages && [stages.stageLengthCount, stages.councilStepCount].some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Invalid proposal stage count');
  const newRows = await newBalanceCount(protoObject, options.contractId ?? '', grpcConfig, options.needsInitialization);
  const newBalanceFee = component(BigInt(newWalletFeeScaled)) * BigInt(newRows);
  const gas = gasFeeInUsd ? BigInt(calculateGasFee(gasFeeInUsd, baseFeeId, tokenInfoMap, feeMultiplier)) : 0n;
  if (!Number.isFinite(overestimatePercent) || overestimatePercent < 0) throw new Error('Invalid fee overestimate');
  const FeeDecimal = Decimal.clone({ precision: 100 });
  const buffer = new FeeDecimal(100).add(overestimatePercent).div(100);
  base.feeId = baseFeeId;
  base.feeAmount = '1';
  let transactionSize: number;
  let transactionAmount: string;
  do {
    transactionSize = toBinary(schema, copy).length;
    let amount = component(BigInt(schedule.byteFee || '0') * BigInt(transactionSize)) + keys + safeSend;
    if (stages?.councilStepCount) {
      amount += divideUp(amount, BigInt(stages.stageLengthCount ? stages.stageLengthCount + 1 : 2)) * BigInt(stages.councilStepCount);
    }
    amount = (amount + newBalanceFee) * BigInt(feeMultiplier);
    transactionAmount = (BigInt(new FeeDecimal(amount.toString()).mul(buffer).ceil().toFixed(0)) + gas).toString();
    if (BigInt(transactionAmount) >= 1n << 256n) throw new Error('Network fee exceeds uint256');
    base.feeAmount = transactionAmount;
  } while (toBinary(schema, copy).length !== transactionSize);
  if (base.publicKey?.walletAddress) assertAuthenticationBudget(copy);
  protoObject.base.feeId = baseFeeId;
  protoObject.base.feeAmount = transactionAmount;
  onBaseFeeCalculated?.({
    transactionType, baseFeeId, ...(quoteKeys[0] && { publicKey: quoteKeys[0] }), baseFeeResponse: schedule,
    feeMultiplier, transactionSize, feeAmountParts: transactionAmount, newWalletFeeScaled
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
function initializationTargets(protoObject: TransactionMessage): { addresses: string[]; unconditional: number } | undefined {
  const typeName = (protoObject as { $typeName?: string }).$typeName;
  if (typeName === 'kal_txn.CoinTXN' && isCoinTXN(protoObject)) {
    const addresses: string[] = [];
    for (const output of protoObject.outputTransfers ?? []) {
      if (output.walletAddress && output.walletAddress.length > 0) {
        try {
          const addressString = bs58.encode(output.walletAddress);
          if (addressString && !addresses.includes(addressString)) addresses.push(addressString);
        } catch {
          // Skip addresses that cannot be encoded.
        }
      }
    }
    return { addresses, unconditional: 0 };
  }
  if (typeName === 'kal_txn.MintTXN') {
    const recipient = (protoObject as MintTXN).recipientAddress;
    if (!recipient || recipient.length === 0) return { addresses: [], unconditional: 0 };
    try {
      return { addresses: [bs58.encode(recipient)], unconditional: 0 };
    } catch {
      return { addresses: [], unconditional: 0 };
    }
  }
  if (typeName === 'kal_txn.InstrumentContract') {
    return {
      addresses: [],
      unconditional: (protoObject as InstrumentContract).premintWallets?.length ?? 0
    };
  }
  return undefined;
}

async function newBalanceCount(
  protoObject: TransactionMessage, contractId: string, grpcConfig?: GRPCConfig, needsInitialization?: boolean
): Promise<number> {
  const targets = initializationTargets(protoObject);
  if (!targets) return 0;
  const addressesToCheck = targets.addresses;
  if (addressesToCheck.length === 0 && targets.unconditional === 0) return 0;

  // Determine how many addresses don't hold the token. Premint wallets are new.
  let addressesWithoutBalance = targets.unconditional;

  if (needsInitialization === true) {
    // Override: user says all addresses need initialization — skip API calls entirely
    addressesWithoutBalance = addressesToCheck.length + targets.unconditional;
    logger.info('needsInitialization=true override: treating all addresses as needing initialization', {
      addressCount: addressesToCheck.length,
      operation: 'calculateNewTokenBalanceFee'
    });
  } else if (needsInitialization === false) {
    // Override: user says no addresses need initialization — skip API calls entirely
    logger.info('needsInitialization=false override: skipping new token balance fee', {
      operation: 'calculateNewTokenBalanceFee'
    });
    return 0;
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

  return addressesWithoutBalance;
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
    if (options.protoObject.base?.hash?.length || options.protoObject.base?.signature?.length ||
        options.protoObject.base?.publicKey?.witnesses.length || options.protoObject.base?.feePayer?.signature.length ||
        (isCoinTXN(options.protoObject) && options.protoObject.auth?.signature.length)) {
      throw new Error('Rebuild the unsigned transaction and collect fresh proofs before changing its fee cap');
    }
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
    
    if (transactionType === TRANSACTION_TYPE.COIN_TYPE && contractIdForFeeCheck &&
        (options.contractFeeParts !== undefined || options.contractFee !== undefined || workingTokenInfoMap.get(contractIdForFeeCheck)?.contractFees)) {
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
    await calculateNetworkFee(
      options.protoObject,
      transactionType,
      effectiveBaseFeeId,
      options.baseFee,
      options.baseFeeParts,
      workingTokenInfoMap,
      options.overestimatePercent,
      options.gasFeeInUsd,
      options.grpcConfig,
      options.onBaseFeeCalculated,
      options
    );

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
