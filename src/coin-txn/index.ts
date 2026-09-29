/**
 * CoinTXN Module - Main Entry Point
 *
 * This module provides functionality for creating and sending CoinTXN transactions
 * on the Kalvora network with automatic fee calculation and various validation.
 */

// Re-export main functions
export { createCoinTXN, buildCoinTXN, sendCoinTXN, type CoinTXNBuildInput, type CoinTXNBuildOptions } from './transaction.js';

// Re-export types
export type { CoinTXNInput, CoinTXNOutput, GRPCConfig } from '../types/index.js';
