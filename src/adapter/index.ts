/**
 * Wallet Adapter Module
 *
 * Re-exports all transaction builders and signing tools from their canonical
 * module folders, plus serialization. The adapter is a convenient single
 * import point for external wallets and dApps.
 *
 * @module adapter
 *
 * @example
 * ```typescript
 * import {
 *   buildCoinTXN,
 *   signCoinTXN,
 *   sendCoinTXN,
 *   KeyPairSigner
 * } from 'kalvora.js';
 *
 * // Build → Sign → Send
 * const unsigned = await buildCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
 * const signer = new KeyPairSigner(publicKey, privateKey);
 * const signed = await signCoinTXN(unsigned, [signer]);
 * const hash = await sendCoinTXN(signed);
 * ```
 */

// ============================================================================
// SIGNING (canonical home: src/sign/)
// ============================================================================

export {
  type KalvoraSigner,
  KeyPairSigner,
  signAndFinalize,
  signWithKey,
  signCoinTXN,
  signCoinTXNWithKeys,
  type CoinTXNKeyPair
} from '../sign/index.js';

// ============================================================================
// TRANSACTION BUILDERS (canonical homes in module folders)
// ============================================================================

// CoinTXN
export { buildCoinTXN, type CoinTXNBuildInput, type CoinTXNBuildOptions } from '../coin-txn/transaction.js';

// GovernanceVote
export { buildVoteTXN, sendVoteTXN, type BuildVoteTXNOptions } from '../vote/transaction.js';

// GovernanceProposal — unsigned, text-only construction
export {
  buildTextGovernanceProposalTXN,
  type BuildTextGovernanceProposalTXNOptions,
  type ProposalConstructionContext,
  type ProposalGovernanceType,
  type TextGovernanceProposalInput
} from '../proposal/transaction.js';

// Contract Create & Update
export { buildContractTXN, type BuildContractOptions } from '../contract/create/transaction.js';
export { buildContractUpdateTXN, type BuildContractUpdateOptions } from '../contract/update/transaction.js';

// Smart Contract Execute
export { buildSmartContractExecuteTXN, type BuildSmartContractExecuteOptions } from '../smart-contracts/execute/transaction.js';

// Smart Contract Deploy & Instantiate
export {
  buildSmartContractTXN,
  createSmartContractTXN,
  sendSmartContractTXN,
  type SmartContractCodeInput,
  type BuildSmartContractTXNOptions,
  type CreateSmartContractTXNOptions } from '../smart-contracts/deploy/transaction.js';

export {
  buildSmartContractInstantiateTXN,
  createSmartContractInstantiateTXN,
  sendSmartContractInstantiateTXN,
  type InstantiateParameter,
  type BuildSmartContractInstantiateTXNOptions,
  type CreateSmartContractInstantiateTXNOptions
} from '../smart-contracts/instantiate/transaction.js';

// NFT/SBT Item Transactions
export {
  buildItemizedMintTXN,
  buildNFTTXN,
  buildBurnSBTTXN,
  type BuildItemizedMintOptions,
  type BuildNFTTXNOptions,
  type BuildBurnSBTTXNOptions,
  type ItemizedMintParameterInput,
  type ItemContractFeesInput
} from '../items/transaction.js';

// Re-export types needed for building transactions
export type { ExecuteParameter, ParameterType } from '../smart-contracts/execute/transaction.js';
export type { SmartContractParameter } from '../smart-contracts/shared/parameters.js';
export type { CreateContractOptions, UpdateContractOptions } from '../contract/shared/types.js';

// ============================================================================
// SERIALIZATION
// ============================================================================

export {
  serializeTransaction,
  deserializeTransaction,
  getRegisteredTypes,
  type SerializedTransaction
} from './serialization.js';

// ============================================================================
// WALLET ADAPTER (browser wallet connection + signing)
// ============================================================================

export {
  KalvoraWalletAdapter,
  type WalletAdapterConfig,
  type WalletAdapterEvent,
  type WalletAdapterState,
  type WalletConnectionMode
} from './wallet-adapter.js';

export {
  WalletSigner,
  DeepLinkSigner,
  type CorrelatedSignResult,
  type KalvoraProvider
} from './wallet-signer.js';


// ============================================================================
// WALLETCONNECT v2 — namespace definitions + signer
// ============================================================================

export {
  // Kalvora namespace
  KALVORA_WC_NAMESPACE,
  KALVORA_WC_CHAINS,
  KALVORA_WC_METHODS,
  KALVORA_WC_EVENTS,
  KALVORA_WC_REQUIRED_NAMESPACES,
  // Solana namespace
  SOLANA_WC_NAMESPACE,
  SOLANA_WC_CHAINS,
  SOLANA_WC_METHODS,
  SOLANA_WC_EVENTS,
  SOLANA_WC_REQUIRED_NAMESPACES,
  // Combined
  ALL_WC_REQUIRED_NAMESPACES,
  // Signer
  WalletConnectSigner
} from './walletconnect.js';

export type {
  WCSignClient,
  WCSession,
  KalvoraWCSignTransactionResult,
  KalvoraWCSignMessageResult,
  KalvoraWCGetAccountsResult
} from './walletconnect.js';
