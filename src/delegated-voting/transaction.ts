/**
 * Transaction Module - DelegatedTXN (delegated voting)
 *
 * Builds, signs, and submits Kalvora delegated-voting transactions
 * (`TXNService.DelegatedVoting`).
 *
 * A `DelegatedTXN` lets the signer (the "delegator") hand its governance
 * voting power to one or more delegate wallets, per voting contract, with a
 * priority for each (delegate, contract) pair. It can also carry
 * `DelegateFees` entries that pre-authorize how much of a fee token the
 * delegator is willing to spend on fees incurred on its behalf by delegates.
 *
 * @module delegated-voting/transaction
 */

import {
  DelegatedTXNSchema,
  type DelegatedTXN
} from '../../proto/generated/txn_pb.js';
import { generateAddressFromPublicKey } from '../shared/crypto/address-utils.js';
import {
  buildStandardTransaction,
  parseAddress,
  parsePartsAmount,
  requireContractId,
  submitStandardTransaction,
  type StandardTXNOptions
} from '../shared/tx/standard.js';
import { signWithKey } from '../sign/finalize.js';
import type { GRPCConfig } from '../types/index.js';

// ============================================================================
// TYPES
// ============================================================================

/** Smallest protobuf `int32`. */
export const DELEGATE_PRIORITY_MIN = -2_147_483_648;
/** Largest protobuf `int32`. */
export const DELEGATE_PRIORITY_MAX = 2_147_483_647;

/** One voting contract delegated to a delegate (`zera_txn.DelegateContract`). */
export interface DelegateContractInput {
  /** Contract whose governance votes are delegated, e.g. `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao`. */
  contractId: string;
  /**
   * Priority of this delegate for `contractId` (protobuf `int32`). When
   * several delegates are configured for the same contract, validators use
   * the priority to decide whose vote counts; the validator stores it as a
   * `uint32`, so prefer non-negative values.
   */
  priority: number;
}

/** One delegate wallet and the contracts delegated to it (`zera_txn.DelegateVote`). */
export interface DelegateVoteInput {
  /** Delegate's base58 wallet address. */
  address: string;
  /** Contracts delegated to this wallet (non-empty, unique `contractId`s). */
  contracts: DelegateContractInput[];
}

/** Fee pre-authorization (`zera_txn.DelegateFees`). */
export interface DelegateFeesInput {
  /** Fee token the authorization applies to, e.g. `KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao`. */
  contractId: string;
  /**
   * Maximum amount of `contractId`, in smallest units ("parts"), the delegator
   * authorizes for fees incurred on its behalf through delegation.
   */
  authAmount: string | bigint | number;
}

/** Input for {@link buildDelegatedTXN}. */
export interface DelegatedInput {
  /** Delegator's (signer's) base58 public key identifier, e.g. `A_AKpo…`. */
  publicKey: string;
  /** Delegates and their contracts. Must contain at least one entry. */
  delegateVotes: DelegateVoteInput[];
  /** Optional fee pre-authorizations (unique `contractId`s). */
  delegateFees?: DelegateFeesInput[];
}

// ============================================================================
// VALIDATION
// ============================================================================

function parsePriority(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < DELEGATE_PRIORITY_MIN ||
    value > DELEGATE_PRIORITY_MAX
  ) {
    throw new Error(
      `${field} must be an integer between ${DELEGATE_PRIORITY_MIN} and ${DELEGATE_PRIORITY_MAX} (int32)`
    );
  }
  return value;
}

function signerAddressOf(publicKey: unknown): string | undefined {
  if (typeof publicKey !== 'string' || !publicKey.includes('_')) return undefined;
  try {
    return generateAddressFromPublicKey(publicKey);
  } catch {
    return undefined;
  }
}

function buildDelegatedFields(input: DelegatedInput): {
  delegateVotes: { address: Uint8Array; contracts: { contractId: string; priority: number }[] }[];
  delegateFees: { contractId: string; authAmount: string }[];
} {
  if (input === null || typeof input !== 'object') {
    throw new Error('DelegatedTXN input must be an object');
  }
  if (!Array.isArray(input.delegateVotes) || input.delegateVotes.length === 0) {
    throw new Error('delegateVotes must be a non-empty array');
  }

  const signerAddress = signerAddressOf(input.publicKey);
  const seenDelegates = new Set<string>();

  const delegateVotes = input.delegateVotes.map((vote, i) => {
    const field = `delegateVotes[${i}]`;
    if (vote === null || typeof vote !== 'object') {
      throw new Error(`${field} must be an object`);
    }
    const address = parseAddress(vote.address, `${field}.address`);
    const normalized = vote.address.trim();
    if (signerAddress !== undefined && normalized === signerAddress) {
      throw new Error(`${field}.address must differ from the signer: a wallet cannot delegate to itself`);
    }
    if (seenDelegates.has(normalized)) {
      throw new Error(`${field}.address duplicates an earlier delegate; merge its contracts into one entry`);
    }
    seenDelegates.add(normalized);

    if (!Array.isArray(vote.contracts) || vote.contracts.length === 0) {
      throw new Error(`${field}.contracts must be a non-empty array`);
    }
    const seenContracts = new Set<string>();
    const contracts = vote.contracts.map((contract, j) => {
      const cField = `${field}.contracts[${j}]`;
      if (contract === null || typeof contract !== 'object') {
        throw new Error(`${cField} must be an object`);
      }
      const contractId = requireContractId(contract.contractId, `${cField}.contractId`);
      if (seenContracts.has(contractId)) {
        throw new Error(`${cField}.contractId "${contractId}" is listed more than once for the same delegate`);
      }
      seenContracts.add(contractId);
      return { contractId, priority: parsePriority(contract.priority, `${cField}.priority`) };
    });
    return { address, contracts };
  });

  if (input.delegateFees !== undefined && !Array.isArray(input.delegateFees)) {
    throw new Error('delegateFees must be an array when provided');
  }
  const seenFeeContracts = new Set<string>();
  const delegateFees = (input.delegateFees ?? []).map((fee, i) => {
    const field = `delegateFees[${i}]`;
    if (fee === null || typeof fee !== 'object') {
      throw new Error(`${field} must be an object`);
    }
    const contractId = requireContractId(fee.contractId, `${field}.contractId`);
    if (seenFeeContracts.has(contractId)) {
      throw new Error(`${field}.contractId "${contractId}" is listed more than once`);
    }
    seenFeeContracts.add(contractId);
    return { contractId, authAmount: parsePartsAmount(fee.authAmount, `${field}.authAmount`) };
  });

  return { delegateVotes, delegateFees };
}

// ============================================================================
// BUILD / CREATE / SEND
// ============================================================================

/**
 * Build an **unsigned** `DelegatedTXN`.
 *
 * On-chain semantics: for every `delegateVotes[i]`, the signer delegates its
 * governance voting power in each listed contract to `address`, ranked by
 * `priority`. Optional `delegateFees` entries authorize up to `authAmount`
 * parts of each fee token for fees incurred through delegation.
 *
 * `DelegatedTXN` is not bound to a single contract, so the base-fee lookup
 * uses no contract ID. Pass `options.nonce` and `options.feeAmountParts` for
 * fully offline, deterministic construction.
 *
 * @param input - Delegator public key, delegates, and optional fee authorizations
 * @param options - Shared builder options (nonce, fee, memo, timestamp, …)
 * @returns Unsigned `zera_txn.DelegatedTXN`
 * @throws Error when `delegateVotes` (or any delegate's `contracts`) is empty,
 *   a delegate address is invalid, duplicated, or equals the signer, a
 *   contract ID is invalid or repeated within one delegate, a priority is
 *   outside the int32 range, a fee entry is invalid/duplicated/zero, or the
 *   nonce/fee network lookup fails
 *
 * @example
 * ```typescript
 * const txn = await buildDelegatedTXN({
 *   publicKey: alice.publicKey,
 *   delegateVotes: [
 *     { address: bob.address, contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 1 }] },
 *     { address: charlie.address, contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 2 }] }
 *   ],
 *   delegateFees: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', authAmount: '1000000000' }]
 * });
 * ```
 */
export async function buildDelegatedTXN(
  input: DelegatedInput,
  options: StandardTXNOptions = {}
): Promise<DelegatedTXN> {
  const fields = buildDelegatedFields(input);
  return buildStandardTransaction({
    operation: 'buildDelegatedTXN',
    schema: DelegatedTXNSchema,
    publicKeyId: input.publicKey,
    contractId: undefined,
    fields,
    options
  });
}

/**
 * Build and sign a `DelegatedTXN` with the delegator's private key.
 *
 * @param input - See {@link DelegatedInput}
 * @param privateKey - Delegator's base58 private key (must match `input.publicKey`)
 * @param options - Shared builder options
 * @returns Signed transaction with `base.signature` and `base.hash` populated
 * @throws Error when `privateKey` is empty, plus everything {@link buildDelegatedTXN} throws
 *
 * @example
 * ```typescript
 * const txn = await createDelegatedTXN({
 *   publicKey: alice.publicKey,
 *   delegateVotes: [{ address: bob.address, contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 0 }] }]
 * }, alice.privateKey);
 * const hash = await sendDelegatedTXN(txn);
 * ```
 */
export async function createDelegatedTXN(
  input: DelegatedInput,
  privateKey: string,
  options: StandardTXNOptions = {}
): Promise<DelegatedTXN> {
  if (typeof privateKey !== 'string' || privateKey === '') {
    throw new Error('privateKey is required');
  }
  const txn = await buildDelegatedTXN(input, options);
  return signWithKey(txn, privateKey, input.publicKey);
}

/**
 * Submit a signed `DelegatedTXN` via `TXNService.DelegatedVoting`.
 *
 * @param txn - Signed transaction
 * @param grpcConfig - Endpoint configuration
 * @returns Hex transaction hash
 * @throws Error when the transaction is unsigned or the network rejects it
 *
 * @example
 * ```typescript
 * const hash = await sendDelegatedTXN(signedTxn);
 * ```
 */
export async function sendDelegatedTXN(
  txn: DelegatedTXN,
  grpcConfig: GRPCConfig = {}
): Promise<string> {
  return submitStandardTransaction(txn, grpcConfig);
}
