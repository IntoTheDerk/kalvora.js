/**
 * Contract Creation Transaction
 *
 * Creates, builds, and submits InstrumentContract transactions on the Kalvora network.
 *
 * `buildContractTXN()` constructs an unsigned transaction (no private keys needed).
 * `createContractTXN()` is a convenience wrapper: build + sign with private key.
 */

import { protoInt64, create } from '@bufbuild/protobuf';

import { InstrumentContractSchema } from '../../../proto/generated/txn_pb.js';
import type { InstrumentContract } from '../../../proto/generated/txn_pb.js';
import { submitTransaction } from '../../grpc/transaction/transaction-client.js';
import { generateAddressFromPublicKey } from '../../shared/crypto/address-utils.js';
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
 * const unsigned = await buildContractTXN({
 *   contractVersion: BigInt(0), symbol: 'MYT', name: 'My Token',
 *   type: 0, contractId: 'MYT0000',
 *   publicKeyBase58Identifier: 'ed25519:9Xk3...',
 *   coinDenomination: { ... }
 * });
 * const signed = await signAndFinalize(unsigned, signer);
 * ```
 */
export async function buildContractTXN(
  options: BuildContractOptions
): Promise<InstrumentContract> {
  validateCreateContractOptions({
    contractId: options.contractId, symbol: options.symbol,
    name: options.name, contractVersion: options.contractVersion, type: options.type
  });
  if (!options.publicKeyBase58Identifier) throw new Error('Public key identifier is required');
  generateAddressFromPublicKey(options.publicKeyBase58Identifier);

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
    name: options.name, type: options.type, contractId: options.contractId,
    updateContractFees: options.updateContractFees ?? false, updateExpenseRatio: options.updateExpenseRatio ?? false,
    kycStatus: options.kycStatus ?? false, immutableKycStatus: options.immutableKycStatus ?? false
  };
  if (options.governance) contractData.governance = options.governance;
  if (options.restrictedKeys?.length) contractData.restrictedKeys = options.restrictedKeys;
  if (options.maxSupply) contractData.maxSupply = options.maxSupply;
  if (options.contractFees) contractData.contractFees = options.contractFees;
  if (options.premintWallets?.length) contractData.premintWallets = options.premintWallets;
  contractData.coinDenomination = options.coinDenomination;
  if (options.customParameters?.length) contractData.customParameters = options.customParameters;
  if (options.expenseRatio?.length) contractData.expenseRatio = options.expenseRatio;
  if (options.quashThreshold !== undefined) contractData.quashThreshold = options.quashThreshold;
  if (options.tokenCompliance?.length) contractData.tokenCompliance = options.tokenCompliance;
  if (options.maxSupplyRelease?.length) contractData.maxSupplyRelease = options.maxSupplyRelease;

  const contractTxn = create(InstrumentContractSchema, contractData);
  const effectiveFeeId = options.feeId || KALVORA_NATIVE_TOKEN;

  const feeOptions: FeeConfigHelper<InstrumentContract> = {
    protoObject: contractTxn, tokenInfoMap: new Map(), baseFeeId: effectiveFeeId,
    ...(options.feeAmountParts !== undefined && { baseFee: options.feeAmountParts })
  };
  await UniversalFeeCalculator.calculateFee<InstrumentContract>(feeOptions);

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
 * Sends a contract creation transaction to the network.
 */
export async function sendContractTXN(
  contract: InstrumentContract,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  await submitTransaction(contract, grpcConfig);
  return contract.base?.hash
    ? Array.from(contract.base.hash).map(b => b.toString(16).padStart(2, '0')).join('')
    : 'Contract submitted (no hash available)';
}
