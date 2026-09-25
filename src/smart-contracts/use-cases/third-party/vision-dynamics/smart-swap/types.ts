/**
 * Public contracts for indexer-powered Kalvora smart swaps.
 *
 * These types intentionally describe only the small portion of
 * `kal-indexer-ts` that kalvora.js consumes. Consumers inject either a
 * `KalvoraClient` or its `client.v1.dex` module; kalvora.js does not resolve
 * packages or inspect the local filesystem at runtime.
 */

/** A single pool traversal within a route stage. */
export interface SmartSwapLeg {
  token_in: string;
  token_out: string;
  pool_fee_bps: number;
  amount_in: string;
}

/** A group of parallel route legs whose outputs are combined. */
export interface SmartSwapStage {
  legs: SmartSwapLeg[];
}

/** Portable unsigned protobuf transaction returned by the indexer. */
export interface SmartSwapSerializedTransaction {
  type: string;
  data: string;
  /** Upstream declares this as `number`; the facade validates version 1 at runtime. */
  version: number;
}

/** Transaction envelope narrowed after the facade's runtime validation. */
export interface SmartSwapValidatedTransaction extends SmartSwapSerializedTransaction {
  type: 'zera_txn.SmartContractExecuteTXN';
  version: 1;
}

/** Parameters shared by quote and direct-build requests. */
export interface QuoteParams {
  tokenIn: string;
  tokenOut: string;
  /** Amount in human-readable token units. */
  amountIn: number;
  platformFeeBps?: number;
  platformFeeAddress?: string;
}

/** Parameters for a quote plus unsigned-transaction build. */
export interface SwapParams extends QuoteParams {
  /** Minimum output in human-readable token units. */
  minAmountOut: string;
  /** Fee token for smart-contract execution. Defaults at the indexer. */
  feeContractID?: string;
  gasFeeInUsd?: number;
}

/** Parameters for building from route stages returned by a prior quote. */
export interface SwapFromStagesParams {
  stages: SmartSwapStage[];
  /** Minimum output in human-readable token units. */
  minAmountOut: string;
  feeContractID?: string;
  platformFeeBps?: number;
  platformFeeAddress?: string;
}

/** Execution details for one hop in a quoted route. */
export interface SmartSwapHopDetail {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  feeRate: number;
  feeAmount: number;
  startRate: number;
  execRate: number;
  endRate: number;
  rateImpact: number;
  reserveIn: number;
  reserveOut: number;
}

/** Response contract returned by `kal-indexer-ts` `v1.dex.swap()`. */
export interface SmartSwapResponse {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  netAmountOut: number;
  startRate: number;
  avgRate: number;
  endRate: number;
  slippage: number;
  rateImpact: number;
  poolFeePercent: number;
  platformFee: number;
  platformFeeBps: number;
  feeContractId: string;
  feeEstimate?: number;
  stages: SmartSwapStage[];
  hopDetails: SmartSwapHopDetail[];
  transaction?: SmartSwapSerializedTransaction;
  minAmountOut?: number;
  firstTimeTransfers?: number;
}

/** Response from a build request, where a valid transaction is required. */
export type SmartSwapBuildResponse = Omit<SmartSwapResponse, 'transaction'> & {
  transaction: SmartSwapValidatedTransaction;
};

/** Exact request shape consumed by the injected indexer's DEX module. */
export interface SmartSwapIndexerRequest {
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: number;
  stages?: SmartSwapStage[];
  includeTransaction?: boolean;
  publicKey?: string;
  minAmountOut?: string;
  feeContractID?: string;
  gasFeeInUsd?: number;
  platformFeeBps?: number;
  platformFeeAddress?: string;
}

/** Minimal browser-safe DEX client contract required by Smart Swap. */
export interface SmartSwapDexClient {
  swap(params: SmartSwapIndexerRequest): Promise<SmartSwapResponse>;
}

/** Minimal shape of a `kal-indexer-ts` `KalvoraClient`. */
export interface SmartSwapIndexerClient {
  v1: {
    dex: SmartSwapDexClient;
  };
}

export type SmartSwapClientInput = SmartSwapDexClient | SmartSwapIndexerClient;
