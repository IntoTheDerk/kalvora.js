import type { GRPCConfig } from '../../../types/index.js';

/**
 * gRPC-Web configuration for Kalvora protonet (HTTPS, port 443).
 *
 * This is the SDK's default endpoint. HTTP fallback is disabled because the
 * endpoint is a public network boundary. See `KALVORA_NETWORKS` for the full
 * network preset (endpoint + native token).
 */
export const PROTONET_GRPC_CONFIG: GRPCConfig = {
  host: 'kal-protonet.visiondynamics.ch',
  port: 443,
  protocol: 'https',
  fallbackToHttp: false
};

/** Base URL of the protonet gRPC-Web endpoint. */
export const KALVORA_PROTONET_ENDPOINT = 'https://kal-protonet.visiondynamics.ch' as const;
