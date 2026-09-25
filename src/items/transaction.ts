/**
 * Item Transaction Module
 *
 * Creates, builds, and submits item-level transactions for NFT and SBT
 * contracts on the Kalvora network.
 *
 * `buildItemizedMintTXN()`, `buildNFTTXN()`, and `buildBurnSBTTXN()` construct
 * unsigned transactions. The matching `create*` functions are convenience
 * wrappers that build and sign with a private key.
 */

import { protoInt64, create } from '@bufbuild/protobuf';

import {
  BurnSBTTXNSchema,
  ItemContractFeesSchema,
  ItemizedMintTXNSchema,
  KeyValuePairSchema,
  NFTTXNSchema
} from '../../proto/generated/txn_pb.js';
import type {
  BurnSBTTXN,
  ItemContractFees,
  ItemizedMintTXN,
  KeyValuePair,
  NFTTXN
} from '../../proto/generated/txn_pb.js';
import { validateKeyPair } from '../contract/shared/utils.js';
import { submitTransaction } from '../grpc/transaction/transaction-client.js';
import { generateAddressFromPublicKey, sanitizeAndDecodeAddress } from '../shared/crypto/address-utils.js';
import { UniversalFeeCalculator, type FeeConfigHelper } from '../shared/fee-calculators/universal-fee-calculator.js';
import { logger } from '../shared/monitoring/index.js';
import { KALVORA_NATIVE_TOKEN } from '../shared/network/constants.js';
import { buildStandardBaseTXN, getAddressAndNonce } from '../shared/tx/base.js';
import { PROTONET_GRPC_CONFIG } from '../shared/utils/testing-defaults/index.js';
import { isValidContractId } from '../shared/utils/validation.js';
import { signWithKey } from '../sign/finalize.js';
import type { GRPCConfig } from '../types/index.js';

// ============================================================================
// TYPES
// ============================================================================

export interface StandardItemTXNOptions {
  /** Optional memo */
  memo?: string;
  /** Optional gRPC configuration */
  grpcConfig?: GRPCConfig;
  /** Overestimate percentage for fee calculation (defaults to calculator setting) */
  overestimatePercent?: number;
  /** Optional nonce override. When provided, skips network nonce fetch. */
  nonce?: string | number | bigint;
  /** Base fee contract ID (defaults to `KALVORA_NATIVE_TOKEN`) */
  feeId?: string;
  /** Manual base fee amount in smallest units/parts */
  feeAmountParts?: string;
}

export type ItemizedMintParameterInput = Pick<KeyValuePair, 'key' | 'value'>;

export interface ItemContractFeesInput {
  /** Item fee amount */
  fee: string;
  /** Optional fee recipient address as a Kalvora address string or raw address bytes */
  feeAddress?: string | Uint8Array;
  /** Burn amount */
  burn: string;
  /** Validator amount */
  validator: string;
  /** Contract IDs allowed to pay this item's fees */
  allowedFeeInstrument?: string[];
}

export interface BuildItemizedMintOptions extends StandardItemTXNOptions {
  /** Contract ID for the NFT/SBT item collection */
  contractId: string;
  /** Item ID to mint */
  itemId: string;
  /** Recipient wallet address */
  recipientAddress: string;
  /** Public key identifier of the minter */
  publicKeyBase58Identifier: string;
  /** Optional governance voting weight for this item */
  votingWeight?: string;
  /** Optional item metadata/attributes */
  parameters?: ItemizedMintParameterInput[];
  /** Optional expiry as uint64-compatible value */
  expiry?: string | number | bigint;
  /** Optional item-specific contract fee schedule */
  contractFees?: ItemContractFees | ItemContractFeesInput;
  /** Optional valid-from timestamp as uint64-compatible value */
  validFrom?: string | number | bigint;
}

export interface CreateItemizedMintOptions extends BuildItemizedMintOptions {
  /** Private key in base58 format */
  privateKeyBase58: string;
}

export interface BuildNFTTXNOptions extends StandardItemTXNOptions {
  /** NFT contract ID */
  contractId: string;
  /** NFT item ID */
  itemId: string;
  /** Recipient wallet address */
  recipientAddress: string;
  /** Public key identifier of the sender/owner */
  publicKeyBase58Identifier: string;
  /** Optional NFT contract fee ID */
  contractFeeId?: string;
  /** Optional NFT contract fee in smallest units/parts */
  contractFeeAmountParts?: string;
}

export interface CreateNFTTXNOptions extends BuildNFTTXNOptions {
  /** Private key in base58 format */
  privateKeyBase58: string;
}

export interface BuildBurnSBTTXNOptions extends StandardItemTXNOptions {
  /** SBT contract ID */
  contractId: string;
  /** SBT item ID to burn */
  itemId: string;
  /** Public key identifier of the authorized burner */
  publicKeyBase58Identifier: string;
}

export interface CreateBurnSBTTXNOptions extends BuildBurnSBTTXNOptions {
  /** Private key in base58 format */
  privateKeyBase58: string;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function validateItemIdentifiers(contractId: string, itemId: string): void {
  if (!contractId || !isValidContractId(contractId)) {
    throw new Error('ContractId must be a valid Kalvora mint ID (e.g., KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao)');
  }
  if (!itemId || itemId.trim() === '') {
    throw new Error('itemId is required');
  }
}

function validatePublicKey(publicKeyBase58Identifier: string): void {
  if (!publicKeyBase58Identifier) {
    throw new Error('publicKeyBase58Identifier is required');
  }
  generateAddressFromPublicKey(publicKeyBase58Identifier);
}

function parseOptionalUint64(value: string | number | bigint | undefined, fieldName: string): bigint | undefined {
  if (value === undefined) return undefined;
  try {
    return protoInt64.uParse(String(value));
  } catch (error) {
    throw new Error(`${fieldName} must be a valid uint64 value: ${(error as Error).message}`);
  }
}

async function buildBaseForItemTXN(
  operation: string,
  publicKeyBase58Identifier: string,
  options: StandardItemTXNOptions
) {
  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;

  let nonce: bigint;
  if (options.nonce !== undefined) {
    nonce = protoInt64.uParse(String(options.nonce));
    logger.warn('Manual nonce specified - skipping network nonce fetch.', {
      operation,
      nonce: String(options.nonce)
    });
  } else {
    const result = await getAddressAndNonce(publicKeyBase58Identifier, grpcConfig);
    nonce = result.nonce;
  }

  const baseParams: { publicKeyId: string; nonce: bigint; memo?: string; feeId?: string; feeAmountParts?: string } = {
    publicKeyId: publicKeyBase58Identifier,
    nonce
  };
  if (options.memo) baseParams.memo = options.memo;
  if (options.feeId !== undefined) baseParams.feeId = options.feeId;
  if (options.feeAmountParts !== undefined) baseParams.feeAmountParts = options.feeAmountParts;

  return buildStandardBaseTXN(baseParams);
}

function buildFeeOptions<T extends ItemizedMintTXN | NFTTXN | BurnSBTTXN>(
  txn: T,
  options: StandardItemTXNOptions
): FeeConfigHelper<T> {
  const effectiveFeeId = options.feeId || KALVORA_NATIVE_TOKEN;
  return {
    protoObject: txn,
    tokenInfoMap: new Map(),
    baseFeeId: effectiveFeeId,
    ...(options.grpcConfig ? { grpcConfig: options.grpcConfig } : {}),
    ...(options.feeAmountParts !== undefined && { baseFeeParts: options.feeAmountParts }),
    ...(options.overestimatePercent !== undefined && { overestimatePercent: options.overestimatePercent })
  };
}

function buildParameters(parameters: ItemizedMintParameterInput[] | undefined): KeyValuePair[] {
  if (!parameters?.length) return [];

  return parameters.map((parameter, index) => {
    if (!parameter.key || parameter.key.trim() === '') {
      throw new Error(`parameters[${index}].key is required`);
    }
    if (parameter.value === undefined || parameter.value === null) {
      throw new Error(`parameters[${index}].value is required`);
    }
    return create(KeyValuePairSchema, {
      key: parameter.key,
      value: parameter.value
    });
  });
}

function buildItemContractFees(fees: ItemContractFees | ItemContractFeesInput | undefined): ItemContractFees | undefined {
  if (!fees) return undefined;

  if (!fees.fee || !fees.burn || !fees.validator) {
    throw new Error('contractFees must include fee, burn, and validator');
  }

  const feeData: {
    fee: string;
    burn: string;
    validator: string;
    feeAddress?: Uint8Array;
    allowedFeeInstrument?: string[];
  } = {
    fee: fees.fee,
    burn: fees.burn,
    validator: fees.validator
  };

  const inputFeeAddress = fees.feeAddress;
  if (typeof inputFeeAddress === 'string') {
    feeData.feeAddress = sanitizeAndDecodeAddress(inputFeeAddress);
  } else if (inputFeeAddress instanceof Uint8Array) {
    feeData.feeAddress = inputFeeAddress;
  }

  if (fees.allowedFeeInstrument?.length) {
    feeData.allowedFeeInstrument = fees.allowedFeeInstrument;
  }

  return create(ItemContractFeesSchema, feeData);
}

function hashOrFallback(txn: { base?: { hash?: Uint8Array } }, fallback: string): string {
  return txn.base?.hash
    ? Array.from(txn.base.hash).map(b => b.toString(16).padStart(2, '0')).join('')
    : fallback;
}

// ============================================================================
// PUBLIC API - ITEMIZED MINT
// ============================================================================

/**
 * Build an unsigned ItemizedMintTXN.
 *
 * Use this to mint NFT/SBT collection items while keeping signing external.
 */
export async function buildItemizedMintTXN(
  options: BuildItemizedMintOptions
): Promise<ItemizedMintTXN> {
  validateItemIdentifiers(options.contractId, options.itemId);
  validatePublicKey(options.publicKeyBase58Identifier);
  if (!options.recipientAddress) throw new Error('recipientAddress is required');

  const recipientAddress = sanitizeAndDecodeAddress(options.recipientAddress);
  const base = await buildBaseForItemTXN('buildItemizedMintTXN', options.publicKeyBase58Identifier, options);
  const parameters = buildParameters(options.parameters);
  const expiry = parseOptionalUint64(options.expiry, 'expiry');
  const validFrom = parseOptionalUint64(options.validFrom, 'validFrom');
  const contractFees = buildItemContractFees(options.contractFees);

  const mintData: Record<string, unknown> = {
    base,
    contractId: options.contractId,
    itemId: options.itemId,
    recipientAddress
  };
  if (options.votingWeight !== undefined) mintData.votingWeight = options.votingWeight;
  if (parameters.length) mintData.parameters = parameters;
  if (expiry !== undefined) mintData.expiry = expiry;
  if (contractFees) mintData.contractFees = contractFees;
  if (validFrom !== undefined) mintData.validFrom = validFrom;

  const mintTxn = create(ItemizedMintTXNSchema, mintData);
  await UniversalFeeCalculator.calculateFee<ItemizedMintTXN>(buildFeeOptions(mintTxn, options));

  return mintTxn;
}

/**
 * Create and sign an ItemizedMintTXN.
 */
export async function createItemizedMintTXN(
  options: CreateItemizedMintOptions
): Promise<ItemizedMintTXN> {
  validateKeyPair({
    publicKeyBase58Identifier: options.publicKeyBase58Identifier,
    privateKeyBase58: options.privateKeyBase58
  });

  const { privateKeyBase58, ...unsignedOptions } = options;
  const mintTxn = await buildItemizedMintTXN(unsignedOptions);
  signWithKey(mintTxn, privateKeyBase58, options.publicKeyBase58Identifier);

  return mintTxn;
}

/**
 * Submit an ItemizedMintTXN to the network.
 */
export async function sendItemizedMintTXN(
  txn: ItemizedMintTXN,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  await submitTransaction(txn, grpcConfig);
  return hashOrFallback(txn, 'Itemized mint submitted (no hash available)');
}

// Common "item mint" aliases for callers who do not use the protobuf name.

// ============================================================================
// PUBLIC API - NFT TRANSFER
// ============================================================================

/**
 * Build an unsigned NFTTXN.
 */
export async function buildNFTTXN(
  options: BuildNFTTXNOptions
): Promise<NFTTXN> {
  validateItemIdentifiers(options.contractId, options.itemId);
  validatePublicKey(options.publicKeyBase58Identifier);
  if (!options.recipientAddress) throw new Error('recipientAddress is required');

  const recipientAddress = sanitizeAndDecodeAddress(options.recipientAddress);
  const base = await buildBaseForItemTXN('buildNFTTXN', options.publicKeyBase58Identifier, options);

  const nftData: Record<string, unknown> = {
    base,
    contractId: options.contractId,
    itemId: options.itemId,
    recipientAddress
  };
  if (options.contractFeeId !== undefined) nftData.contractFeeId = options.contractFeeId;
  if (options.contractFeeAmountParts !== undefined) nftData.contractFeeAmount = options.contractFeeAmountParts;

  const nftTxn = create(NFTTXNSchema, nftData);
  await UniversalFeeCalculator.calculateFee<NFTTXN>(buildFeeOptions(nftTxn, options));

  return nftTxn;
}

/**
 * Create and sign an NFTTXN.
 */
export async function createNFTTXN(
  options: CreateNFTTXNOptions
): Promise<NFTTXN> {
  validateKeyPair({
    publicKeyBase58Identifier: options.publicKeyBase58Identifier,
    privateKeyBase58: options.privateKeyBase58
  });

  const { privateKeyBase58, ...unsignedOptions } = options;
  const nftTxn = await buildNFTTXN(unsignedOptions);
  signWithKey(nftTxn, privateKeyBase58, options.publicKeyBase58Identifier);

  return nftTxn;
}

/**
 * Submit an NFTTXN to the network.
 */
export async function sendNFTTXN(
  txn: NFTTXN,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  await submitTransaction(txn, grpcConfig);
  return hashOrFallback(txn, 'NFT transaction submitted (no hash available)');
}


// ============================================================================
// PUBLIC API - SBT BURN
// ============================================================================

/**
 * Build an unsigned BurnSBTTXN.
 */
export async function buildBurnSBTTXN(
  options: BuildBurnSBTTXNOptions
): Promise<BurnSBTTXN> {
  validateItemIdentifiers(options.contractId, options.itemId);
  validatePublicKey(options.publicKeyBase58Identifier);

  const base = await buildBaseForItemTXN('buildBurnSBTTXN', options.publicKeyBase58Identifier, options);
  const burnTxn = create(BurnSBTTXNSchema, {
    base,
    contractId: options.contractId,
    itemId: options.itemId
  });
  await UniversalFeeCalculator.calculateFee<BurnSBTTXN>(buildFeeOptions(burnTxn, options));

  return burnTxn;
}

/**
 * Create and sign a BurnSBTTXN.
 */
export async function createBurnSBTTXN(
  options: CreateBurnSBTTXNOptions
): Promise<BurnSBTTXN> {
  validateKeyPair({
    publicKeyBase58Identifier: options.publicKeyBase58Identifier,
    privateKeyBase58: options.privateKeyBase58
  });

  const { privateKeyBase58, ...unsignedOptions } = options;
  const burnTxn = await buildBurnSBTTXN(unsignedOptions);
  signWithKey(burnTxn, privateKeyBase58, options.publicKeyBase58Identifier);

  return burnTxn;
}

/**
 * Submit a BurnSBTTXN to the network.
 */
export async function sendBurnSBTTXN(
  txn: BurnSBTTXN,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  await submitTransaction(txn, grpcConfig);
  return hashOrFallback(txn, 'SBT burn submitted (no hash available)');
}
