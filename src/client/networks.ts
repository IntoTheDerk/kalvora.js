/**
 * Kalvora network presets.
 *
 * A network bundles everything that differs between Kalvora deployments:
 * the gRPC-Web endpoint and the native token. Builders default to the
 * protonet preset; pass a network's `grpc` config to target another one.
 *
 * @module client/networks
 */

import { deriveChainId, type ChainName } from '../shared/network/chain-id.js';
import { KALVORA_NATIVE_TOKEN, KALVORA_PROTONET_NETWORK } from '../shared/network/constants.js';
import { PROTONET_GRPC_CONFIG } from '../shared/utils/testing-defaults/index.js';
import type { TransactionContext } from '../sign/context.js';
import type { GRPCConfig } from '../types/index.js';

/** Definition of a Kalvora network. */
export interface KalvoraNetwork {
  /** Trusted chain context for signing and submission, when pinned. */
  transactionContext?: TransactionContext;
  /** Stable identifier, e.g. `kalvora:protonet` (also used as the CAIP-2-style chain id). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** gRPC-Web endpoint configuration. */
  grpc: GRPCConfig;
  /** Mint ID of the network's native (default fee) token. */
  nativeToken: string;
  /** Decimals of the native token (denomination = 10^decimals). */
  nativeDecimals: number;
  /** Native token symbol. */
  nativeSymbol: string;
}

/** Built-in network presets. */
export const KALVORA_NETWORKS = {
  /**
   * Kalvora protonet — the SDK default. HTTPS gRPC-Web on port 443.
   */
  protonet: {
    id: KALVORA_PROTONET_NETWORK,
    name: 'Kalvora Protonet',
    grpc: PROTONET_GRPC_CONFIG,
    nativeToken: KALVORA_NATIVE_TOKEN,
    nativeDecimals: 9,
    nativeSymbol: 'KALV'
  }
} as const satisfies Record<string, KalvoraNetwork>;

/** Name of a built-in network preset. */
export type KalvoraNetworkName = keyof typeof KALVORA_NETWORKS;

/** Pin a network to its operator-published final genesis hash. */
export function pinNetwork(network: KalvoraNetworkName | KalvoraNetwork, name: ChainName, genesisHash: Uint8Array | string): KalvoraNetwork {
  const resolved = resolveNetwork(network);
  const transactionContext = { chainId: deriveChainId(name, genesisHash) };
  return { ...resolved, transactionContext, grpc: { ...resolved.grpc, transactionContext } };
}

/**
 * Resolve a preset name or custom definition into a {@link KalvoraNetwork}.
 *
 * @throws Error for unknown preset names
 */
export function resolveNetwork(network: KalvoraNetworkName | KalvoraNetwork): KalvoraNetwork {
  if (typeof network === 'string') {
    const preset = (KALVORA_NETWORKS as Record<string, KalvoraNetwork>)[network];
    if (!preset) {
      throw new Error(`Unknown Kalvora network "${network}". Known: ${Object.keys(KALVORA_NETWORKS).join(', ')}`);
    }
    return { ...preset, grpc: { ...preset.grpc } };
  }
  return network;
}
