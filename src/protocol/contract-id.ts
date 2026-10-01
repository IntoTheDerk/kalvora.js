/**
 * Kalvora contract ID derivation and checksum validation.
 *
 * Ordinary and genesis IDs are BLAKE3-256 digests with a 4-byte BLAKE3
 * checksum, displayed as canonical Bitcoin Base58. Wallet addresses are a
 * different encoding and must not be passed through these helpers.
 *
 * The published genesis nonces and IDs match `z_validator/headers/const.h`.
 */

import { blake3 } from '@noble/hashes/blake3.js';
import bs58 from 'bs58';

const TEXT = new TextEncoder();

const DOMAIN_CONTRACT_DATA = 'KALVORA_CONTRACT_DATA_V1';
const DOMAIN_ORDINARY_ID = 'KALVORA_CONTRACT_ID_V1';
const DOMAIN_GENESIS_ID = 'KALVORA_NATIVE_TOKEN_ID_V1';
const DOMAIN_CHECKSUM = 'KALVORA_CONTRACT_ID_CHECKSUM_V1';
const NETWORK_ID = 'KALVORA_MAINNET_V1';

/** Creator authorization values written into an ordinary contract-ID preimage. */
export const CREATOR_AUTHORIZATION = {
  SINGLE_KEY: 1,
  SMART_CONTRACT: 2,
  GOVERNANCE: 3
} as const;

/** Single-key algorithm values written into an ordinary contract-ID preimage. */
export const CREATOR_KEY_ALGORITHM = {
  NONE: 0,
  ED25519: 1,
  ED448: 2
} as const;

/** Published block-zero vanity nonces. The nonce is not `BaseTXN.nonce`. */
export const GENESIS_CONTRACT_NONCES = {
  KALV: 3897197n,
  PREGOV: 136376n,
  KIP: 41972n,
  LEGAL: 423443n,
  MINT: 28203188n,
  TREASURY: 950374n,
  TECH: 224805n,
  MARKETING: 137046n,
  BRIDGETOKENS: 567379n,
  BRIDGEGUARDIANS: 31229n,
  SMARTCONTRACTMAINTENANCE: 3667423n
} as const;

/**
 * Published block-zero contract IDs. `KALV` is the native token
 * (`KALVORA_NATIVE_TOKEN`).
 */
export const GENESIS_CONTRACT_IDS = {
  KALV: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  PREGOV: 'PREDNmAbR9Juj233WUQ6kqFGf28oe5kVAK5Y3mhGfE6cVBF95',
  KIP: 'K1PoaARovFYFLAqWRoXubXBkJ2dSynjzUyRzsBc3ycbGEn9pK',
  LEGAL: 'LEGWZ2q8Dw1B8Z9r61STBkaFLPMfDYQPQXFEzJzmQEdyw9tg5',
  MINT: 'M1NTxB3N3GeM5CZLHj3bDLtuye15VQxTTJ3omn9g9Ti87o9b3',
  TREASURY: 'TREF2UL7Ut6JDTcAaGfY32UrQv9aC5MVyyDjNbFKjhAq51cet',
  TECH: 'TECfnGgEykEs1G57P43ABBb6i73LgwAbHLPf46z1kGyY9A7PY',
  MARKETING: 'MARYCY87a7ZdeYERoCJbwFv8r6Sm69zjKEspEEo91kcDGH3ce',
  BRIDGETOKENS: 'BRT3zKHfF8RgqbaYGTrv58j3LpNUr5EAJBVn63sBfpTE7AfFk',
  BRIDGEGUARDIANS: 'BRGhGqDbqLMqYNRdCSbBVujfQurhW5x3AkQQPnUUCe5Ctb5ua',
  SMARTCONTRACTMAINTENANCE: 'SCMgkjeFFnHPR7rr6AGqBp1FTm7YK67GiJrLcU159QeZxGk6d'
} as const;

/**
 * Digest of the live KALV genesis ID (vanity nonce 3897197).
 * An older vector file used nonce 142654458 and digest
 * `293c97ebd9e742a9baa56d34019425c97cb59b320ad551337b29c7bfee0a721f`
 * for a different ID (`KALVErY7…`). The ID in `const.h` is the one protonet serves.
 */
export const KALV_CONTRACT_DIGEST = '293c99f95a01eefa51877a22ad9985fb8ac3f498b7ebeec1a0a3ce49a2bda449';

export interface ContractDataInput {
  symbol: string;
  /** `CONTRACT_TYPE` enum value, encoded as a big-endian u32. */
  type: number;
  maxSupply?: string;
  coinDenomination?: { denominationName: string; amount: string };
  maxSupplyRelease?: { seconds: bigint | number; nanos: number; amount: string }[];
}

export interface OrdinaryContractIdInput {
  creatorAuthorizationType: number;
  creatorKeyAlgorithm: number;
  /** Exact bytes stored in `base.public_key` for the creator. */
  creatorAuthorizationBytes: Uint8Array;
  vanityNonce: bigint | number;
  contractDataHash: Uint8Array;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u8(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError('u8 out of range');
  }
  return Uint8Array.of(value);
}

function u32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError('u32 out of range');
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function u64(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new RangeError('u64 out of range');
  }
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, Number(value >> 32n), false);
  view.setUint32(4, Number(value & 0xffffffffn), false);
  return out;
}

function lengthPrefixed(bytes: Uint8Array): Uint8Array {
  return concat([u32(bytes.length), bytes]);
}

function prefixedString(value: string): Uint8Array {
  return lengthPrefixed(TEXT.encode(value));
}

/** Strip leading zeros. Zero is the single character `0`. */
export function canonicalDecimal(value: string): string {
  if (!/^\d+$/u.test(value)) {
    throw new Error('decimal amounts must contain only ASCII digits');
  }
  const stripped = value.replace(/^0+/u, '');
  return stripped === '' ? '0' : stripped;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** BLAKE3-256 of the immutable fields that commit an ordinary contract ID. */
export function deriveContractDataHash(input: ContractDataInput): Uint8Array {
  const parts: Uint8Array[] = [
    prefixedString(DOMAIN_CONTRACT_DATA),
    prefixedString(input.symbol),
    u32(input.type)
  ];
  if (input.maxSupply !== undefined) {
    parts.push(u8(1), prefixedString(canonicalDecimal(input.maxSupply)));
  } else {
    parts.push(u8(0));
  }
  if (input.coinDenomination !== undefined) {
    parts.push(
      u8(1),
      prefixedString(input.coinDenomination.denominationName),
      prefixedString(canonicalDecimal(input.coinDenomination.amount))
    );
  } else {
    parts.push(u8(0));
  }
  const releases = input.maxSupplyRelease ?? [];
  parts.push(u32(releases.length));
  for (const entry of releases) {
    parts.push(
      u64(BigInt(entry.seconds)),
      u32(entry.nanos),
      prefixedString(canonicalDecimal(entry.amount))
    );
  }
  return blake3(concat(parts));
}

/** Four-byte checksum of a 32-byte contract digest. */
export function contractIdChecksum(digest: Uint8Array): Uint8Array {
  if (digest.length !== 32) {
    throw new Error('contract digest must be 32 bytes');
  }
  const full = blake3(concat([prefixedString(DOMAIN_CHECKSUM), lengthPrefixed(digest)]));
  return full.subarray(0, 4);
}

/** Base58(digest || checksum). The digest is not prefixed with a version byte. */
export function encodeContractId(digest: Uint8Array): string {
  return bs58.encode(concat([digest, contractIdChecksum(digest)]));
}

/** Genesis ID for a published or searched vanity nonce. No creator and no contract data. */
export function deriveGenesisContractId(vanityNonce: bigint | number): string {
  const digest = blake3(concat([
    prefixedString(DOMAIN_GENESIS_ID),
    prefixedString(NETWORK_ID),
    u64(BigInt(vanityNonce))
  ]));
  return encodeContractId(digest);
}

/** Ordinary ID from creator authorization, vanity nonce, and the contract-data hash. */
export function deriveOrdinaryContractId(input: OrdinaryContractIdInput): string {
  if (input.contractDataHash.length !== 32) {
    throw new Error('contractDataHash must be 32 bytes');
  }
  const digest = blake3(concat([
    prefixedString(DOMAIN_ORDINARY_ID),
    prefixedString(NETWORK_ID),
    u8(input.creatorAuthorizationType),
    u8(input.creatorKeyAlgorithm),
    lengthPrefixed(input.creatorAuthorizationBytes),
    u64(BigInt(input.vanityNonce)),
    lengthPrefixed(input.contractDataHash)
  ]));
  return encodeContractId(digest);
}

/**
 * Strict Base58 decode, 36-byte length, and checksum comparison.
 * Does not re-derive the digest (that requires the contract or a genesis nonce).
 */
export function isCanonicalContractId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    return false;
  }
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(value);
  } catch {
    return false;
  }
  if (decoded.length !== 36 || bs58.encode(decoded) !== value) {
    return false;
  }
  const digest = decoded.subarray(0, 32);
  const checksum = decoded.subarray(32);
  const expected = contractIdChecksum(digest);
  return checksum[0] === expected[0]
    && checksum[1] === expected[1]
    && checksum[2] === expected[2]
    && checksum[3] === expected[3];
}

/** Digest and checksum of a canonical contract ID, or `undefined` when invalid. */
export function decodeContractId(value: string): { digest: Uint8Array; checksum: Uint8Array } | undefined {
  if (!isCanonicalContractId(value)) return undefined;
  const decoded = bs58.decode(value);
  return { digest: decoded.subarray(0, 32), checksum: decoded.subarray(32) };
}

/** Hex form of the KALV digest, used by the derivation test. */
export function kalvDigestHex(vanityNonce: bigint | number = GENESIS_CONTRACT_NONCES.KALV): string {
  const digest = blake3(concat([
    prefixedString(DOMAIN_GENESIS_ID),
    prefixedString(NETWORK_ID),
    u64(BigInt(vanityNonce))
  ]));
  return bytesToHex(digest);
}
