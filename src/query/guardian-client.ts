/**
 * Guardian Query Client — read RPCs of `zera_guardian.GuardianService`.
 *
 * Guardians attest cross-chain bridge activity between Kalvora and Solana.
 * This client exposes the public, read-only guardian RPCs:
 *
 * | Method                  | RPC             | Purpose                                     |
 * |-------------------------|-----------------|---------------------------------------------|
 * | {@link getPayload}      | `GetPayload`    | Signed bridge payload (VAA) for one txn     |
 * | {@link searchPayloads}  | `SearchPayload` | All payloads since a time                   |
 * | {@link getPriceData}    | `GetPriceData`  | Guardian-cached token price / liquidity     |
 * | {@link getMintInfo}     | `GetMintInfo`   | Kalvora contract ID → Solana mint address   |
 *
 * `AuthenticateGuardian` is guardian-to-guardian and is not wrapped.
 * Higher-level VAA helpers (retrying fetch, submission to Solana/Kalvora)
 * live in the bridge module (`guardianBridge`).
 *
 * @module query/guardian-client
 */

import { create } from '@bufbuild/protobuf';
import type { Client } from '@connectrpc/connect';

import { TimestampSchema } from '../../proto/generated/google/protobuf/timestamp_pb.js';
import {
  GetMintInfoRequestSchema,
  GuardianService,
  NETWORK_TYPE,
  PayloadRequestSchema,
  PriceDataRequestSchema,
  SearchPayloadRequestSchema,
  type PayloadResponse,
  type PriceData,
  type SearchPayloadResponse
} from '../../proto/generated/guardian_pb.js';
import { createClient } from '../grpc/client-factory.js';
import { toTimestampInit } from '../shared/tx/standard.js';
import type { GRPCConfig } from '../types/index.js';

/** Price data cached by a guardian. USD values use the guardian's `USD_MULTIPLIER` scale. */
export interface GuardianPriceData {
  /** `true` when the guardian holds a cached price for the mint. */
  hasPrice: boolean;
  /** The cached price record (present when `hasPrice`). */
  priceData: PriceData | undefined;
  /** Responding guardian's Kalvora public key. */
  guardianKey: string;
}

/**
 * Typed client for `zera_guardian.GuardianService`.
 * Construct with {@link createGuardianQueryClient}.
 */
export class GuardianQueryClient {
  /** Raw generated ConnectRPC client (errors normalised to `KalvoraRpcError`). */
  readonly raw: Client<typeof GuardianService>;

  /** @param config - Guardian endpoint / transport configuration */
  constructor(config: GRPCConfig = {}) {
    this.raw = createClient(GuardianService, config);
  }

  /**
   * Fetch the guardian-signed payload for one bridge transaction.
   *
   * @param payloadId - Kalvora transaction hash (hex) or Solana transaction signature
   * @param network - Chain the source transaction happened on
   */
  async getPayload(payloadId: string, network: NETWORK_TYPE): Promise<PayloadResponse> {
    if (typeof payloadId !== 'string' || payloadId.trim() === '') {
      throw new Error('payloadId must be a non-empty string');
    }
    return this.raw.getPayload(create(PayloadRequestSchema, { payloadId, networkType: network }));
  }

  /** All payloads (both directions) produced since `since`. */
  async searchPayloads(since: Date): Promise<SearchPayloadResponse> {
    return this.raw.searchPayload(create(SearchPayloadRequestSchema, {
      searchStartTime: create(TimestampSchema, toTimestampInit(since, 'since'))
    }));
  }

  /**
   * Guardian-cached price data for a Solana mint.
   *
   * @param mintAddress - Solana token mint address
   * @param txnHash - Optional bridge transaction signature for context
   */
  async getPriceData(mintAddress: string, txnHash = ''): Promise<GuardianPriceData> {
    if (typeof mintAddress !== 'string' || mintAddress.trim() === '') {
      throw new Error('mintAddress must be a non-empty string');
    }
    const response = await this.raw.getPriceData(create(PriceDataRequestSchema, { mintAddress, txnHash }));
    return { hasPrice: response.hasPrice, priceData: response.priceData, guardianKey: response.zeraKey };
  }

  /**
   * Resolve Kalvora contract IDs to their Solana mint addresses.
   *
   * @returns Map of contract ID → Solana mint address (unknown IDs are omitted)
   */
  async getMintInfo(contractIds: string[]): Promise<Map<string, string>> {
    if (!Array.isArray(contractIds) || contractIds.length === 0) {
      throw new Error('contractIds must be a non-empty array');
    }
    const response = await this.raw.getMintInfo(create(GetMintInfoRequestSchema, { contractIds }));
    return new Map(response.mintInfos.map(info => [info.contractId, info.mintAddress]));
  }
}

/**
 * Create a {@link GuardianQueryClient}.
 *
 * @param config - Guardian endpoint / transport configuration
 */
export function createGuardianQueryClient(config: GRPCConfig = {}): GuardianQueryClient {
  return new GuardianQueryClient(config);
}

export { NETWORK_TYPE };
