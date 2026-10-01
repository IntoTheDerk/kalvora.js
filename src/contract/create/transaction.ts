/**
 * Contract Creation Transaction
 *
 * Creates, builds, and submits InstrumentContract transactions on the Kalvora network.
 *
 * `buildContractTXN()` constructs an unsigned transaction (no private keys needed).
 * `createContractTXN()` is a convenience wrapper: build + sign with private key.
 */

import { protoInt64, create } from '@bufbuild/protobuf';

import { CONTRACT_TYPE, InstrumentContractSchema } from '../../../proto/generated/txn_pb.js';
import type { InstrumentContract } from '../../../proto/generated/txn_pb.js';
import { submitTransaction } from '../../grpc/transaction/transaction-client.js';
import {
  CREATOR_AUTHORIZATION,
  CREATOR_KEY_ALGORITHM,
  deriveContractDataHash,
  deriveOrdinaryContractId
} from '../../protocol/contract-id.js';
import { generateAddressFromPublicKey, getKeyTypeFromPublicKey, getPublicKeyBytes } from '../../shared/crypto/address-utils.js';
import { KEY_TYPE } from '../../shared/crypto/constants.js';
import { UniversalFeeCalculator, type FeeConfigHelper } from '../../shared/fee-calculators/universal-fee-calculator.js';
import { logger } from '../../shared/monitoring/index.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { buildStandardBaseTXN, getAddressAndNonce } from '../../shared/tx/base.js';
import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import { signWithKey } from '../../sign/finalize.js';
import type { GRPCConfig } from '../../types/index.js';
import type { CreateContractOptions } from '../shared/types.js';
import { validateKeyPair, validateCreateContractOptions, validatePremintWallets } from '../shared/utils.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for building an unsigned InstrumentContract (contract creation).
 * Identical to `CreateContractOptions` but omits `privateKeyBase58`.
 */
export type BuildContractOptions = Omit<CreateContractOptions, 'privateKeyBase58'>;

// ============================================================================
// PUBLIC API — BUILD UNSIGNED
// ============================================================================

/**
 * Build an unsigned InstrumentContract (contract creation) transaction.
 *
 * Performs all validation, nonce fetching, and fee calculation but **stops before signing**.
 *
 * @param options - Contract creation options (no private key needed)
 * @returns An unsigned `InstrumentContract` protobuf
 *
 * @example
 * ```typescript
 * import { buildContractTXN, CONTRACT_TYPE, signAndFinalize } from 'kalvora.js';
 *
 * const unsigned = await buildContractTXN({
 *   contractVersion: 1000000n, symbol: 'MYT', name: 'My Token',
 *   type: CONTRACT_TYPE.TOKEN, vanityNonce: 1n,
 *   publicKeyBase58Identifier: 'A_…',
 *   coinDenomination: { denominationName: 'parts', amount: '1000000000' }
 * });
 * const signed = await signAndFinalize(unsigned, signer);
 * ```
 */
function creatorAuthorization(publicKeyId: string): {
  creatorAuthorizationType: number;
  creatorKeyAlgorithm: number;
  creatorAuthorizationBytes: Uint8Array;
} {
  if (publicKeyId.startsWith('sc_')) {
    return {
      creatorAuthorizationType: CREATOR_AUTHORIZATION.SMART_CONTRACT,
      creatorKeyAlgorithm: CREATOR_KEY_ALGORITHM.NONE,
      creatorAuthorizationBytes: new TextEncoder().encode(publicKeyId)
    };
  }
  if (publicKeyId.startsWith('gov_')) {
    return {
      creatorAuthorizationType: CREATOR_AUTHORIZATION.GOVERNANCE,
      creatorKeyAlgorithm: CREATOR_KEY_ALGORITHM.NONE,
      creatorAuthorizationBytes: new TextEncoder().encode(publicKeyId)
    };
  }
  const keyType = getKeyTypeFromPublicKey(publicKeyId);
  return {
    creatorAuthorizationType: CREATOR_AUTHORIZATION.SINGLE_KEY,
    creatorKeyAlgorithm: keyType === KEY_TYPE.ED448
      ? CREATOR_KEY_ALGORITHM.ED448
      : CREATOR_KEY_ALGORITHM.ED25519,
    creatorAuthorizationBytes: getPublicKeyBytes(publicKeyId)
  };
}

function resolveContractId(options: BuildContractOptions): string {
  if (options.vanityNonce === undefined) {
    if (!options.contractId) {
      throw new Error('contractId is required when vanityNonce is not set');
    }
    return options.contractId;
  }
  const derived = deriveOrdinaryContractId({
    ...creatorAuthorization(options.publicKeyBase58Identifier),
    vanityNonce: options.vanityNonce,
    contractDataHash: deriveContractDataHash({
      symbol: options.symbol,
      type: options.type,
      ...(options.maxSupply !== undefined ? { maxSupply: options.maxSupply } : {}),
      ...(options.coinDenomination
        ? {
          coinDenomination: {
            denominationName: options.coinDenomination.denominationName,
            amount: options.coinDenomination.amount
          }
        }
        : {}),
      ...(options.maxSupplyRelease?.length
        ? {
          maxSupplyRelease: options.maxSupplyRelease.map(entry => ({
            seconds: entry.releaseDate?.seconds ?? 0n,
            nanos: entry.releaseDate?.nanos ?? 0,
            amount: entry.amount
          }))
        }
        : {})
    })
  });
  if (options.contractId !== undefined && options.contractId !== derived) {
    throw new Error(`contractId does not match the ID derived from vanityNonce ${options.vanityNonce}`);
  }
  return derived;
}

export async function buildContractTXN(
  options: BuildContractOptions
): Promise<InstrumentContract> {
  if (!options.publicKeyBase58Identifier) throw new Error('Public key identifier is required');
  const contractId = resolveContractId(options);
  validateCreateContractOptions({
    contractId, symbol: options.symbol,
    name: options.name, contractVersion: options.contractVersion, type: options.type
  });
  generateAddressFromPublicKey(options.publicKeyBase58Identifier);

  const itemCollection = options.type === CONTRACT_TYPE.NFT || options.type === CONTRACT_TYPE.SBT;
  if (itemCollection) {
    if (options.coinDenomination) {
      throw new Error('NFT and SBT contracts must leave coinDenomination unset');
    }
    if (options.premintWallets?.length) {
      throw new Error('NFT and SBT contracts must leave premintWallets unset');
    }
    if (options.expenseRatio?.length) {
      throw new Error('NFT and SBT contracts must leave expenseRatio unset');
    }
    if (options.contractFees) {
      throw new Error('NFT and SBT contracts must leave contractFees unset. Item fees belong on ItemizedMintTXN');
    }
  } else if (!options.coinDenomination) {
    throw new Error('TOKEN contracts require coinDenomination');
  }
  if ((options.restrictedKeys?.length ?? 0) > 50) {
    throw new Error('restrictedKeys cannot exceed 50');
  }

  if (options.premintWallets) {
    validatePremintWallets({ contractType: options.type, premintWallets: options.premintWallets });
  }

  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;

  let nonce: bigint;
  if (options.nonce !== undefined) {
    nonce = protoInt64.uParse(String(options.nonce));
    logger.warn('Manual nonce specified - skipping network nonce fetch.', { operation: 'buildContractTXN', nonce: String(options.nonce) });
  } else {
    const result = await getAddressAndNonce(options.publicKeyBase58Identifier, grpcConfig);
    nonce = result.nonce;
  }

  const baseParams: { publicKeyId: string; nonce: bigint; memo?: string; feeId?: string; feeAmountParts?: string } = { publicKeyId: options.publicKeyBase58Identifier, nonce };
  if (options.memo) baseParams.memo = options.memo;
  if (options.feeId !== undefined) baseParams.feeId = options.feeId;
  if (options.feeAmountParts !== undefined) baseParams.feeAmountParts = options.feeAmountParts;
  const base = buildStandardBaseTXN(baseParams);

  const contractData: Record<string, unknown> = {
    base, contractVersion: options.contractVersion, symbol: options.symbol,
    name: options.name, type: options.type, contractId,
    updateContractFees: options.updateContractFees ?? false, updateExpenseRatio: options.updateExpenseRatio ?? false,
    kycStatus: options.kycStatus ?? false, immutableKycStatus: options.immutableKycStatus ?? false
  };
  if (options.vanityNonce !== undefined) contractData.vanityNonce = protoInt64.uParse(String(options.vanityNonce));
  if (options.governance) contractData.governance = options.governance;
  if (options.restrictedKeys?.length) contractData.restrictedKeys = options.restrictedKeys;
  if (options.maxSupply) contractData.maxSupply = options.maxSupply;
  if (!itemCollection && options.contractFees) contractData.contractFees = options.contractFees;
  if (!itemCollection && options.premintWallets?.length) contractData.premintWallets = options.premintWallets;
  if (!itemCollection && options.coinDenomination) contractData.coinDenomination = options.coinDenomination;
  if (options.customParameters?.length) contractData.customParameters = options.customParameters;
  if (!itemCollection && options.expenseRatio?.length) contractData.expenseRatio = options.expenseRatio;
  if (options.quashThreshold !== undefined) contractData.quashThreshold = options.quashThreshold;
  if (options.tokenCompliance?.length) contractData.tokenCompliance = options.tokenCompliance;
  if (options.maxSupplyRelease?.length) contractData.maxSupplyRelease = options.maxSupplyRelease;

  const contractTxn = create(InstrumentContractSchema, contractData);
  const effectiveFeeId = options.feeId || KALVORA_NATIVE_TOKEN;

  const feeOptions: FeeConfigHelper<InstrumentContract> = {
    protoObject: contractTxn, tokenInfoMap: new Map(), baseFeeId: effectiveFeeId,
    contractId,
    ...(options.grpcConfig ? { grpcConfig: options.grpcConfig } : {}),
    ...(options.feeAmountParts !== undefined && { baseFeeParts: options.feeAmountParts })
  };
  await UniversalFeeCalculator.calculateFee<InstrumentContract>(feeOptions);
  if (contractTxn.base?.feeAmount === '1') {
    throw new Error('Refusing to set fee_amount to "1". The contract-creation fee schedule was not loaded.');
  }

  return contractTxn;
}

// ============================================================================
// PUBLIC API — CONVENIENCE (build + sign)
// ============================================================================

/**
 * Creates a new contract (InstrumentContract) transaction.
 *
 * Convenience wrapper: builds with `buildContractTXN()` then signs with the provided private key.
 */
export async function createContractTXN(
  options: CreateContractOptions
): Promise<InstrumentContract> {
  validateKeyPair({
    publicKeyBase58Identifier: options.publicKeyBase58Identifier,
    privateKeyBase58: options.privateKeyBase58
  });

  const { privateKeyBase58, ...unsignedOptions } = options;
  const contractTxn = await buildContractTXN(unsignedOptions);

  signWithKey(contractTxn, privateKeyBase58, options.publicKeyBase58Identifier);

  return contractTxn;
}

// ============================================================================
// PUBLIC API — SEND
// ============================================================================

/**
 * Submit a signed contract creation transaction.
 *
 * The returned hash means the node accepted the transaction into the mempool.
 * Confirm inclusion with `waitForTransaction`, which reads `TXNStatusFees`.
 */
export async function sendContractTXN(
  contract: InstrumentContract,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  return submitTransaction(contract, grpcConfig);
}
