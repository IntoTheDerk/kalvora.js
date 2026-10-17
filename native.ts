/**
 * kalvora.js/native — native Kalvora queries and governance operations.
 *
 * Re-exports the existing implementations without loading the optional Solana
 * bridge. This entry is ESM-only, like kalvora.js/wallet. The package root and
 * its CommonJS bundle retain their existing API and bridge dependencies.
 */

export { KalvoraClient, type KalvoraClientOptions } from './src/client/kalvora-client.js';
export { KALVORA_NETWORKS, type KalvoraNetwork } from './src/client/networks.js';
export type { GRPCConfig } from './src/types/index.js';
export { VERSION } from './src/version.js';

export { KalvoraRpcError, isKalvoraRpcError, RpcCode } from './src/grpc/errors.js';
export {
  PROPOSAL_TYPE,
  PROPOSAL_PHASE,
  PRE_GOVERNANCE_OUTCOME,
  type TokenFeeInfo
} from './src/query/api-client.js';

export {
  buildTextGovernanceProposalTXN,
  sendGovernanceProposalTXN,
  type BuildTextGovernanceProposalTXNOptions,
  type ProposalConstructionContext,
  type ProposalGovernanceType,
  type TextGovernanceProposalInput
} from './src/proposal/transaction.js';
export { applyProposalStageFee } from './src/proposal/shape.js';
export { buildVoteTXN, type BuildVoteTXNOptions } from './src/vote/transaction.js';
export {
  ProposalType,
  type GovernanceProposal,
  type GovernanceVote,
  type InstrumentContract
} from './proto/generated/txn_pb.js';

export {
  serializeTransaction,
  deserializeTransaction,
  type SerializedTransaction
} from './src/adapter/serialization.js';
export { generateAddressFromPublicKey } from './src/shared/crypto/address-utils.js';
export { isValidContractId } from './src/shared/utils/validation.js';
export { isCanonicalContractId } from './src/protocol/contract-id.js';
export { KALVORA_NATIVE_TOKEN } from './src/shared/network/constants.js';
export {
  UniversalFeeCalculator,
  type FeeConfigHelper
} from './src/shared/fee-calculators/universal-fee-calculator.js';
