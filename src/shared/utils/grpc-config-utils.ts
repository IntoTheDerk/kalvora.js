import type { GRPCConfig } from '../../types/index.js';

/**
 * Create a custom gRPC configuration
 * @param overrides - Partial configuration to override defaults
 * @returns Custom GRPCConfig
 */
export function createGRPCConfig(overrides: Partial<GRPCConfig> = {}): GRPCConfig {
  return {
    ...overrides
  };
}
