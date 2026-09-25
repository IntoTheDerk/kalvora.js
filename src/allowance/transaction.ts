/**
 * Transaction Module - AllowanceTXN
 *
 * Builds, signs, and submits Kalvora allowance transactions
 * (`TXNService.Allowance`).
 *
 * An allowance lets the **signer** (the "granter") authorize another wallet
 * (the "spender") to move a capped amount of one token out of the granter's
 * wallet, optionally resetting on a recurring period. The full flow is:
 *
 * 1. **Grant** – the granter signs an `AllowanceTXN` with `authorize: true`
 *    (see {@link createAllowanceTXN}).
 * 2. **Spend** – the spender builds a `CoinTXN` whose first input is the
 *    spender's own `publicKey` (the signer / fee payer, no amount) followed by
 *    one input per granter with `allowanceAddress` set to the granter's
 *    address and the `amount` to pull. Only the spender signs; the granter's
 *    wallet nonce is carried in `TransferAuthentication.allowance_nonce`.
 * 3. **Revoke** – the granter signs an `AllowanceTXN` with `authorize: false`
 *    (see {@link buildRevokeAllowanceTXN}).
 *
 * @module allowance/transaction
 */

import {
  AllowanceTXNSchema,
  type AllowanceTXN
} from '../../proto/generated/txn_pb.js';
import { generateAddressFromPublicKey } from '../shared/crypto/address-utils.js';
import {
  buildStandardTransaction,
  parseAddress,
  parsePartsAmount,
  requireContractId,
  submitStandardTransaction,
  toTimestampInit,
  type StandardTXNOptions
} from '../shared/tx/standard.js';
import { signWithKey } from '../sign/finalize.js';
import type { GRPCConfig } from '../types/index.js';

// ============================================================================
// CURRENCY-EQUIVALENT HELPERS
// ============================================================================

/** Number of decimal places in a Kalvora currency-equivalent value (1e18 = $1.00). */
export const CURRENCY_EQUIVALENT_DECIMALS = 18;

/** `10n ** 18n` — the on-chain representation of $1.00. */
export const CURRENCY_EQUIVALENT_SCALE = 10n ** BigInt(CURRENCY_EQUIVALENT_DECIMALS);

/**
 * Convert a USD decimal string into Kalvora's 1e18-scaled currency-equivalent
 * integer string, using exact integer arithmetic (no floating point).
 *
 * @param usd - Non-negative decimal string with at most 18 fractional digits,
 *   e.g. `'12.50'`, `'0.000001'`, `'100'`. Numbers are rejected on purpose to
 *   avoid binary floating-point rounding.
 * @returns Integer string, e.g. `'12500000000000000000'` for `'12.50'`
 * @throws Error when the input is not a plain non-negative decimal string or
 *   has more than 18 fractional digits
 *
 * @example
 * ```typescript
 * usdToCurrencyEquivalent('12.50'); // '12500000000000000000'
 * usdToCurrencyEquivalent('1');     // '1000000000000000000'
 * ```
 */
export function usdToCurrencyEquivalent(usd: string): string {
  if (typeof usd !== 'string') {
    throw new Error('usd must be a decimal string such as "12.50"');
  }
  const match = /^(\d+)(?:\.(\d*))?$/u.exec(usd.trim());
  if (!match) {
    throw new Error(`usd must be a non-negative decimal string such as "12.50" (got "${usd}")`);
  }
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  if (fraction.length > CURRENCY_EQUIVALENT_DECIMALS) {
    throw new Error(`usd supports at most ${CURRENCY_EQUIVALENT_DECIMALS} decimal places`);
  }
  const scaled = BigInt(whole) * CURRENCY_EQUIVALENT_SCALE
    + BigInt(fraction.padEnd(CURRENCY_EQUIVALENT_DECIMALS, '0') || '0');
  return scaled.toString();
}

/**
 * Convert a 1e18-scaled currency-equivalent integer back into a USD decimal
 * string (trailing zeros trimmed, at least two decimal places).
 *
 * @param value - Integer string / bigint / safe integer, e.g. `'12500000000000000000'`
 * @returns Decimal string, e.g. `'12.50'`
 * @throws Error when the value is not a non-negative integer
 *
 * @example
 * ```typescript
 * currencyEquivalentToUsd('12500000000000000000'); // '12.50'
 * ```
 */
export function currencyEquivalentToUsd(value: string | bigint | number): string {
  const scaled = BigInt(parsePartsAmount(value, 'currencyEquivalent', true));
  const whole = scaled / CURRENCY_EQUIVALENT_SCALE;
  let fraction = (scaled % CURRENCY_EQUIVALENT_SCALE)
    .toString()
    .padStart(CURRENCY_EQUIVALENT_DECIMALS, '0')
    .replace(/0+$/u, '');
  if (fraction.length < 2) fraction = fraction.padEnd(2, '0');
  return `${whole.toString()}.${fraction}`;
}

// ============================================================================
// TYPES
// ============================================================================

/** Maximum value of a protobuf `uint32`. */
const UINT32_MAX = 4_294_967_295;

/**
 * Input for {@link buildAllowanceTXN}.
 *
 * Mutually-exclusive groups (mirroring `proto/txn.proto`):
 * - **Cap**: exactly one of `allowedAmount` / `allowedCurrencyEquivalent`
 *   when authorizing (at most one when de-authorizing).
 * - **Reset period**: at most one of `periodMonths` / `periodSeconds`.
 *   Omit both for a one-off (non-resetting) allowance.
 */
export interface AllowanceInput {
  /** Granter's (signer's) base58 public key identifier, e.g. `A_AKpo…`. */
  publicKey: string;
  /** Token the spender may move out of the granter's wallet, e.g. `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao`. */
  contractId: string;
  /** Spender's base58 wallet address (the wallet being (de-)authorized). */
  walletAddress: string;
  /**
   * `true` (default) grants / replaces the allowance; `false` revokes it.
   */
  authorize?: boolean;
  /**
   * Cap in the token's smallest units ("parts"), as an integer string,
   * bigint, or safe integer. Mutually exclusive with `allowedCurrencyEquivalent`.
   */
  allowedAmount?: string | bigint | number;
  /**
   * Cap expressed in currency equivalent, scaled so `1e18` = $1.00, as an
   * integer string / bigint. Use {@link usdToCurrencyEquivalent} to convert
   * `'12.50'`. Mutually exclusive with `allowedAmount`.
   */
  allowedCurrencyEquivalent?: string | bigint | number;
  /** Reset the used amount every N calendar months (uint32, > 0). */
  periodMonths?: number;
  /** Reset the used amount every N seconds (uint32, > 0). */
  periodSeconds?: number;
  /**
   * When the allowance (and its first period) starts. Required when
   * authorizing. When de-authorizing it defaults to `options.timestamp`
   * (or now), since the proto field is always serialized.
   */
  startTime?: Date;
}

/** Input for {@link buildRevokeAllowanceTXN}. */
export interface RevokeAllowanceInput {
  /** Granter's (signer's) base58 public key identifier. */
  publicKey: string;
  /** Token whose allowance is revoked. */
  contractId: string;
  /** Spender's base58 wallet address. */
  walletAddress: string;
  /** Optional start time; defaults to `options.timestamp` or now. */
  startTime?: Date;
}

// ============================================================================
// VALIDATION
// ============================================================================

function parsePeriod(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > UINT32_MAX) {
    throw new Error(`${field} must be a positive integer no greater than ${UINT32_MAX}`);
  }
  return value;
}

function buildAllowanceFields(input: AllowanceInput, options: StandardTXNOptions): {
  contractId: string;
  walletAddress: Uint8Array;
  allowedAmount?: string;
  allowedCurrencyEquivalent?: string;
  periodMonths?: number;
  periodSeconds?: number;
  startTime: { seconds: bigint; nanos: number };
  authorize: boolean;
} {
  if (input === null || typeof input !== 'object') {
    throw new Error('AllowanceTXN input must be an object');
  }
  const contractId = requireContractId(input.contractId, 'contractId');
  const walletAddress = parseAddress(input.walletAddress, 'walletAddress');

  if (input.authorize !== undefined && typeof input.authorize !== 'boolean') {
    throw new Error('authorize must be a boolean');
  }
  const authorize = input.authorize ?? true;

  if (typeof input.publicKey === 'string' && input.publicKey.includes('_')) {
    let signerAddress: string | undefined;
    try {
      signerAddress = generateAddressFromPublicKey(input.publicKey);
    } catch {
      signerAddress = undefined;
    }
    if (signerAddress !== undefined && signerAddress === input.walletAddress.trim()) {
      throw new Error('walletAddress must differ from the signer: a wallet cannot grant an allowance to itself');
    }
  }

  const hasAmount = input.allowedAmount !== undefined;
  const hasCurrency = input.allowedCurrencyEquivalent !== undefined;
  if (hasAmount && hasCurrency) {
    throw new Error('Provide only one of allowedAmount or allowedCurrencyEquivalent, not both');
  }
  if (authorize && !hasAmount && !hasCurrency) {
    throw new Error('Authorizing an allowance requires exactly one of allowedAmount or allowedCurrencyEquivalent');
  }

  if (input.periodMonths !== undefined && input.periodSeconds !== undefined) {
    throw new Error('Provide only one of periodMonths or periodSeconds, not both');
  }

  let startDate = input.startTime;
  if (startDate === undefined) {
    if (authorize) {
      throw new Error('startTime is required when authorizing an allowance');
    }
    startDate = options.timestamp ?? new Date();
  }

  return {
    contractId,
    walletAddress,
    ...(hasAmount ? { allowedAmount: parsePartsAmount(input.allowedAmount, 'allowedAmount') } : {}),
    ...(hasCurrency
      ? { allowedCurrencyEquivalent: parsePartsAmount(input.allowedCurrencyEquivalent, 'allowedCurrencyEquivalent') }
      : {}),
    ...(input.periodMonths !== undefined ? { periodMonths: parsePeriod(input.periodMonths, 'periodMonths') } : {}),
    ...(input.periodSeconds !== undefined ? { periodSeconds: parsePeriod(input.periodSeconds, 'periodSeconds') } : {}),
    startTime: toTimestampInit(startDate, 'startTime'),
    authorize
  };
}

// ============================================================================
// BUILD / CREATE / SEND
// ============================================================================

/**
 * Build an **unsigned** `AllowanceTXN`.
 *
 * On-chain semantics: the signer (granter) authorizes — or, with
 * `authorize: false`, de-authorizes — `walletAddress` (the spender) to move up
 * to the cap of `contractId` out of the granter's wallet. The cap is either a
 * token amount in parts or a USD-equivalent value (1e18 = $1.00). If a reset
 * period is set, the used amount resets every `periodMonths` months or
 * `periodSeconds` seconds, counted from `startTime`. The spender consumes the
 * allowance by building a `CoinTXN` with an input whose `allowanceAddress` is
 * the granter's address.
 *
 * The base fee is looked up for `contractId`. Pass `options.nonce` and
 * `options.feeAmountParts` for fully offline, deterministic construction.
 *
 * @param input - Allowance fields (see {@link AllowanceInput})
 * @param options - Shared builder options (nonce, fee, memo, timestamp, …)
 * @returns Unsigned `zera_txn.AllowanceTXN`
 * @throws Error on invalid contract ID / address, both cap kinds given, no cap
 *   when authorizing, both period kinds given, non-positive or out-of-range
 *   period, missing `startTime` when authorizing, self-allowance, or
 *   network failures during nonce/fee lookup
 *
 * @example
 * ```typescript
 * // Let Bob spend up to $250.00 of KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao from Alice's wallet, per month.
 * const txn = await buildAllowanceTXN({
 *   publicKey: alice.publicKey,
 *   contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
 *   walletAddress: bob.address,
 *   allowedCurrencyEquivalent: usdToCurrencyEquivalent('250.00'),
 *   periodMonths: 1,
 *   startTime: new Date()
 * });
 * ```
 */
export async function buildAllowanceTXN(
  input: AllowanceInput,
  options: StandardTXNOptions = {}
): Promise<AllowanceTXN> {
  const fields = buildAllowanceFields(input, options);
  return buildStandardTransaction({
    operation: 'buildAllowanceTXN',
    schema: AllowanceTXNSchema,
    publicKeyId: input.publicKey,
    contractId: fields.contractId,
    fields,
    options
  });
}

/**
 * Build and sign an `AllowanceTXN` with the granter's private key.
 *
 * @param input - Allowance fields (see {@link AllowanceInput})
 * @param privateKey - Granter's base58 private key (must match `input.publicKey`)
 * @param options - Shared builder options
 * @returns Signed transaction with `base.signature` and `base.hash` populated
 * @throws Error when `privateKey` is empty, plus everything {@link buildAllowanceTXN} throws
 *
 * @example
 * ```typescript
 * const txn = await createAllowanceTXN({
 *   publicKey: alice.publicKey,
 *   contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
 *   walletAddress: bob.address,
 *   allowedAmount: '5000000000', // parts
 *   startTime: new Date()
 * }, alice.privateKey);
 * const hash = await sendAllowanceTXN(txn);
 * ```
 */
export async function createAllowanceTXN(
  input: AllowanceInput,
  privateKey: string,
  options: StandardTXNOptions = {}
): Promise<AllowanceTXN> {
  if (typeof privateKey !== 'string' || privateKey === '') {
    throw new Error('privateKey is required');
  }
  const txn = await buildAllowanceTXN(input, options);
  return signWithKey(txn, privateKey, input.publicKey);
}

/**
 * Build an **unsigned** `AllowanceTXN` that revokes (`authorize: false`) a
 * previously granted allowance. No cap or period is sent.
 *
 * @param input - Granter public key, token, and spender address
 * @param options - Shared builder options
 * @returns Unsigned `zera_txn.AllowanceTXN` with `authorize === false`
 * @throws Error on invalid contract ID / address or network failures
 *
 * @example
 * ```typescript
 * const txn = await buildRevokeAllowanceTXN({
 *   publicKey: alice.publicKey,
 *   contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
 *   walletAddress: bob.address
 * });
 * ```
 */
export async function buildRevokeAllowanceTXN(
  input: RevokeAllowanceInput,
  options: StandardTXNOptions = {}
): Promise<AllowanceTXN> {
  return buildAllowanceTXN({ ...input, authorize: false }, options);
}

/**
 * Build and sign an allowance revocation (see {@link buildRevokeAllowanceTXN}).
 *
 * @param input - Granter public key, token, and spender address
 * @param privateKey - Granter's base58 private key
 * @param options - Shared builder options
 * @returns Signed revocation transaction
 * @throws Error when `privateKey` is empty or building fails
 *
 * @example
 * ```typescript
 * const txn = await createRevokeAllowanceTXN(
 *   { publicKey: alice.publicKey, contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', walletAddress: bob.address },
 *   alice.privateKey
 * );
 * await sendAllowanceTXN(txn);
 * ```
 */
export async function createRevokeAllowanceTXN(
  input: RevokeAllowanceInput,
  privateKey: string,
  options: StandardTXNOptions = {}
): Promise<AllowanceTXN> {
  return createAllowanceTXN({ ...input, authorize: false }, privateKey, options);
}

/**
 * Submit a signed `AllowanceTXN` via `TXNService.Allowance`.
 *
 * @param txn - Signed transaction from {@link createAllowanceTXN} (or an
 *   externally signed {@link buildAllowanceTXN} result)
 * @param grpcConfig - Endpoint configuration
 * @returns Hex transaction hash
 * @throws Error when the transaction is unsigned or the network rejects it
 *
 * @example
 * ```typescript
 * const hash = await sendAllowanceTXN(signedTxn); // defaults to the SDK endpoint
 * ```
 */
export async function sendAllowanceTXN(
  txn: AllowanceTXN,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  return submitStandardTransaction(txn, grpcConfig);
}
