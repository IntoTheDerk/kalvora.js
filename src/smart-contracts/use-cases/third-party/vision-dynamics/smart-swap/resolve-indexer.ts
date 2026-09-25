/**
 * Resolve an explicitly injected Kalvora indexer client to its DEX module.
 *
 * This module is deliberately free of Node.js filesystem/package resolution so
 * it can be bundled for browsers and React Native. The supported upstream
 * contract is `kal-indexer-ts`'s `KalvoraClient` (`client.v1.dex.swap`) or that
 * DEX module directly.
 */

import type {
  SmartSwapClientInput,
  SmartSwapDexClient
} from './types.js';

export const SMART_SWAP_CLIENT_ERROR =
  'Smart Swap requires an injected Kalvora indexer client with v1.dex.swap(params), ' +
  'or the client.v1.dex module directly';

function hasSwap(value: unknown): value is SmartSwapDexClient {
  return typeof value === 'object' &&
    value !== null &&
    'swap' in value &&
    typeof value.swap === 'function';
}

/**
 * Return the DEX module from an injected `KalvoraClient` or DEX module.
 *
 * @deprecated The name is retained for compatibility. It no longer imports a
 * sibling checkout or npm package; callers must inject the client explicitly.
 */
export function resolveIndexerClient(client: SmartSwapClientInput): SmartSwapDexClient {
  if (hasSwap(client)) return client;

  if (
    typeof client === 'object' &&
    client !== null &&
    'v1' in client &&
    typeof client.v1 === 'object' &&
    client.v1 !== null &&
    'dex' in client.v1 &&
    hasSwap(client.v1.dex)
  ) {
    return client.v1.dex;
  }

  throw new TypeError(SMART_SWAP_CLIENT_ERROR);
}
