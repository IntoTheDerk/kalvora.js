/**
 * kalvora.js — TypeScript SDK for the Kalvora network.
 *
 * Sections (in export order):
 *
 * 1. Client & networks      — `KalvoraClient`, network presets
 * 2. Queries                — typed API / validator / guardian clients, decoders
 * 3. Errors                 — `KalvoraRpcError`, SDK and wallet errors
 * 4. Wallets & keys         — HD wallets, mnemonics, addresses
 * 5. Signing                — signers and signing workflows
 * 6. Transactions           — build / create / send for every transaction type
 * 7. Submission & encoding  — universal submit, serialization
 * 8. Wallet adapters        — injected wallets, deep links, WalletConnect
 * 9. Use cases              — staking, DEX, bootstrapping, bridge, smart swap
 * 10. Protocol              — enums, message types, raw generated bindings
 * 11. Network constants & utilities
 *
 * Every public API is available from the package root; deep `dist/*` imports
 * are not needed and not supported.
 *
 * @packageDocumentation
 */

// ============================================================================
// 1. CLIENT & NETWORKS
// ============================================================================

export {
  KalvoraClient,
  createKalvoraClient,
  KALVORA_NETWORKS,
  resolveNetwork,
  type KalvoraClientOptions,
  type KalvoraNetwork,
  type KalvoraNetworkName,
  type SubmitAndWaitOptions
} from './src/client/index.js';

// ============================================================================
// 2. QUERIES
// ============================================================================

export * from './src/query/index.js';

// ============================================================================
// 3. ERRORS
// ============================================================================

export {
  KalvoraRpcError,
  isKalvoraRpcError,
  RpcCode
} from './src/grpc/errors.js';

export {
  KalvoraError,
  ValidationError,
  NetworkError,
  CryptoError,
  TransactionError
} from './src/types/index.js';

export {
  WalletCreationError,
  InvalidKeyTypeError,
  InvalidHashTypeError,
  InvalidMnemonicLengthError,
  InvalidMnemonicError,
  InvalidDerivationPathError,
  InvalidHDParameterError,
  MissingParameterError,
  CryptographicError
} from './src/wallet-creation/errors.js';

// ============================================================================
// 4. WALLETS & KEYS
// ============================================================================

export {
  WalletFactory,
  createWallet,
  deriveMultipleWallets,
  createBaseWallet,
  createHDWallet,
  deriveMultipleAddresses,
  getHDWalletInfo,
  generateMnemonicPhrase,
  validateMnemonicPhrase,
  generateSeed,
  buildDerivationPath,
  generateKalvoraAddress,
  generateKalvoraPublicKeyIdentifier,
  generateAddressFromPublicKey,
  CryptoUtils,
  KEY_TYPE,
  HASH_TYPE,
  VALID_KEY_TYPES,
  VALID_HASH_TYPES,
  KEY_TYPE_PREFIXES,
  HASH_TYPE_PREFIXES,
  isValidKeyType,
  isValidHashType,
  KALVORA_TYPE,
  KALVORA_TYPE_HEX,
  KALVORA_SYMBOL,
  KALVORA_NAME,
  SLIP0010_DERIVATION_PATH,
  MNEMONIC_LENGTHS,
  type WalletOptions,
  type Wallet,
  type HDOptions,
  type MultipleWalletOptions,
  type KeyType,
  type HashType,
  type MnemonicLength
} from './src/wallet-creation/index.js';

// ============================================================================
// 5. SIGNING
// ============================================================================

export {
  KeyPairSigner,
  signAndFinalize,
  signWithKey,
  signCoinTXN,
  signCoinTXNWithKeys,
  type KalvoraSigner,
  type CoinTXNKeyPair
} from './src/sign/index.js';

// ============================================================================
// 6. TRANSACTIONS
// ============================================================================

// Shared options and helpers for BaseTXN-based builders
export {
  buildStandardTransaction,
  submitStandardTransaction,
  requireContractId,
  parseAddress,
  parseHash32,
  parsePartsAmount,
  parseUint64,
  toTimestampInit,
  type StandardTXNOptions,
  type BuildStandardTransactionParams
} from './src/shared/tx/standard.js';

// Coin transfers (CoinTXN)
export {
  buildCoinTXN,
  createCoinTXN,
  sendCoinTXN,
  type CoinTXNInput,
  type CoinTXNOutput,
  type CoinTXNBuildInput,
  type CoinTXNBuildOptions,
  type GRPCConfig
} from './src/coin-txn/index.js';

// Token minting (MintTXN)
export * from './src/mint/index.js';

// Contracts (InstrumentContract, ContractUpdateTXN)
export {
  buildContractTXN,
  createContractTXN,
  sendContractTXN,
  buildContractUpdateTXN,
  createContractUpdateTXN,
  sendContractUpdateTXN,
  type BuildContractOptions,
  type BuildContractUpdateOptions,
  type CreateContractOptions,
  type UpdateContractOptions
} from './src/contract/index.js';

// Contract administration (RevokeTXN, QuashTXN, ComplianceTXN, ExpenseRatioTXN)
export * from './src/revoke/index.js';
export * from './src/quash/index.js';
export * from './src/compliance/index.js';
export * from './src/expense-ratio/index.js';

// Wallet permissions (AllowanceTXN, DelegatedTXN)
export * from './src/allowance/index.js';
export * from './src/delegated-voting/index.js';

// Items: NFTs and soul-bound tokens (ItemizedMintTXN, NFTTXN, BurnSBTTXN)
export {
  buildItemizedMintTXN,
  createItemizedMintTXN,
  sendItemizedMintTXN,
  buildNFTTXN,
  createNFTTXN,
  sendNFTTXN,
  buildBurnSBTTXN,
  createBurnSBTTXN,
  sendBurnSBTTXN,
  type BuildItemizedMintOptions,
  type CreateItemizedMintOptions,
  type BuildNFTTXNOptions,
  type CreateNFTTXNOptions,
  type BuildBurnSBTTXNOptions,
  type CreateBurnSBTTXNOptions,
  type ItemizedMintParameterInput,
  type ItemContractFeesInput,
  type StandardItemTXNOptions
} from './src/items/index.js';

// Governance (GovernanceProposal, GovernanceVote, ProposalCancelTXN)
export {
  buildTextGovernanceProposalTXN,
  createTextGovernanceProposalTXN,
  sendGovernanceProposalTXN,
  TEXT_PROPOSAL_LIMITS,
  KALVORA_PROPOSAL_CONTEXT_SCHEMA,
  KALVORA_PROPOSAL_POLICY_VERSION,
  type BuildTextGovernanceProposalTXNOptions,
  type ProposalConstructionContext,
  type ProposalGovernanceType,
  type TextGovernanceProposalInput
} from './src/proposal/index.js';

export {
  buildVoteTXN,
  createVoteTXN,
  sendVoteTXN,
  type BuildVoteTXNOptions,
  type CreateVoteTXNOptions
} from './src/vote/index.js';

export {
  buildProposalCancelTXN,
  createProposalCancelTXN,
  sendProposalCancelTXN,
  type BuildProposalCancelTXNOptions,
  type CreateProposalCancelTXNOptions
} from './src/proposal-cancel/index.js';

// Smart contracts (SmartContractTXN, SmartContractInstantiateTXN, SmartContractExecuteTXN)
export {
  buildSmartContractTXN,
  createSmartContractTXN,
  sendSmartContractTXN,
  type SmartContractCodeInput,
  type BuildSmartContractTXNOptions,
  type CreateSmartContractTXNOptions
} from './src/smart-contracts/deploy/index.js';

export {
  buildSmartContractInstantiateTXN,
  createSmartContractInstantiateTXN,
  sendSmartContractInstantiateTXN,
  type InstantiateParameter,
  type BuildSmartContractInstantiateTXNOptions,
  type CreateSmartContractInstantiateTXNOptions,
  type SmartContractParameter
} from './src/smart-contracts/instantiate/index.js';

export {
  buildSmartContractExecuteTXN,
  createSmartContractExecuteTXN,
  sendSmartContractExecuteTXN,
  ParamType,
  type ExecuteParameter,
  type ParameterType,
  type BuildSmartContractExecuteOptions,
  type CreateSmartContractExecuteOptions
} from './src/smart-contracts/execute/index.js';

// Validator operators (ValidatorRegistration, ValidatorHeartbeat)
export * from './src/validator-ops/index.js';

// ============================================================================
// 7. SUBMISSION & ENCODING
// ============================================================================

export {
  createTransactionClient,
  submitTransaction,
  type AnyKalvoraTransaction
} from './src/grpc/index.js';

export { createClient as createGrpcClient } from './src/grpc/client-factory.js';

export {
  serializeTransaction,
  deserializeTransaction,
  getRegisteredTypes,
  type SerializedTransaction
} from './src/adapter/serialization.js';

// ============================================================================
// 8. WALLET ADAPTERS
// ============================================================================

export {
  KalvoraWalletAdapter,
  WalletSigner,
  DeepLinkSigner,
  WalletConnectSigner,
  KALVORA_WC_NAMESPACE,
  KALVORA_WC_CHAINS,
  KALVORA_WC_METHODS,
  KALVORA_WC_EVENTS,
  KALVORA_WC_REQUIRED_NAMESPACES,
  SOLANA_WC_NAMESPACE,
  SOLANA_WC_CHAINS,
  SOLANA_WC_METHODS,
  SOLANA_WC_EVENTS,
  SOLANA_WC_REQUIRED_NAMESPACES,
  ALL_WC_REQUIRED_NAMESPACES,
  type WalletAdapterConfig,
  type WalletAdapterEvent,
  type WalletAdapterState,
  type WalletConnectionMode,
  type CorrelatedSignResult,
  type KalvoraProvider,
  type WCSignClient,
  type WCSession,
  type KalvoraWCSignTransactionResult,
  type KalvoraWCSignMessageResult,
  type KalvoraWCGetAccountsResult
} from './src/adapter/index.js';

// ============================================================================
// 9. USE CASES
// ============================================================================

/** Staking smart-contract operations. */
export * as staking from './src/smart-contracts/use-cases/staking/index.js';
/** Validator bootstrapping smart-contract operations. */
export * as bootstrapping from './src/smart-contracts/use-cases/bootstrapping/index.js';
/** DEX (liquidity pools and swaps) via the DEX proxy smart contract. */
export * as dex from './src/smart-contracts/use-cases/dex/index.js';
/** Solana-side bridge instruction builders. */
export * as solanaBridge from './src/smart-contracts/use-cases/bridge/solana/index.js';
/** Guardian VAA helpers and bridge administration. */
export * as guardianBridge from './src/smart-contracts/use-cases/bridge/guardian/index.js';

// Kalvora-side bridge transactions (lock / release / wrapped SOL)
export {
  lockKalvora,
  lockKalvoraAndSend,
  releaseKalvora,
  releaseKalvoraAndSend,
  burnSol,
  burnSolAndSend,
  mintSol,
  mintSolAndSend,
  createSol,
  createSolAndSend,
  bridgeKalvoraToSol,
  bridgeKalvoraToSolAndSend,
  type BridgeKalvoraOptions,
  type BurnSolOptions,
  type ReleaseKalvoraOptions,
  type MintSolOptions,
  type CreateSolOptions
} from './src/smart-contracts/use-cases/bridge/kalvora/index.js';

export type {
  PayloadResponse,
  SearchPayloadResponse,
  SolanaPayload,
  ZeraPayload
} from './src/smart-contracts/use-cases/bridge/guardian/index.js';

export type {
  LockSplOptions,
  LockToken2022Options,
  ReleaseSplOptions,
  ReleaseToken2022Options
} from './src/smart-contracts/use-cases/bridge/solana/index.js';

/** Indexer-powered swap facade (inject a kal-indexer-ts client or its `v1.dex`). */
export * as smartSwap from './src/smart-contracts/use-cases/third-party/vision-dynamics/smart-swap/index.js';
export {
  createSmartSwap,
  SmartSwapClient,
  SMART_SWAP_MAX_TRANSACTION_BYTES,
  SMART_SWAP_TRANSACTION_TYPE,
  resolveIndexerClient,
  SMART_SWAP_CLIENT_ERROR,
  type QuoteParams as SmartSwapQuoteParams,
  type SwapParams as SmartSwapParams,
  type SwapFromStagesParams as SmartSwapFromStagesParams,
  type SmartSwapBuildResponse,
  type SmartSwapClientInput,
  type SmartSwapDexClient,
  type SmartSwapIndexerClient,
  type SmartSwapIndexerRequest,
  type SmartSwapResponse,
  type SmartSwapSerializedTransaction,
  type SmartSwapValidatedTransaction,
  type SmartSwapStage
} from './src/smart-contracts/use-cases/third-party/vision-dynamics/smart-swap/index.js';

// ============================================================================
// 10. PROTOCOL
// ============================================================================

/** Raw generated protobuf bindings: `proto.txn`, `proto.api`, `proto.validator`, `proto.guardian`. */
export * as proto from './src/protocol/index.js';

export {
  TRANSACTION_TYPE,
  TXN_STATUS,
  CONTRACT_TYPE,
  CONTRACT_FEE_TYPE,
  GOVERNANCE_TYPE,
  LANGUAGE,
  PROPOSAL_PERIOD,
  VARIABLE_TYPE
} from './proto/generated/txn_pb.js';

export type {
  BaseTXN,
  PublicKey,
  CoinTXN,
  MintTXN,
  ItemizedMintTXN,
  NFTTXN,
  BurnSBTTXN,
  InstrumentContract,
  ContractUpdateTXN,
  GovernanceProposal,
  GovernanceVote,
  ProposalCancelTXN,
  SmartContractTXN,
  SmartContractInstantiateTXN,
  SmartContractExecuteTXN,
  ExpenseRatioTXN,
  DelegatedTXN,
  QuashTXN,
  RevokeTXN,
  ComplianceTXN,
  AllowanceTXN,
  ValidatorRegistration,
  ValidatorHeartbeat,
  TXNStatusFees
} from './proto/generated/txn_pb.js';

export type { Block, BlockHeader } from './proto/generated/validator_pb.js';

// ============================================================================
// 11. NETWORK CONSTANTS & UTILITIES
// ============================================================================

export {
  KALVORA_NATIVE_TOKEN,
  KALVORA_PROTONET_NETWORK,
  KALVORA_MINT_ID_MAX_BYTES,
  KALVORA_MINT_ID_ERROR,
  isKalvoraMintId
} from './src/shared/network/constants.js';

export {
  PROTONET_GRPC_CONFIG,
  KALVORA_PROTONET_ENDPOINT
} from './src/shared/utils/testing-defaults/index.js';

export {
  toSmallestUnits,
  fromSmallestUnits
} from './src/shared/utils/unified-amount-conversion.js';

export {
  isValidContractId,
  isValidAddress,
  validateAmount,
  validateBase58Address
} from './src/shared/utils/validation.js';

export { bytesToHex, hexToBytes } from './src/shared/utils/byte-utils.js';

/** SDK version. */
export const VERSION = '0.1.0' as const;

/** SDK description. */
export const DESCRIPTION = 'Kalvora JavaScript SDK' as const;
