/**
 * Kalvora network identifiers and protocol-level identifier validation.
 *
 * Kalvora stores token and contract references as mint IDs. Native/local mint
 * IDs are plain bounded identifiers; bridge instruments may retain the
 * `$sol-ASSET+VERSION` form used by the Kalvora bridge APIs.
 */

/**
 * Mint ID of the native Kalvora token (symbol `KALV`, name `Kalvora`).
 *
 * Kalvora contract IDs are hash-derived (`KAL` + base58 digest, found with
 * `InstrumentContract.vanity_nonce`). The native token has 9 decimals
 * (denomination `1000000000`, smallest unit "kalv"), is the default base-fee
 * instrument for every builder, and is exempt from the non-native fee
 * multiplier.
 *
 * The pre-release placeholder `KAL111112` is rejected by the network as a
 * malformed contract ID.
 */
export const KALVORA_NATIVE_TOKEN = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' as const;
/** Chain identifier of Kalvora protonet (used in WalletConnect and proposal contexts). */
export const KALVORA_PROTONET_NETWORK = 'kalvora:protonet' as const;

/** Maximum UTF-8 byte length of a mint ID accepted by the API. */
export const KALVORA_MINT_ID_MAX_BYTES = 512 as const;

const KALVORA_MINT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/u;
const KALVORA_BRIDGED_MINT_ID_PATTERN = /^\$[A-Za-z0-9]+-[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)?$/u;
const UTF8_ENCODER = new TextEncoder();

/**
 * Validate the bounded, printable mint-ID form accepted by this SDK.
 *
 * The network owns the final semantic validation. The SDK only rejects
 * values that cannot safely be sent as canonical identifiers or exceed the
 * API's documented 512-byte bound.
 */
export function isKalvoraMintId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    return false;
  }

  if (UTF8_ENCODER.encode(value).length > KALVORA_MINT_ID_MAX_BYTES) {
    return false;
  }

  return (
    KALVORA_MINT_ID_PATTERN.test(value) ||
    KALVORA_BRIDGED_MINT_ID_PATTERN.test(value)
  );
}

export const KALVORA_MINT_ID_ERROR =
  `a Kalvora mint ID (1-${KALVORA_MINT_ID_MAX_BYTES} bytes, using a local identifier or supported bridged form)`;
