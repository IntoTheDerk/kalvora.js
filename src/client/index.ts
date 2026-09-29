/**
 * High-level client and network presets.
 *
 * @module client
 */

export {
  KalvoraClient,
  createKalvoraClient,
  type KalvoraClientOptions,
  type SubmitAndWaitOptions
} from './kalvora-client.js';

export {
  KALVORA_NETWORKS,
  resolveNetwork,
  type KalvoraNetwork,
  type KalvoraNetworkName
} from './networks.js';
