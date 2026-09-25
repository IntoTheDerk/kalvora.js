/**
 * KalvoraClient — one object for talking to a Kalvora network.
 *
 * Bundles the typed query clients and transaction submission behind a single
 * endpoint configuration, and adds the "submit and wait for inclusion"
 * workflow that otherwise requires juggling several calls.
 *
 * Transaction *construction* stays in the standalone, tree-shakeable builder
 * functions (`buildCoinTXN`, `buildMintTXN`, …); pass
 * {@link KalvoraClient.grpcConfig} to them so every call targets the same
 * endpoint.
 *
 * @example
 * ```typescript
 * import { KalvoraClient, createCoinTXN, KALVORA_NATIVE_TOKEN } from 'kalvora.js';
 *
 * const kalvora = new KalvoraClient();               // protonet over HTTPS
 * const balance = await kalvora.query.getBalance(address, KALVORA_NATIVE_TOKEN);
 *
 * const txn = await createCoinTXN(inputs, outputs, KALVORA_NATIVE_TOKEN, {}, '', kalvora.grpcConfig);
 * const result = await kalvora.submitAndWait(txn);   // resolves once included in a block
 * console.log(result.blockHeight, result.statusName);
 * ```
 *
 * @module client/kalvora-client
 */

import { submitTransaction, type AnyKalvoraTransaction } from '../grpc/transaction/transaction-client.js';
import {
  KalvoraQueryClient,
  type ConfirmedTransaction
} from '../query/api-client.js';
import { GuardianQueryClient } from '../query/guardian-client.js';
import { ValidatorQueryClient } from '../query/validator-client.js';
import type { GRPCConfig } from '../types/index.js';

import { resolveNetwork, type KalvoraNetwork, type KalvoraNetworkName } from './networks.js';

/** Options for {@link KalvoraClient}. */
export interface KalvoraClientOptions {
  /**
   * Network preset name or a custom network definition.
   * Defaults to `'protonet'`.
   */
  network?: KalvoraNetworkName | KalvoraNetwork;
  /**
   * Endpoint overrides merged on top of the network's gRPC config
   * (e.g. a custom `endpoint`, `fetch`, or in-memory `transport`).
   */
  grpc?: GRPCConfig;
  /**
   * Guardian service endpoint. Guardians run separately from validators, so
   * {@link KalvoraClient.guardian} is only available when this is set.
   */
  guardian?: GRPCConfig;
}

/** Options for {@link KalvoraClient.submitAndWait}. */
export interface SubmitAndWaitOptions {
  /** Give up waiting after this many milliseconds (default 120 000). */
  timeoutMs?: number;
  /** Delay between block polls (default 2 000). */
  pollIntervalMs?: number;
  /** Abort signal to cancel waiting (the transaction stays submitted). */
  signal?: AbortSignal;
}

/**
 * High-level entry point bound to one Kalvora network.
 *
 * Instances are cheap and stateless apart from a cached block-height hint
 * used to make {@link getLatestBlockHeight} fast on repeated calls.
 */
export class KalvoraClient {
  /** The resolved network definition. */
  readonly network: KalvoraNetwork;
  /** Effective gRPC configuration; pass it to builder / `send*` functions. */
  readonly grpcConfig: GRPCConfig;
  /** Typed `APIService` client (balances, nonces, contracts, blocks, …). */
  readonly query: KalvoraQueryClient;
  /** Read-only `ValidatorService` client. */
  readonly validator: ValidatorQueryClient;

  private readonly guardianClient: GuardianQueryClient | undefined;
  private heightHint = 0n;

  /** @param options - Network selection and endpoint overrides */
  constructor(options: KalvoraClientOptions = {}) {
    this.network = resolveNetwork(options.network ?? 'protonet');
    this.grpcConfig = { ...this.network.grpc, ...options.grpc };
    this.query = new KalvoraQueryClient(this.grpcConfig);
    this.validator = new ValidatorQueryClient(this.grpcConfig);
    this.guardianClient = options.guardian ? new GuardianQueryClient(options.guardian) : undefined;
  }

  /** Native token mint ID of the configured network. */
  get nativeToken(): string {
    return this.network.nativeToken;
  }

  /**
   * Guardian (bridge) query client.
   *
   * @throws Error when no `guardian` endpoint was configured
   */
  get guardian(): GuardianQueryClient {
    if (!this.guardianClient) {
      throw new Error('No guardian endpoint configured; pass `guardian` to the KalvoraClient constructor');
    }
    return this.guardianClient;
  }

  /**
   * Latest block height, using (and refreshing) an internal hint so repeated
   * calls cost only a few requests.
   */
  async getLatestBlockHeight(): Promise<bigint> {
    this.heightHint = await this.query.getLatestBlockHeight(this.heightHint);
    return this.heightHint;
  }

  /**
   * Submit a signed transaction of any type.
   *
   * @param txn - Signed protobuf transaction (from any `create*` builder)
   * @returns Hex transaction hash
   */
  async submit(txn: AnyKalvoraTransaction): Promise<string> {
    return submitTransaction(txn, this.grpcConfig);
  }

  /**
   * Submit a signed transaction and wait until it is included in a block.
   *
   * The latest height is captured *before* submission so the search window
   * cannot miss the including block.
   *
   * @returns The transaction's processing result and block height. Check
   *   `result.success` — inclusion does not imply the transaction succeeded.
   * @throws Error on timeout/abort (the transaction may still be included later)
   */
  async submitAndWait(txn: AnyKalvoraTransaction, options: SubmitAndWaitOptions = {}): Promise<ConfirmedTransaction> {
    const fromHeight = await this.getLatestBlockHeight();
    const hash = await this.submit(txn);
    const result = await this.query.waitForTransaction(hash, {
      fromHeight,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {})
    });
    if (result.blockHeight > this.heightHint) this.heightHint = result.blockHeight;
    return result;
  }
}

/**
 * Create a {@link KalvoraClient}.
 *
 * @param options - Network selection and endpoint overrides
 */
export function createKalvoraClient(options: KalvoraClientOptions = {}): KalvoraClient {
  return new KalvoraClient(options);
}
