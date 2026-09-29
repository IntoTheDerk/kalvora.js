/**
 * Shared Helper Functions for Solana Bridge Transactions
 * 
 * Internal utilities used by transaction builders.
 */

import {
  TransactionInstruction,
  Ed25519Program
} from '@solana/web3.js';
import bs58 from 'bs58';

import type { GuardianSignature } from '../types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const DEFAULT_VAA_VERSION = 1;
export const DEFAULT_VAA_EXPIRY = 0;
export const DEFAULT_EVENT_INDEX = 0;

// Bridge actions
export const ACTION_RELEASE_SOL = 0;
export const ACTION_RELEASE_SPL = 1;
export const ACTION_MINT_WRAPPED = 2;
export const ACTION_MINT_WRAPPED_EXISTING = 3;
export const ACTION_REGISTER_TOKEN = 4;
export const ACTION_RELEASE_2022 = 5;

// ============================================================================
// ED25519 VERIFICATION
// ============================================================================

/**
 * Create Ed25519 signature verification instruction
 * Uses Solana SDK's built-in Ed25519Program to ensure correct instruction format.
 */
export function createEd25519VerifyInstruction(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey,
    message,
    signature
  });
}

// ============================================================================
// SIGNATURE PARSING
// ============================================================================

/**
 * Parse guardian signatures into bytes
 */
export function parseSignatures(signatures: GuardianSignature[]): { sigs: Uint8Array[]; pks: Uint8Array[] } {
  const sigs: Uint8Array[] = [];
  const pks: Uint8Array[] = [];

  for (const { signature, publicKey } of signatures) {
    sigs.push(bs58.decode(signature));
    pks.push(bs58.decode(publicKey));
  }

  return { sigs, pks };
}
