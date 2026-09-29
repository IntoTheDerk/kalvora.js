/**
 * Contract Update Transaction
 *
 * Creates, builds, and submits ContractUpdateTXN transactions on the Kalvora network.
 *
 * `buildContractUpdateTXN()` constructs an unsigned transaction (no private keys needed).
 * `createContractUpdateTXN()` is a convenience wrapper: build + sign with private key.
 */

import { protoInt64, create } from '@bufbuild/protobuf';

import { ContractUpdateTXNSchema } from '../../../proto/generated/txn_pb.js';
import type { ContractUpdateTXN } from '../../../proto/generated/txn_pb.js';
import { submitTransaction } from '../../grpc/transaction/transaction-client.js';
import { generateAddressFromPublicKey } from '../../shared/crypto/address-utils.js';
import { UniversalFeeCalculator, type FeeConfigHelper } from '../../shared/fee-calculators/universal-fee-calculator.js';
import { logger } from '../../shared/monitoring/index.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { buildStandardBaseTXN, getAddressAndNonce } from '../../shared/tx/base.js';
import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import { signWithKey } from '../../sign/finalize.js';
import type { GRPCConfig } from '../../types/index.js';
import type { UpdateContractOptions } from '../shared/types.js';
import { validateKeyPair, validateUpdateContractOptions } from '../shared/utils.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for building an unsigned ContractUpdateTXN.
 * Identical to `UpdateContractOptions` but omits `privateKeyBase58`.
 */
export type BuildContractUpdateOptions = Omit<UpdateContractOptions, 'privateKeyBase58'>;

// ============================================================================
// PUBLIC API — BUILD UNSIGNED
// ============================================================================

/**
 * Build an unsigned ContractUpdateTXN transaction.
 *
 * Performs all validation, nonce fetching, and fee calculation but **stops before signing**.
 *
 * @param options - Contract update options (no private key needed)
 * @returns An unsigned `ContractUpdateTXN` protobuf
 *
 * @example
 * ```typescript
 * const unsigned = await buildContractUpdateTXN({
 *   contractId: 'MYT0000', contractVersion: BigInt(1),
 *   publicKeyBase58Identifier: 'ed25519:9Xk3...', name: 'Updated Name'
 * });
 * const signed = await signAndFinalize(unsigned, signer);
 * ```
 */
export async function buildContractUpdateTXN(
  options: BuildContractUpdateOptions
): Promise<ContractUpdateTXN> {
  validateUpdateContractOptions({ contractId: options.contractId, contractVersion: options.contractVersion });
  if (!options.publicKeyBase58Identifier) throw new Error('Public key identifier is required');
  generateAddressFromPublicKey(options.publicKeyBase58Identifier);

  const grpcConfig = options.grpcConfig || PROTONET_GRPC_CONFIG;

  let nonce: bigint;
  if (options.nonce !== undefined) {
    nonce = protoInt64.uParse(String(options.nonce));
    logger.warn('Manual nonce specified - skipping network nonce fetch.', { operation: 'buildContractUpdateTXN', nonce: String(options.nonce) });
  } else {
    const result = await getAddressAndNonce(options.publicKeyBase58Identifier, grpcConfig);
    nonce = result.nonce;
  }

  const baseParams: { publicKeyId: string; nonce: bigint; memo?: string; feeId?: string; feeAmountParts?: string } = { publicKeyId: options.publicKeyBase58Identifier, nonce };
  if (options.memo) baseParams.memo = options.memo;
  if (options.feeId !== undefined) baseParams.feeId = options.feeId;
  if (options.feeAmountParts !== undefined) baseParams.feeAmountParts = options.feeAmountParts;
  const base = buildStandardBaseTXN(baseParams);

  const updateData: Record<string, unknown> = { base, contractId: options.contractId, contractVersion: options.contractVersion };
  if (options.name) updateData.name = options.name;
  if (options.governance) updateData.governance = options.governance;
  if (options.restrictedKeys?.length) updateData.restrictedKeys = options.restrictedKeys;
  if (options.contractFees) updateData.contractFees = options.contractFees;
  if (options.customParameters?.length) updateData.customParameters = options.customParameters;
  if (options.expenseRatio?.length) updateData.expenseRatio = options.expenseRatio;
  if (options.tokenCompliance?.length) updateData.tokenCompliance = options.tokenCompliance;
  if (options.kycStatus !== undefined) updateData.kycStatus = options.kycStatus;
  if (options.immutableKycStatus !== undefined) updateData.immutableKycStatus = options.immutableKycStatus;
  if (options.quashThreshold !== undefined) updateData.quashThreshold = options.quashThreshold;

  const updateTxn = create(ContractUpdateTXNSchema, updateData);
  const effectiveFeeId = options.feeId || KALVORA_NATIVE_TOKEN;

  const feeOptions: FeeConfigHelper<ContractUpdateTXN> = {
    protoObject: updateTxn, tokenInfoMap: new Map(), baseFeeId: effectiveFeeId,
    ...(options.feeAmountParts !== undefined && { baseFee: options.feeAmountParts })
  };
  await UniversalFeeCalculator.calculateFee<ContractUpdateTXN>(feeOptions);

  return updateTxn;
}

// ============================================================================
// PUBLIC API — CONVENIENCE (build + sign)
// ============================================================================

/**
 * Creates a contract update (ContractUpdateTXN) transaction.
 *
 * Convenience wrapper: builds with `buildContractUpdateTXN()` then signs with the provided private key.
 */
export async function createContractUpdateTXN(
  options: UpdateContractOptions
): Promise<ContractUpdateTXN> {
  validateKeyPair({
    publicKeyBase58Identifier: options.publicKeyBase58Identifier,
    privateKeyBase58: options.privateKeyBase58
  });

  const { privateKeyBase58, ...unsignedOptions } = options;
  const updateTxn = await buildContractUpdateTXN(unsignedOptions);

  signWithKey(updateTxn, privateKeyBase58, options.publicKeyBase58Identifier);

  return updateTxn;
}

// ============================================================================
// PUBLIC API — SEND
// ============================================================================

/**
 * Sends a contract update transaction to the network.
 */
export async function sendContractUpdateTXN(
  update: ContractUpdateTXN,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  await submitTransaction(update, grpcConfig);
  return update.base?.hash
    ? Array.from(update.base.hash).map(b => b.toString(16).padStart(2, '0')).join('')
    : 'Contract update submitted (no hash available)';
}
