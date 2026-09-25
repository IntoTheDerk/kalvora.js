/**
 * Solana Bridge Utilities
 * 
 * Complete utilities for building Solana bridge transactions.
 * Uses @solana/web3.js for proper Solana primitives.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import {
  TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID as SPL_TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync
} from '@solana/spl-token';
import {
  type Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY
} from '@solana/web3.js';

// Re-export shared byte utilities for convenience
export {
  hexToBytes,
  bytesToHex,
  concatBytes,
  encodeU64LE,
  encodeU64BE,
  encodeU32LE,
  encodeU32BE,
  encodeU16LE,
  encodeU16BE,
  decodeU64LE,
  decodeU64BE,
  decodeU32LE,
  bytesEqual,
  fixedBytes
} from '../../../../shared/utils/byte-utils.js';

import { encodeU32LE } from '../../../../shared/utils/byte-utils.js';

// ============================================================================
// PROGRAM IDs
// ============================================================================

/** Core bridge program ID */
export const CORE_PROGRAM_ID = new PublicKey('zera3giq7oM9QJaD6mY1ajGmakv9TZcax5Giky99HD8');

/** Token bridge program ID */
export const TOKEN_BRIDGE_PROGRAM_ID = new PublicKey('WrapZ8f88HR8waSp7wR8Vgc68z4hKj3p3i2b81oeSxR');

/** Metaplex Token Metadata program ID */
export const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/** BPF Loader Upgradeable program ID */
export const BPF_LOADER_UPGRADEABLE_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

// Re-export standard Solana program IDs
export { SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY };
export const TOKEN_PROGRAM_ID = SPL_TOKEN_PROGRAM_ID;
export const TOKEN_2022_PROGRAM_ID = SPL_TOKEN_2022_PROGRAM_ID;
export const ATA_PROGRAM_ID = ASSOCIATED_TOKEN_PROGRAM_ID;

// ============================================================================
// DISCRIMINATOR GENERATION
// ============================================================================

/**
 * Generate Anchor discriminator for a function
 * Uses SHA256 of the function name and takes first 8 bytes.
 * 
 * @param name - Function name in format "namespace:function_name"
 * @returns 8-byte discriminator
 */
export function generateDiscriminator(name: string): Uint8Array {
  const hash = sha256(new TextEncoder().encode(name));
  return new Uint8Array(hash.slice(0, 8));
}

// ============================================================================
// PDA DERIVATION
// ============================================================================

/**
 * Derive router signer PDA
 */
export function deriveRouterSignerPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('router_signer')],
    TOKEN_BRIDGE_PROGRAM_ID
  );
}

/**
 * Derive Token-2022 router signer PDA
 */
export function deriveRouterSigner2022PDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('router_signer_2022')],
    TOKEN_BRIDGE_PROGRAM_ID
  );
}

/**
 * Derive router config PDA
 */
export function deriveRouterConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('router_cfg')],
    CORE_PROGRAM_ID
  );
}

/**
 * Derive verified transfer marker PDA (core program)
 */
export function deriveVerifiedTransferPDA(expectedHash: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('verified_transfer'), Buffer.from(expectedHash)],
    CORE_PROGRAM_ID
  );
}

/**
 * Derive released transfer marker PDA (token bridge)
 */
export function deriveReleasedTransferPDA(expectedHash: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('released_transfer'), Buffer.from(expectedHash)],
    TOKEN_BRIDGE_PROGRAM_ID
  );
}

/**
 * Derive vault PDA for native SOL
 */
export function deriveVaultPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault')],
    TOKEN_BRIDGE_PROGRAM_ID
  );
}

/**
 * Derive rate limit state PDA
 */
export function deriveRateLimitStatePDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('rate_limit_state')],
    TOKEN_BRIDGE_PROGRAM_ID
  );
}

/**
 * Derive token registration PDA
 */
export function deriveTokenRegistrationPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('token_registration'), mint.toBuffer()],
    TOKEN_BRIDGE_PROGRAM_ID
  );
}

/**
 * Derive Token-2022 extension whitelist PDA
 */
export function deriveExtensionWhitelist2022PDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('extension_whitelist_2022')],
    TOKEN_BRIDGE_PROGRAM_ID
  );
}

/**
 * Derive wrapped mint PDA from Kalvora contract ID
 * 
 * Rust reference: Pubkey::find_program_address(&[b"mint", &contract_id_hash], &*TOKEN_BRIDGE_PROGRAM_ID)
 */
export function deriveWrappedMintPDA(contractId: string): [PublicKey, number] {
  const contractHash = hashContractId(contractId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint'), Buffer.from(contractHash)],
    TOKEN_BRIDGE_PROGRAM_ID
  );
}

/**
 * Derive wrapped mint authority PDA
 * 
 * Rust reference: Pubkey::find_program_address(&[b"mint_authority", wrapped_mint.as_ref()], &*TOKEN_BRIDGE_PROGRAM_ID)
 */
export function deriveWrappedMintAuthorityPDA(wrappedMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), wrappedMint.toBuffer()],
    TOKEN_BRIDGE_PROGRAM_ID
  );
}

/**
 * Derive locked transfer marker PDA
 */
export function deriveLockedTransferPDA(mint: PublicKey, sender: PublicKey, nonce: number): [PublicKey, number] {
  const nonceBytes = Buffer.alloc(8);
  nonceBytes.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddressSync(
    [Buffer.from('locked_transfer'), mint.toBuffer(), sender.toBuffer(), nonceBytes],
    TOKEN_BRIDGE_PROGRAM_ID
  );
}

/**
 * Derive metadata PDA for a mint
 */
export function deriveMetadataPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  );
}

// ============================================================================
// ATA UTILITIES
// ============================================================================

/**
 * Get Associated Token Address
 * 
 * @param owner - Owner of the ATA (can be a PDA, hence allowOwnerOffCurve is true)
 * @param mint - Token mint address
 */
export function getATA(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

/**
 * Get Associated Token Address for a specific token program.
 *
 * Token-2022 ATAs use the same associated token program, but the token
 * program ID is part of the derivation.
 */
export function getATAWithProgramId(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey
): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, tokenProgramId);
}

// ============================================================================
// TOKEN PROGRAM OWNER HELPERS
// ============================================================================

/**
 * Fetch the owner program for a mint account.
 */
export async function getMintAccountOwner(
  connection: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const mintAccount = await connection.getAccountInfo(mint);
  if (!mintAccount) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }

  return mintAccount.owner;
}

/**
 * Assert that a mint is owned by the Token-2022 program when a connection is supplied.
 */
export async function assertToken2022Mint(
  connection: Connection | undefined,
  mint: PublicKey
): Promise<void> {
  if (!connection) {
    return;
  }

  const owner = await getMintAccountOwner(connection, mint);
  if (!owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(
      `Mint ${mint.toBase58()} is owned by ${owner.toBase58()}, expected ${TOKEN_2022_PROGRAM_ID.toBase58()}`
    );
  }
}

// ============================================================================
// BORSH SERIALIZATION
// ============================================================================

/**
 * Encode a string as a Borsh Vec<u8>
 * Format: length (u32 LE) + bytes
 */
export function encodeBorshString(str: string): Uint8Array {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const result = new Uint8Array(4 + bytes.length);
  result.set(encodeU32LE(bytes.length), 0);
  result.set(bytes, 4);
  return result;
}

/**
 * Encode an optional value in Borsh format
 */
export function encodeBorshOption<T>(
  value: T | undefined | null,
  encoder: (v: T) => Uint8Array
): Uint8Array {
  if (value === undefined || value === null) {
    return new Uint8Array([0]); // None
  }
  const encoded = encoder(value);
  const result = new Uint8Array(1 + encoded.length);
  result[0] = 1; // Some
  result.set(encoded, 1);
  return result;
}

// ============================================================================
// HASHING UTILITIES
// ============================================================================

/**
 * Hash contract ID using SHA256 to derive mint PDA seed
 */
export function hashContractId(contractId: string): Uint8Array {
  return sha256(new TextEncoder().encode(contractId));
}

// ============================================================================
// RE-EXPORTS for convenience
// ============================================================================

export { PublicKey } from '@solana/web3.js';
