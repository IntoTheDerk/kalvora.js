/**
 * Smart Contract Use Cases - Public API
 * 
 * This module provides high-level use case implementations for common
 * smart contract interactions on the Kalvora network.
 * 
 * ## Available Use Cases
 * 
 * ### Bridge
 * Cross-chain token bridging between Kalvora and other chains (Solana).
 * - Kalvora side: Lock tokens to bridge out
 * - Solana side: Release/lock tokens, mint/burn wrapped tokens
 * - Guardian: Administrative operations
 * 
 * ### DEX
 * Decentralized exchange operations via the `zera_dex_proxy` contract.
 * - Pool management: Create, add/remove/unlock liquidity
 * - Trading: Token swaps with configurable slippage
 * 
 * ### Staking
 * Token staking operations via the `staking_proxy` contract.
 * - Liquid staking: Stake, update wallet, release
 * - Instant staking: Instant stake, update wallet, release
 *
 * ### Bootstrapping
 * Kalvora LP bootstrapping operations via the `bootstrapping_proxy` contract.
 * - Position entry: Stake eligible LP tokens
 * - Position maintenance: Update reward wallet
 * - Rewards: Process accrued bootstrapping emissions
 */

export * as bridge from './bridge/index.js';
export * as dex from './dex/index.js';
export * as staking from './staking/index.js';
export * as bootstrapping from './bootstrapping/index.js';
