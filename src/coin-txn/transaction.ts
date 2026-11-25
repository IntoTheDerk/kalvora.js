/**
 * Transaction Module - CoinTXN
 *
 * Creates, builds, and submits CoinTXN transactions on the Kalvora network.
 *
 * `buildCoinTXN()` constructs an unsigned transaction (no private keys needed).
 * `createCoinTXN()` is a convenience wrapper: build + sign with private keys.
 *
 * @module CoinTXN
 *
 * @example
 * ```typescript
 * import { buildCoinTXN, signCoinTXNWithKeys, sendCoinTXN } from 'kalvora.js';
 *
 * const txn = await buildCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
 * signCoinTXNWithKeys(txn, [{ publicKey, privateKey }]);
 * const txHash = await sendCoinTXN(txn);
 * ```
 */

import { protoInt64, create } from '@bufbuild/protobuf';
import bs58 from 'bs58';

import { TimestampSchema } from '../../proto/generated/google/protobuf/timestamp_pb.js';
import type { Timestamp } from '../../proto/generated/google/protobuf/timestamp_pb.js';
import {
  CoinTXNSchema,
  InputTransfersSchema,
  OutputTransfersSchema,
  BaseTXNSchema,
  TransferAuthenticationSchema
} from '../../proto/generated/txn_pb.js';
import type {
  CoinTXN,
  InputTransfers,
  OutputTransfers,
  BaseTXN,
  TransferAuthentication,
  PublicKey
} from '../../proto/generated/txn_pb.js';
import { getNonces } from '../api/handler/nonce/service.js';
import { decodeRecipientAddress, generateAddressFromPublicKey, sanitizeAndDecodeAddress } from '../shared/crypto/address-utils.js';
import { UniversalFeeCalculator, type BaseFeeCalculationDetails, type FeeConfig, type FeeConfigHelper } from '../shared/fee-calculators/universal-fee-calculator.js';
import { logger } from '../shared/monitoring/index.js';
import { KALVORA_NATIVE_TOKEN } from '../shared/network/constants.js';
import { signerPublicKey } from '../shared/tx/base.js';
import { Decimal } from '../shared/utils/amount-utils.js';
import { PROTONET_GRPC_CONFIG } from '../shared/utils/testing-defaults/index.js';
import { getTokenInfo, type TokenInfo, normalizeContractId } from '../shared/utils/token-info.js';
import { toSmallestUnits } from '../shared/utils/unified-amount-conversion.js';
import { isValidContractId } from '../shared/utils/validation.js';
import { transactionContextFields, type TransactionContext } from '../sign/context.js';
import { signCoinTXN, signCoinTXNWithKeys } from '../sign/finalize.js';
import type {
  AmountInput,
  CoinTXNInput,
  CoinTXNOutput,
  GRPCConfig
} from '../types/index.js';
import { derivePolicyAddress } from '../wallet-registration/policy.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for building an unsigned CoinTXN.
 * Unlike `CoinTXNInput`, private keys are NOT required.
 */
export interface CoinTXNBuildInput {
  /** Public key identifier (e.g., 'ed25519:9Xk3...') */
  publicKey?: string;
  /** Amount to transfer */
  amount?: AmountInput;
  /** Fee percentage this input pays (must total 100 across all inputs) */
  feePercent?: string;
  /** Independent share of contract fees, in percent. Defaults to feePercent. */
  contractFeePercent?: string;
  /** For allowance transactions — the address granting the allowance */
  allowanceAddress?: string;
  /** Manual nonce override (skips network fetch when provided) */
  nonce?: string | number | bigint;
}

export interface CoinTXNBuildOptions {
  safeSend?: boolean;
  /** Cached token metadata for an offline build with explicit nonces and fee caps. */
  tokenInfoMap?: Map<string, TokenInfo>;
  /**
   * Called with the network base fee schedule used during build.
   * Existing callers can ignore this; the returned CoinTXN is unchanged.
   */
  onBaseFeeCalculated?: (details: BaseFeeCalculationDetails) => void;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function validateTransactionRequirements(
  inputs: CoinTXNBuildInput[],
  outputs: { to: string; amount: AmountInput; memo?: string }[],
  contractId: string
): void {
  if (!Array.isArray(inputs) || !Array.isArray(outputs)) {
    throw new Error('Inputs and outputs must be arrays');
  }
  if (inputs.length === 0 || outputs.length === 0) {
    throw new Error('Must have at least one input and one output');
  }
  if (!contractId || !isValidContractId(contractId)) {
    throw new Error('ContractId must be a valid Kalvora mint ID (e.g., KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao)');
  }
}

function totalParts(transfers: readonly { amount: string }[]): bigint {
  let total = 0n;
  for (const { amount } of transfers) {
    if (!/^\d+$/u.test(amount)) throw new Error('Transfer amounts must be unsigned parts');
    total += BigInt(amount);
    if (total >= 1n << 256n) throw new Error('Total transfer amount must fit in uint256');
  }
  return total;
}

function validateFeePercentages(inputTransfers: InputTransfers[]): void {
  for (const field of ['feePercent', 'contractFeePercent'] as const) {
    const total = inputTransfers.reduce((sum, input) => sum + (input[field] ?? 0), 0);
    if (total !== 100000000) throw new Error(`Fee percentages must sum to exactly 100% (100,000,000). Current sum: ${total}`);
  }
}

function scaledShare(value: string): number {
  const scaled = new Decimal(value).mul(1000000);
  if (!scaled.isInteger() || scaled.isNegative() || scaled.gt(100000000)) throw new Error('Invalid fee percentage');
  return scaled.toNumber();
}

async function processUnsignedInputs(
  inputs: CoinTXNBuildInput[],
  contractID: string,
  tokenInfoMap: Map<string, TokenInfo>,
  grpcConfig: GRPCConfig = {}
): Promise<{
  publicKeys: PublicKey[];
  inputTransfers: InputTransfers[];
  nonces: bigint[];
  allowanceAddresses: Uint8Array[] | null;
  allowanceNonces: bigint[] | null;
}> {
  const publicKeys: PublicKey[] = [];
  const inputTransfers: InputTransfers[] = [];
  const addresses: string[] = [];
  let isAllowance = false;

  const allInputsHaveNonces = inputs.every(input => input.nonce !== undefined);
  if (allInputsHaveNonces) {
    logger.warn('Manual nonces specified for all inputs - skipping network nonce fetch.', {
      operation: 'processUnsignedInputs',
      inputCount: inputs.length
    });
  }

  for (const input of inputs) {
    if (!input.publicKey && !input.allowanceAddress) {
      throw new Error(`Input ${inputs.indexOf(input)} is missing publicKey`);
    } else if (input.allowanceAddress) {
      isAllowance = true;
    }

    let address = '';
    if (input.publicKey) {
      address = generateAddressFromPublicKey(input.publicKey);
    } else if (input.allowanceAddress) {
      address = input.allowanceAddress;
    } else {
      throw new Error(`Input ${inputs.indexOf(input)} is missing or using unsupported publicKey type`);
    }
    addresses.push(address);
  }

  if (isAllowance && (!inputs[0]?.publicKey || inputs[0].allowanceAddress ||
      inputs.slice(1).some(input => !input.allowanceAddress || input.publicKey))) {
    throw new Error('Allowance Coin requires a signing spender first, followed by allowance source addresses');
  }

  let nonceDecimals: Decimal[];
  if (allInputsHaveNonces) {
    nonceDecimals = inputs.map(input => new Decimal(String(input.nonce)));
  } else {
    nonceDecimals = await getNonces(addresses, grpcConfig);
    nonceDecimals = nonceDecimals.map((nonce, i) => inputs[i]?.nonce === undefined ? nonce : new Decimal(String(inputs[i]?.nonce)));
  }

  let allowanceNonceDecimals: Decimal[] = [];
  let allowanceAddresses: string[] = [];
  let finalNonceDecimals = nonceDecimals;

  if (isAllowance) {
    allowanceNonceDecimals = nonceDecimals.slice(1);
    allowanceAddresses = addresses.slice(1);
    finalNonceDecimals = nonceDecimals.slice(0, 1);
  }

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (!input) throw new Error(`Input at index ${i} is undefined`);

    if (input.publicKey) {
      const publicKeyObj = signerPublicKey(input.publicKey);
      publicKeys.push(publicKeyObj);
    } else if (!input.publicKey && !isAllowance) {
      throw new Error(`Input ${i} is missing publicKey`);
    }

    if (isAllowance && input.publicKey) continue;

    const inputTokenInfo = tokenInfoMap.get(contractID);

    if (input.amount === undefined && input.allowanceAddress) {
      throw new Error(`Allowance input at index ${i} must specify an amount`);
    }
    if (input.amount === undefined) {
      throw new Error(`Input at index ${i} must specify an amount`);
    }

    const finalAmount = toSmallestUnits(input.amount, contractID, inputTokenInfo?.denomination
      ? { denomination: inputTokenInfo.denomination }
      : {}
    );
    const feePercent = input.feePercent !== undefined ? input.feePercent : '100';

    inputTransfers.push(create(InputTransfersSchema, {
      index: protoInt64.parse(inputTransfers.length),
      amount: finalAmount,
      feePercent: scaledShare(feePercent),
      contractFeePercent: scaledShare(input.contractFeePercent ?? feePercent)
    }));
  }

  const nonces = finalNonceDecimals.map(nonce => protoInt64.uParse(nonce.toString()));
  if (publicKeys.some(key => key.walletAddress) && nonceDecimals.some(nonce => !nonce.isInteger() || nonce.lte(0))) {
    throw new Error('Registered Coin authorizations and allowance sources require positive next nonces');
  }

  const allowanceNonces = allowanceNonceDecimals.length > 0
    ? allowanceNonceDecimals.map(nonce => protoInt64.uParse(nonce.toString()))
    : null;

  const finalAllowanceAddresses = allowanceAddresses.length > 0
    ? allowanceAddresses.map(addr => publicKeys[0]?.walletAddress ? decodeRecipientAddress(addr) : sanitizeAndDecodeAddress(addr))
    : null;

  return { publicKeys, inputTransfers, nonces, allowanceAddresses: finalAllowanceAddresses, allowanceNonces };
}

function processOutputs(
  outputs: { to: string; amount: AmountInput; memo?: string }[],
  tokenInfoMap: Map<string, TokenInfo>,
  contractId: string
): OutputTransfers[] {
  return outputs.map(output => {
    const outputTokenInfo = tokenInfoMap.get(contractId);
    const finalAmount = toSmallestUnits(output.amount, contractId, outputTokenInfo?.denomination
      ? { denomination: outputTokenInfo.denomination }
      : {}
    );
    const data: { walletAddress: Uint8Array; amount: string; memo?: string } = {
      walletAddress: decodeRecipientAddress(output.to, true), amount: finalAmount
    };
    if (output.memo && output.memo.trim() !== '') {
      data.memo = output.memo;
    }
    return create(OutputTransfersSchema, data);
  });
}

function createBaseTransaction(baseFeeId: string = KALVORA_NATIVE_TOKEN, baseFee: AmountInput, baseMemo: string, context?: TransactionContext): BaseTXN {
  if (!baseFee || baseFee === '0') {
    throw new Error('Base fee must be provided and cannot be 0');
  }

  const now = new Date();
  const timestamp = create(TimestampSchema, {
    seconds: protoInt64.parse(Math.floor(now.getTime() / 1000)),
    nanos: (now.getTime() % 1000) * 1000000
  });

  const baseData: { timestamp: Timestamp; feeAmount: string; feeId: string; memo?: string } = {
    timestamp: timestamp,
    feeAmount: String(baseFee),
    feeId: baseFeeId
  };
  if (baseMemo && baseMemo.trim() !== '') {
    baseData.memo = baseMemo;
  }
  return create(BaseTXNSchema, { ...baseData, ...transactionContextFields('kal_txn.CoinTXN', context) });
}

function createTransferAuth(
  publicKeys: PublicKey[],
  signatures: Uint8Array[],
  nonces: bigint[],
  allowanceAddresses: Uint8Array[] | null = null,
  allowanceNonces: bigint[] | null = null
): TransferAuthentication {
  const authData: {
    publicKey?: PublicKey[];
    signature?: Uint8Array[];
    nonce?: bigint[];
    allowanceAddress?: Uint8Array[];
    allowanceNonce?: bigint[];
  } = {};
  if (publicKeys && publicKeys.length > 0) authData.publicKey = publicKeys;
  if (nonces && nonces.length > 0) authData.nonce = nonces;
  if (signatures && signatures.length > 0) authData.signature = signatures;
  if (allowanceAddresses && allowanceAddresses.length > 0) authData.allowanceAddress = allowanceAddresses;
  if (allowanceNonces && allowanceNonces.length > 0) authData.allowanceNonce = allowanceNonces;
  return create(TransferAuthenticationSchema, authData);
}

// ============================================================================
// PUBLIC API — BUILD UNSIGNED
// ============================================================================

/**
 * Build an unsigned CoinTXN.
 *
 * Performs all validation, nonce fetching, and fee calculation
 * but **stops before signing**. The returned transaction
 * has no signatures and no hash — it is ready to be signed externally.
 *
 * @param inputs   - Transaction inputs (publicKey + amount, no private key needed)
 * @param outputs  - Transaction outputs (recipient + amount)
 * @param contractId - Contract ID (e.g., 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao')
 * @param feeConfig  - Fee configuration
 * @param baseMemo   - Optional memo
 * @param grpcConfig - Optional gRPC configuration
 * @param buildOptions - Optional metadata hooks for callers that need fee details
 * @returns An unsigned `CoinTXN` protobuf (no signatures, no hash)
 *
 * @example
 * ```typescript
 * const unsigned = await buildCoinTXN(
 *   [{ publicKey: 'ed25519:9Xk3...', amount: '10.5' }],
 *   [{ to: 'recipient-address', amount: '10.0' }],
 *   'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
 * );
 * ```
 */
export async function buildCoinTXN(
  inputs: CoinTXNBuildInput[],
  outputs: { to: string; amount: AmountInput; memo?: string }[],
  contractId: string,
  feeConfig: FeeConfig = { baseFeeId: KALVORA_NATIVE_TOKEN },
  baseMemo: string = '',
  grpcConfig: GRPCConfig = PROTONET_GRPC_CONFIG,
  buildOptions: CoinTXNBuildOptions = {}
): Promise<CoinTXN> {
  // Normalize all contract IDs to canonical casing for consistent lookups
  const normalizedContractId = normalizeContractId(contractId);
  const normalizedFeeConfig: FeeConfig = {
    ...feeConfig,
    ...(feeConfig.baseFeeId && { baseFeeId: normalizeContractId(feeConfig.baseFeeId) }),
    ...(feeConfig.contractFeeId && { contractFeeId: normalizeContractId(feeConfig.contractFeeId) }),
    ...(feeConfig.interfaceFeeId && { interfaceFeeId: normalizeContractId(feeConfig.interfaceFeeId) })
  };

  validateTransactionRequirements(inputs, outputs, normalizedContractId);

  const tokenInfoMap = buildOptions.tokenInfoMap ?? await getTokenInfo(
    normalizedContractId,
    [normalizedFeeConfig.contractFeeId, normalizedFeeConfig.interfaceFeeId, normalizedFeeConfig.baseFeeId].filter((id): id is string => Boolean(id)),
    grpcConfig
  );

  // Process inputs (without private keys)
  const inputsCopy = inputs.map(i => ({ ...i }));
  const { publicKeys, inputTransfers, nonces, allowanceAddresses, allowanceNonces } = await processUnsignedInputs(
    inputsCopy, normalizedContractId, tokenInfoMap, grpcConfig
  );

  const outputTransfers = processOutputs(outputs, tokenInfoMap, normalizedContractId);
  if (totalParts(inputTransfers) !== totalParts(outputTransfers)) throw new Error('Amount mismatch in coin transaction');
  validateFeePercentages(inputTransfers);

  // Build unsigned transaction
  const initialTxnBase = createBaseTransaction(normalizedFeeConfig.baseFeeId, '1', baseMemo, grpcConfig.transactionContext);
  const firstIdentity = inputs[0]?.publicKey;
  if (publicKeys[0]?.walletAddress && firstIdentity) initialTxnBase.publicKey = signerPublicKey(firstIdentity);
  if (buildOptions.safeSend !== undefined) {
    if (typeof buildOptions.safeSend !== 'boolean') throw new Error('safeSend must be a boolean');
    initialTxnBase.safeSend = buildOptions.safeSend;
  }
  const initialCoinTxnData: Record<string, unknown> = {
    base: initialTxnBase,
    contractId: normalizedContractId,
    auth: createTransferAuth(publicKeys, [], nonces, allowanceAddresses, allowanceNonces),
    inputTransfers,
    outputTransfers
  };

  let coinTxn = create(CoinTXNSchema, initialCoinTxnData);

  // Calculate fees
  const feeConfigHelper: FeeConfigHelper<CoinTXN> = {
    ...normalizedFeeConfig,
    ...(grpcConfig && !normalizedFeeConfig.grpcConfig ? { grpcConfig } : {}),
    contractId: coinTxn.contractId,
    protoObject: coinTxn,
    tokenInfoMap,
    ...(buildOptions.onBaseFeeCalculated ? { onBaseFeeCalculated: buildOptions.onBaseFeeCalculated } : {})
  };
  coinTxn = await UniversalFeeCalculator.calculateFee(feeConfigHelper);

  // Return unsigned — no signatures, no hash
  return coinTxn;
}

// ============================================================================
// PUBLIC API — CONVENIENCE (build + sign)
// ============================================================================

/**
 * Creates a CoinTXN transaction with inputs and outputs.
 *
 * Convenience wrapper: builds with `buildCoinTXN()` then signs with `signCoinTXNWithKeys()`.
 *
 * @param inputs - Array of transaction inputs (with private keys for signing)
 * @param outputs - Array of transaction outputs (recipient addresses and amounts)
 * @param contractId - The contract ID (e.g., 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao')
 * @param feeConfig - Optional fee configuration
 * @param baseMemo - Optional memo
 * @param grpcConfig - Optional gRPC configuration
 * @returns Promise that resolves to a complete, signed CoinTXN
 */
export async function createCoinTXN(
  inputs: CoinTXNInput[],
  outputs: CoinTXNOutput[],
  contractId: string,
  feeConfig: FeeConfig = { baseFeeId: KALVORA_NATIVE_TOKEN },
  baseMemo: string = '',
  grpcConfig: GRPCConfig = PROTONET_GRPC_CONFIG,
  buildOptions: CoinTXNBuildOptions = {}
): Promise<CoinTXN> {
  const buildInputs = inputs.map(({ signer, privateKey: _privateKey, ...input }) => {
    if (!signer) return input;
    const address = 'policy' in signer ? bs58.encode(derivePolicyAddress(signer.policy, signer.walletHash)) : signer.walletAddress;
    if (!address || input.allowanceAddress || (input.publicKey && input.publicKey !== address)) throw new Error('Coin input requires its selected signer address');
    return { ...input, publicKey: address };
  });
  const coinTxn = await buildCoinTXN(buildInputs, outputs, contractId, feeConfig, baseMemo, grpcConfig, buildOptions);
  const authorizers = inputs.filter(input => !input.allowanceAddress);
  if (authorizers.some(input => input.signer)) {
    return signCoinTXN(coinTxn, authorizers.map(input => {
      if (!input.signer) throw new Error('Supply a registered signer for each Coin authorization');
      return input.signer;
    }), grpcConfig.transactionContext);
  }
  const signerKeys = authorizers.map(input => ({ publicKey: input.publicKey ?? '', privateKey: input.privateKey ?? '' }));
  return signCoinTXNWithKeys(coinTxn, signerKeys, grpcConfig.transactionContext);
}

// ============================================================================
// PUBLIC API — SEND
// ============================================================================

/**
 * Sends a CoinTXN transaction to the Kalvora network via gRPC.
 */
export async function sendCoinTXN(coinTxn: CoinTXN, grpcConfig: GRPCConfig = {}): Promise<string> {
  const { submitTransaction } = await import('../grpc/transaction/transaction-client.js');
  return submitTransaction(coinTxn, grpcConfig);
}
