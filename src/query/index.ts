/**
 * Query Module — typed, read-only access to Kalvora network state.
 *
 * - {@link KalvoraQueryClient}: `APIService` (wallets, contracts, fees,
 *   blocks, governance ledger, smart contract events, raw database).
 * - {@link ValidatorQueryClient}: read-only `ValidatorService` subset.
 * - {@link GuardianQueryClient}: bridge guardian payloads, prices, mint info.
 * - Pure decoders for blocks, transaction results, and scaled values.
 *
 * @module query
 */

export {
  KalvoraQueryClient,
  createQueryClient,
  CONFIRMATION_LEVEL,
  DATABASE_TYPE,
  PROPOSAL_TYPE,
  type AuthorizedFeeToken,
  type BaseFeeInfo,
  type BlockSelector,
  type ConfirmedTransaction,
  type ContractFeeInfo,
  type ContractInfo,
  type ProposalLedgerView,
  type SmartContractEvent,
  type TokenBalance,
  type TokenFeeInfo,
  type WaitForTransactionOptions,
  type WalletItem
} from './api-client.js';

export {
  ValidatorQueryClient,
  createValidatorQueryClient,
  type CheckpointInfo
} from './validator-client.js';

export {
  GuardianQueryClient,
  createGuardianQueryClient,
  NETWORK_TYPE,
  type GuardianPriceData
} from './guardian-client.js';

export {
  USD_SCALE,
  decodeContractSupply,
  findTransactionResult,
  formatScaled,
  listBlockTransactions,
  parseUintString,
  partsToWhole,
  summarizeBlock,
  toTransactionResult,
  type BlockSummary,
  type BlockTransaction,
  type ContractSupply,
  type TransactionResult
} from './decoders.js';
