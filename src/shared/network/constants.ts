/**
 * Kalvora network identifiers and protocol-level identifier validation.
 *
 * Native and user contract IDs are canonical Base58 digests with a 4-byte
 * checksum (see `protocol/contract-id`). Bridge instruments may retain the
 * `$sol-ASSET+VERSION` form used by the Kalvora bridge APIs.
 */

import { isCanonicalContractId } from '../../protocol/contract-id.js';

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

const KALVORA_BRIDGED_MINT_ID_PATTERN = /^\$[A-Za-z0-9]+-[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)?$/u;
const UTF8_ENCODER = new TextEncoder();

/**
 * Validate a contract ID the network will accept.
 *
 * Canonical IDs must Base58-decode to 36 bytes and carry a matching BLAKE3
 * checksum. Bridged `$chain-SYMBOL+VERSION` IDs are accepted as a separate
 * form. Placeholder IDs such as `KAL111112` are rejected.
 */
export function isKalvoraMintId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    return false;
  }

  if (UTF8_ENCODER.encode(value).length > KALVORA_MINT_ID_MAX_BYTES) {
    return false;
  }

  return isCanonicalContractId(value) || KALVORA_BRIDGED_MINT_ID_PATTERN.test(value);
}

export const KALVORA_MINT_ID_ERROR =
  'a Kalvora mint ID (canonical Base58 contract ID with a valid checksum, or a supported bridged form)';
