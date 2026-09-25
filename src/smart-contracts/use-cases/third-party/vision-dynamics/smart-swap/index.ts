/**
 * Indexer-powered swaps for the Kalvora DEX.
 *
 * Route discovery and unsigned transaction assembly are delegated to an
 * injected `kal-indexer-ts` `KalvoraClient` (or its `v1.dex` module). Signing
 * and submission remain explicit kalvora.js operations.
 */

import { resolveIndexerClient } from './resolve-indexer.js';
import type {
  QuoteParams,
  SmartSwapBuildResponse,
  SmartSwapClientInput,
  SmartSwapDexClient,
  SmartSwapResponse,
  SwapFromStagesParams,
  SwapParams
} from './types.js';

const BUILD_RESPONSE_ERROR =
  'Kalvora indexer swap response is missing a valid version 1 serialized transaction';
const EXPECTED_TRANSACTION_TYPE = 'zera_txn.SmartContractExecuteTXN';
const MAX_TRANSACTION_BYTES = 1024 * 1024;

function requireNonEmptyString(value: unknown, name: string, operation: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`smartSwap.${operation}: ${name} must be a non-empty string`);
  }
}

function validateQuote(params: QuoteParams, operation: string): void {
  if (typeof params !== 'object' || params === null) {
    throw new TypeError(`smartSwap.${operation}: params must be an object`);
  }
  requireNonEmptyString(params.tokenIn, 'tokenIn', operation);
  requireNonEmptyString(params.tokenOut, 'tokenOut', operation);
  if (!Number.isFinite(params.amountIn) || params.amountIn <= 0) {
    throw new TypeError(`smartSwap.${operation}: amountIn must be a finite number greater than 0`);
  }
}

function validateBuildFields(params: { minAmountOut: string }, publicKey: string, operation: string): void {
  requireNonEmptyString(params.minAmountOut, 'minAmountOut', operation);
  if (!/^\d+(?:\.\d+)?$/.test(params.minAmountOut)) {
    throw new TypeError(`smartSwap.${operation}: minAmountOut must be a non-negative decimal string`);
  }
  requireNonEmptyString(publicKey, 'publicKey', operation);
}

function requireBuildResponse(response: SmartSwapResponse): SmartSwapBuildResponse {
  const transaction = response?.transaction;
  const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (
    !transaction ||
    transaction.type !== EXPECTED_TRANSACTION_TYPE ||
    typeof transaction.data !== 'string' ||
    transaction.data.length === 0 ||
    !base64Pattern.test(transaction.data) ||
    transaction.version !== 1
  ) {
    throw new Error(BUILD_RESPONSE_ERROR);
  }

  const paddingBytes = transaction.data.endsWith('==')
    ? 2
    : transaction.data.endsWith('=') ? 1 : 0;
  const decodedBytes = (transaction.data.length / 4) * 3 - paddingBytes;
  if (decodedBytes > MAX_TRANSACTION_BYTES) {
    throw new Error(BUILD_RESPONSE_ERROR);
  }

  return response as SmartSwapBuildResponse;
}

/** Smart Swap facade backed by an explicitly injected Kalvora indexer. */
export class SmartSwapClient {
  readonly dex: SmartSwapDexClient;

  constructor(client: SmartSwapClientInput) {
    this.dex = resolveIndexerClient(client);
  }

  /** Get a route and price quote. No wallet key is sent. */
  async getQuote(params: QuoteParams): Promise<SmartSwapResponse> {
    validateQuote(params, 'getQuote');
    return this.dex.swap({ ...params });
  }

  /** Get a quote and build an unsigned transaction. */
  async swap(params: SwapParams, publicKey: string): Promise<SmartSwapBuildResponse> {
    validateQuote(params, 'swap');
    validateBuildFields(params, publicKey, 'swap');
    const response = await this.dex.swap({
      ...params,
      includeTransaction: true,
      publicKey
    });
    return requireBuildResponse(response);
  }

  /** Build an unsigned transaction from stages returned by `getQuote()`. */
  async swapFromStages(
    params: SwapFromStagesParams,
    publicKey: string
  ): Promise<SmartSwapBuildResponse> {
    if (typeof params !== 'object' || params === null) {
      throw new TypeError('smartSwap.swapFromStages: params must be an object');
    }
    if (!Array.isArray(params.stages) || params.stages.length === 0) {
      throw new TypeError('smartSwap.swapFromStages: stages must be a non-empty array');
    }
    validateBuildFields(params, publicKey, 'swapFromStages');
    const response = await this.dex.swap({
      ...params,
      includeTransaction: true,
      publicKey
    });
    return requireBuildResponse(response);
  }
}

/** Create a Smart Swap facade from a `KalvoraClient` or `client.v1.dex`. */
export function createSmartSwap(client: SmartSwapClientInput): SmartSwapClient {
  return new SmartSwapClient(client);
}

export { resolveIndexerClient, SMART_SWAP_CLIENT_ERROR } from './resolve-indexer.js';

export const SMART_SWAP_TRANSACTION_TYPE = EXPECTED_TRANSACTION_TYPE;
export const SMART_SWAP_MAX_TRANSACTION_BYTES = MAX_TRANSACTION_BYTES;

export type {
  QuoteParams,
  SmartSwapBuildResponse,
  SmartSwapClientInput,
  SmartSwapDexClient,
  SmartSwapHopDetail,
  SmartSwapIndexerClient,
  SmartSwapIndexerRequest,
  SmartSwapLeg,
  SmartSwapResponse,
  SmartSwapSerializedTransaction,
  SmartSwapValidatedTransaction,
  SmartSwapStage,
  SwapFromStagesParams,
  SwapParams
} from './types.js';
