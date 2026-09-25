/**
 * Unsigned, text-only GovernanceProposal construction.
 *
 * This module deliberately cannot accept executable governance transactions,
 * options, private keys, signatures, or submission instructions. The supplied
 * construction context is advisory indexer evidence; the validator remains
 * authoritative at submission time.
 */

import { create, protoInt64 } from '@bufbuild/protobuf';

import {
  GovernanceProposalSchema,
  type GovernanceProposal
} from '../../proto/generated/txn_pb.js';
import {
  generateAddressFromPublicKey,
  getKeyTypeFromPublicKey,
  getPublicKeyBytes
} from '../shared/crypto/address-utils.js';
import { KEY_TYPE } from '../shared/crypto/constants.js';
import {
  UniversalFeeCalculator,
  type FeeConfigHelper
} from '../shared/fee-calculators/universal-fee-calculator.js';
import { logger } from '../shared/monitoring/index.js';
import {
  isKalvoraMintId,
  KALVORA_PROTONET_NETWORK,
  KALVORA_NATIVE_TOKEN
} from '../shared/network/constants.js';
import { buildStandardBaseTXN, getAddressAndNonce } from '../shared/tx/base.js';
import { submitStandardTransaction } from '../shared/tx/standard.js';
import { PROTONET_GRPC_CONFIG } from '../shared/utils/testing-defaults/index.js';
import { signWithKey } from '../sign/finalize.js';
import type { GRPCConfig } from '../types/index.js';

// Text proposal fields may contain horizontal tab and line feed only where allowed below.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;
const MAXIMUM_CONSTRUCTION_INSTRUMENTS = 128;
const MAXIMUM_PUBLIC_KEY_IDENTIFIER_CHARACTERS = 256;
const MAXIMUM_FEE_INTEGER_DIGITS = 78;
const MAXIMUM_UINT256 = (1n << 256n) - 1n;
const MAXIMUM_CONTEXT_VALIDITY_MILLISECONDS = 5 * 60 * 1000;
const CONTEXT_CLOCK_SKEW_MILLISECONDS = 30 * 1000;

export const KALVORA_PROPOSAL_CONTEXT_SCHEMA =
  'kalvora-governance-construction-context-v1' as const;
export const KALVORA_PROPOSAL_POLICY_VERSION =
  'kalvora-governance-policy-v1' as const;

export const TEXT_PROPOSAL_LIMITS = Object.freeze({
  titleUtf8Bytes: 512,
  synopsisUtf8Bytes: 2048,
  bodyUtf8Bytes: 16 * 1024
});

export type ProposalGovernanceType =
  | 'staged'
  | 'cycle'
  | 'staggered'
  | 'adaptive'
  | 'none';

export interface TextGovernanceProposalInput {
  contractId: string;
  title: string;
  synopsis: string;
  body: string;
}

/**
 * A reviewed, wallet-scoped policy snapshot used to fail closed before build.
 *
 * This context does not prove current eligibility, fee sufficiency, validator
 * acceptance, inclusion, or finality.
 */
export interface ProposalConstructionContext {
  schema: typeof KALVORA_PROPOSAL_CONTEXT_SCHEMA;
  source: 'kalvora-indexer';
  network: typeof KALVORA_PROTONET_NETWORK;
  contractId: string;
  walletAddress: string;
  governanceType: ProposalGovernanceType;
  eligibleProposalInstrumentIds: readonly string[];
  policyVersion: typeof KALVORA_PROPOSAL_POLICY_VERSION;
  observedAt: string;
  expiresAt: string;
  observedAtHeight: number;
}

export interface BuildTextGovernanceProposalTXNOptions {
  constructionContext: ProposalConstructionContext;
  grpcConfig?: GRPCConfig;
  nonce?: string | number | bigint;
  timestamp?: Date;
  memo?: string;
  feeId?: string;
  feeAmountParts?: string;
  overestimatePercent?: number;
}

/**
 * Build a validator-shaped, unsigned text-only governance proposal.
 *
 * The result always has empty options and executable-effect collections, no
 * adaptive timestamps, and no signature/hash. Callers must independently bind
 * the returned exact bytes to wallet review before signing.
 */
export async function buildTextGovernanceProposalTXN(
  input: TextGovernanceProposalInput,
  publicKeyBase58Identifier: string,
  options: BuildTextGovernanceProposalTXNOptions
): Promise<GovernanceProposal> {
  if (!input || typeof input !== 'object') {
    throw new TypeError('proposal input is required');
  }
  if (
    typeof publicKeyBase58Identifier !== 'string' ||
    publicKeyBase58Identifier.length === 0 ||
    publicKeyBase58Identifier.length > MAXIMUM_PUBLIC_KEY_IDENTIFIER_CHARACTERS ||
    publicKeyBase58Identifier !== publicKeyBase58Identifier.trim()
  ) {
    throw new TypeError('publicKey identifier is required and must be bounded canonical text');
  }
  if (!options?.constructionContext) {
    throw new TypeError('reviewed proposal construction context is required');
  }

  const contractId = validateContractId(input.contractId, 'contractId');
  validatePublicKeyLength(publicKeyBase58Identifier);
  const walletAddress = generateAddressFromPublicKey(publicKeyBase58Identifier);
  validateConstructionContext(
    options.constructionContext,
    contractId,
    walletAddress,
    Date.now()
  );
  const title = validateText(input.title, 'title', TEXT_PROPOSAL_LIMITS.titleUtf8Bytes, false);
  const synopsis = validateText(
    input.synopsis,
    'synopsis',
    TEXT_PROPOSAL_LIMITS.synopsisUtf8Bytes,
    false
  );
  const body = validateText(input.body, 'body', TEXT_PROPOSAL_LIMITS.bodyUtf8Bytes, true);
  const memo =
    options.memo !== undefined
      ? validateText(options.memo, 'memo', TEXT_PROPOSAL_LIMITS.titleUtf8Bytes, false)
      : undefined;
  const feeId =
    options.feeId !== undefined ? validateContractId(options.feeId, 'feeId') : undefined;
  if (
    options.overestimatePercent !== undefined &&
    (!Number.isFinite(options.overestimatePercent) ||
      options.overestimatePercent < 0 ||
      options.overestimatePercent > 100)
  ) {
    throw new RangeError('overestimatePercent must be between 0 and 100');
  }

  const grpcConfig = options.grpcConfig ?? PROTONET_GRPC_CONFIG;
  let nonce: bigint;
  if (options.nonce !== undefined) {
    nonce = parseNonce(options.nonce);
    logger.warn('Manual nonce specified - skipping network nonce fetch.', {
      operation: 'buildTextGovernanceProposalTXN',
      nonce: String(options.nonce)
    });
  } else {
    nonce = (await getAddressAndNonce(publicKeyBase58Identifier, grpcConfig)).nonce;
  }

  const base = buildStandardBaseTXN({
    publicKeyId: publicKeyBase58Identifier,
    nonce,
    ...(memo !== undefined ? { memo } : {}),
    ...(options.timestamp !== undefined ? { timestamp: options.timestamp } : {}),
    ...(feeId !== undefined ? { feeId } : {}),
    ...(options.feeAmountParts !== undefined
      ? { feeAmountParts: validatePositiveInteger(options.feeAmountParts, 'feeAmountParts') }
      : {})
  });

  const proposal = create(GovernanceProposalSchema, {
    base,
    contractId,
    title,
    synopsis,
    body,
    options: [],
    governanceTxn: [],
    governanceOptionTxns: []
  });

  const feeOptions: FeeConfigHelper<GovernanceProposal> = {
    contractId,
    protoObject: proposal,
    tokenInfoMap: new Map(),
    baseFeeId: feeId ?? KALVORA_NATIVE_TOKEN,
    ...(options.grpcConfig !== undefined ? { grpcConfig: options.grpcConfig } : {}),
    ...(options.feeAmountParts !== undefined
      ? { baseFeeParts: options.feeAmountParts }
      : {}),
    ...(options.overestimatePercent !== undefined
      ? { overestimatePercent: options.overestimatePercent }
      : {})
  };
  if (options.feeAmountParts === undefined) {
    await UniversalFeeCalculator.calculateFee(feeOptions);
  } else {
    logger.warn('Manual fee specified - skipping network fee calculation.', {
      operation: 'buildTextGovernanceProposalTXN',
      feeId: feeId ?? KALVORA_NATIVE_TOKEN,
      feeAmountParts: options.feeAmountParts
    });
  }

  validateConstructionContext(
    options.constructionContext,
    contractId,
    walletAddress,
    Date.now()
  );
  assertUnsignedTextOnlyProposal(proposal);
  return proposal;
}

function validateConstructionContext(
  context: ProposalConstructionContext,
  expectedContractId: string,
  expectedWalletAddress: string,
  validationTimeMilliseconds: number
): void {
  if (!context || typeof context !== 'object') {
    throw new TypeError('reviewed proposal construction context is required');
  }
  if (
    context.schema !== KALVORA_PROPOSAL_CONTEXT_SCHEMA ||
    context.source !== 'kalvora-indexer' ||
    context.network !== KALVORA_PROTONET_NETWORK
  ) {
    throw new RangeError('proposal construction context source, schema, or network is invalid');
  }
  const contextContractId = validateContractId(
    context.contractId,
    'constructionContext.contractId'
  );
  if (contextContractId !== expectedContractId) {
    throw new RangeError('proposal contractId does not match construction context');
  }
  if (
    typeof context.walletAddress !== 'string' ||
    context.walletAddress !== expectedWalletAddress
  ) {
    throw new RangeError('proposal public key does not match construction context wallet');
  }
  if (
    context.governanceType !== 'staged' &&
    context.governanceType !== 'cycle' &&
    context.governanceType !== 'staggered'
  ) {
    throw new RangeError(
      'text-only proposals require reviewed staged, cycle, or staggered governance'
    );
  }
  if (context.policyVersion !== KALVORA_PROPOSAL_POLICY_VERSION) {
    throw new RangeError('proposal construction context policy version is unsupported');
  }
  const observedAt = parseCanonicalTimestamp(
    context.observedAt,
    'constructionContext.observedAt'
  );
  const expiresAt = parseCanonicalTimestamp(
    context.expiresAt,
    'constructionContext.expiresAt'
  );
  if (
    expiresAt <= observedAt ||
    expiresAt - observedAt > MAXIMUM_CONTEXT_VALIDITY_MILLISECONDS ||
    observedAt > validationTimeMilliseconds + CONTEXT_CLOCK_SKEW_MILLISECONDS ||
    expiresAt < validationTimeMilliseconds - CONTEXT_CLOCK_SKEW_MILLISECONDS
  ) {
    throw new RangeError('proposal construction context is stale or has an invalid validity window');
  }
  if (
    !Number.isSafeInteger(context.observedAtHeight) ||
    context.observedAtHeight < 0
  ) {
    throw new RangeError('constructionContext.observedAtHeight must be a non-negative integer');
  }
  if (
    !Array.isArray(context.eligibleProposalInstrumentIds) ||
    context.eligibleProposalInstrumentIds.length === 0 ||
    context.eligibleProposalInstrumentIds.length > MAXIMUM_CONSTRUCTION_INSTRUMENTS
  ) {
    throw new RangeError(
      `constructionContext must contain 1-${MAXIMUM_CONSTRUCTION_INSTRUMENTS} eligible proposal instruments`
    );
  }
  const instruments = context.eligibleProposalInstrumentIds.map((instrumentId, index) =>
    validateContractId(
      instrumentId,
      `constructionContext.eligibleProposalInstrumentIds[${index}]`
    )
  );
  if (new Set(instruments).size !== instruments.length) {
    throw new RangeError('constructionContext eligible proposal instruments must be unique');
  }
}

function parseCanonicalTimestamp(value: unknown, field: string): number {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new RangeError(`${field} must be a canonical ISO timestamp`);
  }
  return Date.parse(value);
}

function validateContractId(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    !isKalvoraMintId(value)
  ) {
    throw new RangeError(`${field} must be a canonical Kalvora mint ID`);
  }
  return value;
}

function validatePublicKeyLength(publicKeyIdentifier: string): void {
  const keyType = getKeyTypeFromPublicKey(publicKeyIdentifier);
  const encoded = getPublicKeyBytes(publicKeyIdentifier);
  const prefixLength = publicKeyIdentifier.lastIndexOf('_') + 1;
  const rawKeyLength = encoded.length - prefixLength;
  const expectedLength = keyType === KEY_TYPE.ED25519 ? 32 : 57;
  if (rawKeyLength !== expectedLength) {
    throw new RangeError(
      `${keyType} public key must contain exactly ${expectedLength} decoded bytes`
    );
  }
}

function validateText(
  value: unknown,
  field: string,
  maximumUtf8Bytes: number,
  allowLineBreaks: boolean
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.normalize('NFC') !== value ||
    !isWellFormedUnicode(value) ||
    /\p{Cf}|\p{Zl}|\p{Zp}/u.test(value) ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    (!allowLineBreaks && /[\t\n\r]/u.test(value)) ||
    new TextEncoder().encode(value).length > maximumUtf8Bytes
  ) {
    throw new RangeError(
      `${field} must be non-empty canonical UTF-8 text of at most ${maximumUtf8Bytes} bytes`
    );
  }
  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function parseNonce(value: string | number | bigint): bigint {
  try {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError('invalid nonce');
    }
    if (
      typeof value === 'string' &&
      (value.length > 20 || !/^(0|[1-9]\d*)$/u.test(value))
    ) {
      throw new RangeError('invalid nonce');
    }
    if (typeof value === 'bigint' && value < 0n) {
      throw new RangeError('invalid nonce');
    }
    return protoInt64.uParse(String(value));
  } catch {
    throw new RangeError('nonce must be an unsigned 64-bit integer');
  }
}

function validatePositiveInteger(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length > MAXIMUM_FEE_INTEGER_DIGITS ||
    !/^[1-9]\d*$/u.test(value) ||
    BigInt(value) > MAXIMUM_UINT256
  ) {
    throw new RangeError(
      `${field} must be a positive unsigned 256-bit integer string`
    );
  }
  return value;
}

function assertUnsignedTextOnlyProposal(proposal: GovernanceProposal): void {
  if (
    proposal.options.length !== 0 ||
    proposal.governanceTxn.length !== 0 ||
    proposal.governanceOptionTxns.length !== 0 ||
    proposal.startTimestamp !== undefined ||
    proposal.endTimestamp !== undefined ||
    proposal.base?.signature !== undefined ||
    proposal.base?.hash !== undefined
  ) {
    throw new Error('proposal builder produced an unsafe or signed proposal shape');
  }
}

/**
 * Build and sign a text-only {@link GovernanceProposal} with a private key.
 *
 * Equivalent to {@link buildTextGovernanceProposalTXN} followed by
 * `signWithKey`. The returned proposal has `base.signature` and `base.hash`
 * set and is ready for {@link sendGovernanceProposalTXN}.
 *
 * @param input - Proposal title, synopsis, body, and target contract
 * @param publicKeyBase58Identifier - Proposer's public key identifier
 * @param privateKeyBase58 - Proposer's private key (matching the public key)
 * @param options - Construction context and fee/nonce options
 * @throws Error on any validation failure from the builder or when signing fails
 */
export async function createTextGovernanceProposalTXN(
  input: TextGovernanceProposalInput,
  publicKeyBase58Identifier: string,
  privateKeyBase58: string,
  options: BuildTextGovernanceProposalTXNOptions
): Promise<GovernanceProposal> {
  if (typeof privateKeyBase58 !== 'string' || privateKeyBase58.trim() === '') {
    throw new Error('privateKey is required');
  }
  const proposal = await buildTextGovernanceProposalTXN(input, publicKeyBase58Identifier, options);
  return signWithKey(proposal, privateKeyBase58, publicKeyBase58Identifier);
}

/**
 * Submit a signed {@link GovernanceProposal} (`TXNService.GovernProposal`).
 *
 * @param proposal - Signed proposal (from {@link createTextGovernanceProposalTXN}
 *   or `signAndFinalize`)
 * @param grpcConfig - Endpoint configuration
 * @returns Hex transaction hash
 * @throws Error when the proposal is unsigned or the network rejects it
 */
export async function sendGovernanceProposalTXN(
  proposal: GovernanceProposal,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  return submitStandardTransaction(proposal, grpcConfig);
}
