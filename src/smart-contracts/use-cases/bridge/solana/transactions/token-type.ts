/**
 * Token-type routed Solana transaction builders.
 *
 * These helpers keep the explicit SOL, SPL, and Token-2022 builders available
 * while giving callers one entrypoint when they already know the asset type.
 */

import type { Connection, PublicKey } from '@solana/web3.js';

import { SolanaTokenType } from '../constants.js';
import type { LockSolanaOptions, ReleaseSolanaOptions } from '../types.js';

import {
  buildLockSolTransaction,
  buildLockSplTransaction,
  buildLockToken2022Transaction,
  type LockSolResult,
  type LockSplResult,
  type LockToken2022Result
} from './lock.js';
import {
  buildReleaseSolTransaction,
  buildReleaseSplTransaction,
  buildReleaseToken2022Transaction,
  type ReleaseSolResult,
  type ReleaseSplResult,
  type ReleaseToken2022Result
} from './release.js';

export type LockSolanaTransactionResult =
  | (LockSolResult & { tokenType: typeof SolanaTokenType.SOL })
  | (LockSplResult & { tokenType: typeof SolanaTokenType.SPL })
  | (LockToken2022Result & { tokenType: typeof SolanaTokenType.TOKEN2022 });

export type ReleaseSolanaTransactionResult =
  | (ReleaseSolResult & { tokenType: typeof SolanaTokenType.SOL })
  | (ReleaseSplResult & { tokenType: typeof SolanaTokenType.SPL })
  | (ReleaseToken2022Result & { tokenType: typeof SolanaTokenType.TOKEN2022 });

/**
 * Build a Solana -> Kalvora lock transaction by explicit asset type.
 */
export async function buildLockSolanaTransaction(
  options: LockSolanaOptions,
  payer: PublicKey,
  connection?: Connection
): Promise<LockSolanaTransactionResult> {
  switch (options.tokenType) {
  case SolanaTokenType.SOL: {
    const result = await buildLockSolTransaction(options, payer, connection);
    return { ...result, tokenType: options.tokenType };
  }
  case SolanaTokenType.SPL: {
    const result = await buildLockSplTransaction(options, payer, connection);
    return { ...result, tokenType: options.tokenType };
  }
  case SolanaTokenType.TOKEN2022: {
    const result = await buildLockToken2022Transaction(options, payer, connection);
    return { ...result, tokenType: options.tokenType };
  }
  default:
    return assertUnsupportedTokenType(options);
  }
}

/**
 * Build a Kalvora -> Solana release transaction by explicit asset type.
 */
export async function buildReleaseSolanaTransaction(
  options: ReleaseSolanaOptions,
  payer: PublicKey,
  connection?: Connection
): Promise<ReleaseSolanaTransactionResult> {
  switch (options.tokenType) {
  case SolanaTokenType.SOL: {
    const result = await buildReleaseSolTransaction(options, payer, connection);
    return { ...result, tokenType: options.tokenType };
  }
  case SolanaTokenType.SPL: {
    const result = await buildReleaseSplTransaction(options, payer, connection);
    return { ...result, tokenType: options.tokenType };
  }
  case SolanaTokenType.TOKEN2022: {
    const result = await buildReleaseToken2022Transaction(options, payer, connection);
    return { ...result, tokenType: options.tokenType };
  }
  default:
    return assertUnsupportedTokenType(options);
  }
}

function assertUnsupportedTokenType(value: never): never {
  throw new Error(`Unsupported Solana token type: ${String(value)}`);
}
