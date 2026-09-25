/**
 * gRPC error model.
 *
 * ConnectRPC throws `ConnectError`, whose properties are non-enumerable (so
 * `console.error(err)` prints `{}`) and whose codes are numeric. The SDK
 * normalises every failed RPC into a {@link KalvoraRpcError} that:
 *
 * - has a readable `message` (`gRPC <Method> failed: [<code>] <detail>`),
 * - exposes the numeric gRPC `code` plus a stable string `codeName`,
 * - records the RPC `method` and `service`,
 * - keeps the original `ConnectError` as `cause`.
 *
 * @example
 * ```typescript
 * import { isKalvoraRpcError, RpcCode } from 'kalvora.js';
 *
 * try {
 *   await query.getBlock({ height: 10_000_000n });
 * } catch (error) {
 *   if (isKalvoraRpcError(error) && error.code === RpcCode.NotFound) {
 *     // block does not exist yet
 *   }
 * }
 * ```
 *
 * @module grpc/errors
 */

import { Code, ConnectError } from '@connectrpc/connect';

/**
 * gRPC status codes (re-exported from ConnectRPC under an SDK name so
 * consumers do not need a direct `@connectrpc/connect` dependency).
 */
 
export const RpcCode = Code;
/** Numeric gRPC status code. */
// eslint-disable-next-line no-redeclare
export type RpcCode = Code;

/** Stable, human-readable names for {@link RpcCode} values. */
const CODE_NAMES: Record<number, string> = {
  [Code.Canceled]: 'CANCELED',
  [Code.Unknown]: 'UNKNOWN',
  [Code.InvalidArgument]: 'INVALID_ARGUMENT',
  [Code.DeadlineExceeded]: 'DEADLINE_EXCEEDED',
  [Code.NotFound]: 'NOT_FOUND',
  [Code.AlreadyExists]: 'ALREADY_EXISTS',
  [Code.PermissionDenied]: 'PERMISSION_DENIED',
  [Code.ResourceExhausted]: 'RESOURCE_EXHAUSTED',
  [Code.FailedPrecondition]: 'FAILED_PRECONDITION',
  [Code.Aborted]: 'ABORTED',
  [Code.OutOfRange]: 'OUT_OF_RANGE',
  [Code.Unimplemented]: 'UNIMPLEMENTED',
  [Code.Internal]: 'INTERNAL',
  [Code.Unavailable]: 'UNAVAILABLE',
  [Code.DataLoss]: 'DATA_LOSS',
  [Code.Unauthenticated]: 'UNAUTHENTICATED'
};

/**
 * Error thrown for every failed Kalvora RPC.
 *
 * `message` keeps the historical `gRPC <Method> failed: [<code>] <detail>`
 * shape so log scrapers keep working.
 */
export class KalvoraRpcError extends Error {
  /** Numeric gRPC status code (see {@link RpcCode}). */
  readonly code: RpcCode;
  /** Upper-snake name of `code`, e.g. `NOT_FOUND`. */
  readonly codeName: string;
  /** RPC method name, e.g. `Balance`. */
  readonly method: string;
  /** Fully-qualified protobuf service, e.g. `zera_api.APIService`. */
  readonly service: string;
  /** Error detail reported by the server, without the SDK prefix. */
  readonly detail: string;

  constructor(params: {
    code: RpcCode;
    method: string;
    service: string;
    detail: string;
    cause?: unknown;
  }) {
    super(`gRPC ${params.method} failed: [${params.code}] ${params.detail}`);
    this.name = 'KalvoraRpcError';
    // Assigned manually: the ES2020 lib typings predate the `cause` option.
    if (params.cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: params.cause, enumerable: false, writable: true, configurable: true });
    }
    this.code = params.code;
    this.codeName = CODE_NAMES[params.code] ?? 'UNKNOWN';
    this.method = params.method;
    this.service = params.service;
    this.detail = params.detail;
  }

  /** `true` when the server reported that the requested record does not exist. */
  get isNotFound(): boolean {
    return this.code === Code.NotFound;
  }

  /** `true` when the node (or gateway) does not implement the RPC. */
  get isUnimplemented(): boolean {
    return this.code === Code.Unimplemented;
  }

  /** `true` for transient transport failures that are generally safe to retry. */
  get isRetryable(): boolean {
    return this.code === Code.Unavailable || this.code === Code.DeadlineExceeded || this.code === Code.ResourceExhausted;
  }

  /**
   * Convert a `ConnectError` into a {@link KalvoraRpcError}.
   *
   * @param error - Error thrown by a ConnectRPC client call
   * @param method - RPC method name
   * @param service - Fully-qualified service name
   */
  static fromConnectError(error: ConnectError, method: string, service: string): KalvoraRpcError {
    return new KalvoraRpcError({
      code: error.code,
      method,
      service,
      detail: error.rawMessage || error.message,
      cause: error
    });
  }
}

/** Type guard for {@link KalvoraRpcError}. */
export function isKalvoraRpcError(error: unknown): error is KalvoraRpcError {
  return error instanceof KalvoraRpcError;
}

/** Re-exported so callers can recognise raw transport errors if needed. */
export { ConnectError };
