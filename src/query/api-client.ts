/**
 * Kalvora Query Client — typed access to every read RPC of `kal_api.APIService`.
 *
 * The raw generated client speaks protobuf (address bytes, string-encoded
 * integers). {@link KalvoraQueryClient} accepts and returns developer-friendly
 * values instead:
 *
 * | Concept        | Input                     | Output                        |
 * |----------------|---------------------------|-------------------------------|
 * | wallet address | base58 string             | base58 string                 |
 * | amounts        | —                         | `bigint` (smallest units)     |
 * | USD rates      | —                         | `bigint` scaled by 1e18       |
 * | hashes         | hex string                | lower-case hex string         |
 * | heights/nonces | `bigint \| number \| string` | `bigint`                   |
 *
 * Every failed call throws {@link KalvoraRpcError}. Use `.raw` for direct
 * protobuf access when you need a field this client does not surface.
 *
 * @example
 * ```typescript
 * import { createQueryClient } from 'kalvora.js';
 *
 * const query = createQueryClient();                // protonet defaults
 * const nonce = await query.getNextNonce(address);  // 5n
 * const { balance } = await query.getBalance(address, KALVORA_NATIVE_TOKEN);
 * const block = await query.getBlock({ height: 1 });
 * ```
 *
 * @module query/api-client
 */

import { create, fromBinary } from '@bufbuild/protobuf';
import { Code, type Client } from '@connectrpc/connect';

import { TimestampSchema } from '../../proto/generated/google/protobuf/timestamp_pb.js';
import {
  APIService,
  BalanceRequestSchema,
  BaseFeeRequestSchema,
  BlockRequestSchema,
  CONFIRMATION_LEVEL,
  ContractFeeRequestSchema,
  ContractRequestSchema,
  DATABASE_TYPE,
  DatabaseRequestSchema,
  DenominationRequestSchema,
  ItemRequestSchema,
  NonceRequestSchema,
  PROPOSAL_TYPE,
  type ProposalDetailResponse,
  type SigningWalletResponse,
  ProposalLedgerRequestSchema,
  SmartContractEventsSearchRequestSchema,
  TokenFeeInfoRequestSchema,
  TotalBalanceRequestSchema,
  type ProposalLedgerResponse,
  type ProposalStatus,
  type SmartContractEventsResponse
} from '../../proto/generated/kal_api_pb.js';
import {
  CONTRACT_FEE_TYPE,
  TRANSACTION_TYPE,
  type ContractFees,
  type InstrumentContract,
  type PreGovernance,
  type PublicKey
} from '../../proto/generated/txn_pb.js';
import { NFTSchema, type NFT } from '../../proto/generated/validator_pb.js';
import {
  POST_GOVERNANCE_OUTCOME,
  PRE_GOVERNANCE_OUTCOME,
  PROPOSAL_PHASE,
  type Block,
  type Proposal
} from '../../proto/generated/validator_pb.js';
import { additionalFeeSigner } from '../grpc/api/validator-api-client.js';
import { createClient } from '../grpc/client-factory.js';
import { isKalvoraRpcError } from '../grpc/errors.js';
import { decodeWalletAddress } from '../shared/crypto/falcon-address.js';
import { signerPublicKey } from '../shared/tx/base.js';
import { parseAddress, parseHash32, parseUint64, requireContractId, toTimestampInit } from '../shared/tx/standard.js';
import { bytesEqual, bytesToHex } from '../shared/utils/byte-utils.js';
import type { GRPCConfig } from '../types/index.js';

import {
  decodeContractSupply,
  findTransactionResult,
  parseUintString,
  type ContractSupply,
  type TransactionResult
} from './decoders.js';
import { eventSearchRequestDigest, matchesOperatorAddress, verifyOperatorResponse, type RegisteredOperator } from './events.js';
import { decodeBalanceNonceAddress, itemContractDatabaseKey, latin1ToBytes } from './keys.js';

// ============================================================================
// RESULT TYPES
// ============================================================================

/** Balance of one token in one wallet. */
export interface TokenBalance {
  /** Balance in smallest units. */
  balance: bigint;
  /** Smallest units per whole token (e.g. `1000000000n` for 9 decimals). */
  denomination: bigint;
  /** USD rate per whole token, scaled by 1e18 (`1e18` = $1.00). */
  rate: bigint;
}

/** Base fee parameters for a transaction type (all USD values scaled by 1e18). */
export interface BaseFeeInfo {
  /** Total fee for the requested signer layout, USD × 1e18. */
  keyFee: bigint;
  /** Fee per serialized byte, USD × 1e18. */
  byteFee: bigint;
  /** Surcharge when a transaction creates a new token balance, USD × 1e18. */
  newWalletFee: bigint;
}

/** Contract fee configuration returned by `ContractFee`. */
export interface ContractFeeInfo {
  /** How the contract fee is computed. */
  type: CONTRACT_FEE_TYPE;
  /** Instruments that may be used to pay the contract fee. */
  allowedFeeInstruments: string[];
  /** Fee value; meaning depends on `type` (fixed parts, USD × 1e18, or percentage × 1e18). */
  fee: bigint;
}

/** Fee-related information for one token (`GetTokenFeeInfo`). */
export interface TokenFeeInfo {
  /** Token mint ID. */
  contractId: string;
  /** USD rate per whole token, scaled by 1e18. */
  rate: bigint;
  /** Whether the token may be used to pay base fees. */
  authorized: boolean;
  /** Smallest units per whole token. */
  denomination: bigint;
  /** Contract fee configuration, if the contract charges fees. */
  contractFees?: ContractFees;
  /** Fee allowance for the token (`'MAX'` = unlimited, otherwise parts). */
  allowedFees: string;
  /** Fees used against the allowance (parts). */
  usedFees: bigint;
}

/** Entry of `GetAllAuthorizedFees`. */
export interface AuthorizedFeeToken {
  /** Token mint ID. */
  contractId: string;
  /** Fee allowance (`'MAX'` = unlimited, otherwise parts). */
  allowedFees: string;
  /** Fees used against the allowance (parts). */
  usedFees: bigint;
}

/** NFT/SBT item held by a wallet. */
export interface WalletItem {
  /** Item contract mint ID. */
  contractId: string;
  /** Item identifier within the contract. */
  itemId: string;
}

/** A contract definition and the signature of the validator that returned it. */
export interface ContractInfo {
  operatorVerified: boolean;
  /** The instrument contract as stored on-chain. */
  contract: InstrumentContract;
  /** Time the record was produced. */
  timestamp: Date | undefined;
  /** Responding validator's public key. */
  validatorPublicKey: PublicKey | undefined;
  /** Responding validator's signature over the response. */
  signature: Uint8Array;
}

/** Selects a block by height or by hash. */
export type BlockSelector =
  | { height: bigint | number | string; hash?: never }
  | { hash: string; height?: never };

/** Proposal/ledger records returned by `ProposalLedger`, as key → value maps. */
export interface ProposalLedgerView {
  /** Ledger records keyed by ledger ID. */
  ledgers: Map<string, string>;
  /** Proposal records keyed by proposal ID. */
  proposals: Map<string, string>;
  /** Wallet records keyed by wallet. */
  wallets: Map<string, string>;
  /** Temporary records. */
  temp: Map<string, string>;
  /** Voted records keyed by wallet. */
  voted: Map<string, string>;
  /**
   * Structured proposal statuses (`ProposalLedgerResponse.proposal_statuses`),
   * including the pre-governance (council review) phase. Empty when the
   * responding validator predates the field.
   */
  statuses: ProposalStatusView[];
  /** Raw response. */
  raw: ProposalLedgerResponse;
}

/** One structured entry of `ProposalLedgerResponse.proposal_statuses`. */
export interface ProposalStatusView {
  preGovernanceStages: PreGovernance[];
  preGovernanceStage: number | undefined;
  preGovernanceStageCount: number;
  postGovernanceStages: PreGovernance[];
  postGovernanceStage: number | undefined;
  postGovernanceStageCount: number;
  postGovernance: PreGovernance | undefined;
  /** Hex proposal ID. */
  proposalId: string;
  /** Governance contract the proposal belongs to (`''` if the record is absent). */
  contractId: string;
  /** Current governance stage. */
  stage: number;
  /** Active PRE, regular or POST phase. */
  phase: PROPOSAL_PHASE;
  /** Pre-governance outcome (active, or promotion to regular governance pending). */
  preGovernanceOutcome: PRE_GOVERNANCE_OUTCOME;
  postGovernanceOutcome: POST_GOVERNANCE_OUTCOME;
  /** Frozen public choice, including option zero. */
  postGovernanceWinningOption: number | undefined;
  /** Whether council activation, entry to regular governance or final execution is pending. */
  promotionPending: boolean;
  /** Pre-governance voting window start. */
  preGovernanceStartDate: Date | undefined;
  /** Pre-governance voting window end. */
  preGovernanceEndDate: Date | undefined;
  postGovernanceStartDate: Date | undefined;
  postGovernanceEndDate: Date | undefined;
  /** Regular-governance start requested by the proposer. */
  requestedRegularStartDate: Date | undefined;
  /** Fee charged for the pre-governance phase (smallest units). */
  preGovernanceFee: string;
  postGovernanceFee: string;
  /** Fee charged for the regular-governance phase (smallest units). */
  regularGovernanceFee: string;
  /** Pre-governance policy of the governing contract, when it has one. */
  preGovernance: PreGovernance | undefined;
  /** Full validator proposal record. */
  proposal: Proposal | undefined;
  /** Raw status message. */
  raw: ProposalStatus;
}

/** Smart contract event, with decoded convenience fields. */
export interface SmartContractEvent {
  /** Whether the enclosing search response passed operator verification. */
  operatorVerified: boolean;
  /** Smart contract name. */
  smartContract: string;
  /** Contract instance number. */
  instance: bigint;
  /** Function that emitted the event. */
  function: string;
  /** Emitted event payloads (strings as produced by the contract). */
  eventData: string[];
  /** Block height containing the execution. */
  blockHeight: bigint;
  /** Hex hash of the containing block. */
  blockHash: string;
  /** Hex hash of the transaction. */
  txnHash: string;
  /** Block timestamp. */
  timestamp: Date | undefined;
  /** Gas used / approved for the execution. */
  gasUsed: bigint;
  /** Gas approved by the caller. */
  gasApproved: bigint;
  /** Raw protobuf event. */
  raw: SmartContractEventsResponse;
}

/** Options for {@link KalvoraQueryClient.waitForTransaction}. */
export interface WaitForTransactionOptions {
  /** Verify this block against the application's pinned chain and committee or trusted finalized source. */
  verifyFinalizedBlock?: (block: Block, signal?: AbortSignal) => boolean | Promise<boolean>;
  /**
   * First block height to search. Use the latest height observed *before*
   * submitting the transaction (see {@link KalvoraQueryClient.getLatestBlockHeight}).
   */
  fromHeight: bigint | number | string;
  /** Give up after this many milliseconds (default 120 000). */
  timeoutMs?: number;
  /** Delay between polls when the next block is not yet available (default 2 000). */
  pollIntervalMs?: number;
  /** Abort signal to cancel waiting. */
  signal?: AbortSignal;
}

/**
 * Processing receipt returned by {@link KalvoraQueryClient.waitForTransaction}.
 * The historical type name does not imply that finality evidence was verified.
 */
export interface ConfirmedTransaction extends TransactionResult {
  /** Height of the block that contains the transaction. */
  blockHeight: bigint;
}

// ============================================================================
// HELPERS
// ============================================================================

function toDate(ts: { seconds: bigint; nanos: number } | undefined): Date | undefined {
  return ts ? new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000)) : undefined;
}

function toProposalStatusView(status: ProposalStatus): ProposalStatusView {
  const proposal = status.proposal;
  return {
    proposalId: bytesToHex(status.proposalId),
    contractId: proposal?.contractId ?? '',
    stage: proposal?.stage ?? 0,
    phase: proposal?.phase ?? PROPOSAL_PHASE.REGULAR_GOVERNANCE,
    preGovernanceOutcome: proposal?.preGovernanceOutcome ?? PRE_GOVERNANCE_OUTCOME.PRE_GOVERNANCE_ACTIVE,
    postGovernanceOutcome: proposal?.postGovernanceOutcome ?? POST_GOVERNANCE_OUTCOME.POST_GOVERNANCE_ACTIVE,
    postGovernanceWinningOption: proposal?.postGovernanceWinningOption,
    promotionPending: status.promotionPending,
    preGovernanceStartDate: toDate(proposal?.preGovernanceStartDate),
    preGovernanceEndDate: toDate(proposal?.preGovernanceEndDate),
    postGovernanceStartDate: toDate(proposal?.postGovernanceStartDate),
    postGovernanceEndDate: toDate(proposal?.postGovernanceEndDate),
    requestedRegularStartDate: toDate(proposal?.requestedRegularStartDate),
    preGovernanceFee: proposal?.preGovernanceFee ?? '',
    postGovernanceFee: proposal?.postGovernanceFee ?? '',
    regularGovernanceFee: proposal?.regularGovernanceFee ?? '',
    preGovernance: status.preGovernance,
    preGovernanceStages: status.preGovernanceStages,
    preGovernanceStage: status.preGovernanceStage,
    preGovernanceStageCount: status.preGovernanceStageCount,
    postGovernanceStages: status.postGovernanceStages,
    postGovernanceStage: status.postGovernanceStage,
    postGovernanceStageCount: status.postGovernanceStageCount,
    postGovernance: status.postGovernance,
    proposal,
    raw: status
  };
}

function zipMap(keys: string[], values: string[], field: string): Map<string, string> {
  if (keys.length !== values.length) {
    throw new Error(`${field} key/value length mismatch (${keys.length} keys, ${values.length} values)`);
  }
  const map = new Map<string, string>();
  keys.forEach((key, index) => map.set(key, values[index] ?? ''));
  return map;
}

function toPublicKey(publicKey: string | PublicKey): PublicKey {
  return typeof publicKey === 'string' ? signerPublicKey(publicKey) : publicKey;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 5;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Stop waiting even when a user-supplied verifier or transport ignores cancellation. */
async function untilAborted<T>(result: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([result, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

// ============================================================================
// CLIENT
// ============================================================================

/**
 * Typed client for `kal_api.APIService`.
 *
 * Create one per endpoint and reuse it; the underlying transport is shared by
 * all calls. Construct with {@link createQueryClient}.
 */
export class KalvoraQueryClient {
  /**
   * Raw generated ConnectRPC client for direct protobuf access.
   * Errors are still normalised to {@link KalvoraRpcError}.
   */
  readonly raw: Client<typeof APIService>;
  private readonly trustedOperatorAddress: string | undefined;
  private readonly pinnedChain: boolean;
  private authorizedFeeCache: { at: number; tokens: AuthorizedFeeToken[] } | undefined;
  private static readonly AUTHORIZED_FEE_TTL_MS = 60_000;

  /** @param config - Endpoint / transport configuration. Defaults to protonet over HTTPS. */
  constructor(config: GRPCConfig = {}) {
    this.raw = createClient(APIService, config);
    this.trustedOperatorAddress = config.trustedOperatorAddress;
    this.pinnedChain = config.transactionContext !== undefined;
  }

  // --------------------------------------------------------------------------
  // Wallets
  // --------------------------------------------------------------------------

  /**
   * Current (last used) nonce of a wallet. Wallets that have never signed a
   * transaction return `0n`.
   *
   * @param address - Base58 wallet address
   */
  async getNonce(address: string): Promise<bigint> {
    const response = await this.raw.nonce(create(NonceRequestSchema, {
      walletAddress: decodeBalanceNonceAddress(address),
      encoded: false
    }));
    return response.nonce;
  }

  /**
   * Nonce to use for the wallet's next transaction (`getNonce() + 1`).
   *
   * @param address - Base58 wallet address
   */
  async getNextNonce(address: string): Promise<bigint> {
    return (await this.getNonce(address)) + 1n;
  }

  /** Finalized signing identity. An empty response means the wallet has not registered yet. */
  async getSigningWallet(address: string): Promise<SigningWalletResponse | undefined> {
    const response = await this.raw.getSigningWallet({ walletAddress: decodeWalletAddress(address) });
    return response.identity.case === undefined ? undefined : response;
  }

  /** Resolve the registry key for an operator address obtained from a trusted assignment. */
  async resolveOperator(address: string): Promise<RegisteredOperator> {
    const wallet = await this.getSigningWallet(address);
    if (wallet?.identity.case !== 'falcon') throw new Error('Operator must be a registered single-key wallet');
    const operator = { address, key: wallet.identity.value };
    if (!matchesOperatorAddress(operator)) {
      throw new Error('Registered operator key does not derive the trusted address');
    }
    return operator;
  }

  private async expectedOperator(explicit?: RegisteredOperator): Promise<RegisteredOperator | undefined> {
    if (explicit) {
      if (this.trustedOperatorAddress && explicit.address !== this.trustedOperatorAddress) throw new Error('Unexpected validator operator');
      return explicit;
    }
    if (this.trustedOperatorAddress) return this.resolveOperator(this.trustedOperatorAddress);
    if (this.pinnedChain) throw new Error('A trusted operator address is required for signed replies on a pinned chain');
    return undefined;
  }

  /**
   * Balance of one token in a wallet.
   *
   * @param address - Base58 wallet address
   * @param contractId - Token mint ID
   * @throws KalvoraRpcError (`NOT_FOUND`) when the wallet holds no balance of the token
   */
  async getBalance(address: string, contractId: string): Promise<TokenBalance> {
    const response = await this.raw.balance(create(BalanceRequestSchema, {
      walletAddress: decodeBalanceNonceAddress(address),
      contractId: requireContractId(contractId),
      encoded: false
    }));
    return {
      balance: parseUintString(response.balance, 'balance'),
      denomination: parseUintString(response.denomination, 'denomination'),
      rate: parseUintString(response.rate, 'rate')
    };
  }

  /**
   * Like {@link getBalance} but returns `0n` balances instead of throwing when
   * the wallet has never held the token.
   */
  async getBalanceOrZero(address: string, contractId: string): Promise<TokenBalance> {
    try {
      return await this.getBalance(address, contractId);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const denomination = await this.getDenomination(contractId);
      return { balance: 0n, denomination, rate: 0n };
    }
  }

  /**
   * All token balances of a wallet (`TotalBalance`).
   *
   * Note: the response does not name the tokens, and some gateways do not
   * implement this RPC (it then throws `UNIMPLEMENTED`). Prefer
   * {@link getBalance} per token when you know the token list.
   */
  async getAllBalances(address: string): Promise<TokenBalance[]> {
    const response = await this.raw.totalBalance(create(TotalBalanceRequestSchema, {
      walletAddress: decodeBalanceNonceAddress(address),
      encoded: false
    }));
    return response.balances.map(b => ({
      balance: parseUintString(b.balance, 'balance'),
      denomination: parseUintString(b.denomination, 'denomination'),
      rate: parseUintString(b.rate, 'rate')
    }));
  }

  /**
   * NFT/SBT items held by a wallet.
   *
   * @throws KalvoraRpcError (`NOT_FOUND`, "Invalid Wallet") when the wallet holds no items
   */
  async getItems(address: string): Promise<WalletItem[]> {
    const response = await this.raw.items(create(ItemRequestSchema, {
      walletAddress: parseAddress(address, 'address'),
      encoded: false
    }));
    return response.items.map(item => ({ contractId: item.contractId, itemId: item.itemId }));
  }

  // --------------------------------------------------------------------------
  // Contracts & fees
  // --------------------------------------------------------------------------

  /** Full on-chain definition of an instrument contract. */
  async getContract(contractId: string, operator?: RegisteredOperator): Promise<ContractInfo> {
    const expected = await this.expectedOperator(operator);
    const response = await this.raw.contract(create(ContractRequestSchema, {
      contractId: requireContractId(contractId)
    }));
    if (expected && (!verifyOperatorResponse(response, expected) || response.contract?.contractId !== contractId)) {
      throw new Error('Contract response failed operator or contract verification');
    }
    if (!response.contract) {
      throw new Error(`Contract ${contractId} returned an empty definition`);
    }
    return {
      operatorVerified: !!expected,
      contract: response.contract,
      timestamp: toDate(response.timestamp),
      validatorPublicKey: response.publicKey,
      signature: response.signature
    };
  }

  /** Smallest units per whole token (e.g. `1000000000n` for 9 decimals). */
  async getDenomination(contractId: string): Promise<bigint> {
    const response = await this.raw.denomination(create(DenominationRequestSchema, {
      contractId: requireContractId(contractId)
    }));
    return parseUintString(response.denomination, 'denomination');
  }

  /**
   * Contract fee configuration.
   *
   * @throws KalvoraRpcError (`NOT_FOUND`) when the contract charges no fees
   */
  async getContractFee(contractId: string): Promise<ContractFeeInfo> {
    const response = await this.raw.contractFee(create(ContractFeeRequestSchema, {
      contractId: requireContractId(contractId)
    }));
    return {
      type: response.contractFeeType,
      allowedFeeInstruments: response.allowedFeeInstrument,
      fee: parseUintString(response.fee, 'fee')
    };
  }

  /**
   * Base fee parameters for a transaction type.
   *
   * @param txnType - Transaction type to price
   * @param publicKey - Signer's public key (identifier string or protobuf).
   *   Required by current nodes; key type affects the per-key fee.
   */
  async getBaseFee(txnType: TRANSACTION_TYPE, publicKey: string | PublicKey, additionalSigner?: string | PublicKey): Promise<BaseFeeInfo> {
    const response = await this.raw.baseFee(create(BaseFeeRequestSchema, {
      txnType,
      publicKey: toPublicKey(publicKey),
      ...(additionalSigner !== undefined ? { additionalSigner: additionalFeeSigner(additionalSigner) } : {})
    }));
    return {
      keyFee: parseUintString(response.keyFee, 'keyFee'),
      byteFee: parseUintString(response.byteFee, 'byteFee'),
      newWalletFee: parseUintString(response.newWalletFee, 'newWalletFee')
    };
  }

  /** Rate, denomination, authorization, and contract fees for several tokens. */
  async getTokenFeeInfo(contractIds: string[]): Promise<TokenFeeInfo[]> {
    if (!Array.isArray(contractIds) || contractIds.length === 0) {
      throw new Error('contractIds must be a non-empty array');
    }
    const response = await this.raw.getTokenFeeInfo(create(TokenFeeInfoRequestSchema, {
      contractIds: contractIds.map((id, i) => requireContractId(id, `contractIds[${i}]`))
    }));
    return response.tokens.map(token => ({
      contractId: token.contractId,
      rate: parseUintString(token.rate, 'rate'),
      authorized: token.authorized,
      denomination: parseUintString(token.denomination, 'denomination'),
      ...(token.contractFees ? { contractFees: token.contractFees } : {}),
      allowedFees: token.allowedFees,
      usedFees: parseUintString(token.usedFees, 'usedFees')
    }));
  }

  /**
   * Every token that may be used to pay base fees.
   *
   * Cached for 60 seconds. `GetAllAuthorizedFees` has a high rate-limit cost.
   */
  async getAuthorizedFeeTokens(): Promise<AuthorizedFeeToken[]> {
    const now = Date.now();
    const cached = this.authorizedFeeCache;
    if (cached && now - cached.at < KalvoraQueryClient.AUTHORIZED_FEE_TTL_MS) {
      return cached.tokens;
    }
    const response = await this.raw.getAllAuthorizedFees({});
    const tokens = response.authorizedFees.map(fee => ({
      contractId: fee.contractId,
      allowedFees: fee.allowedFees,
      usedFees: parseUintString(fee.usedFees, 'usedFees')
    }));
    this.authorizedFeeCache = { at: now, tokens };
    return tokens;
  }

  /**
   * USD value of one whole token, scaled by 1e18 (the `CURRENCY_EQUIVALENTS`
   * database record).
   */
  async getCurrencyEquivalent(contractId: string): Promise<bigint> {
    const value = await this.getDatabaseValue(DATABASE_TYPE.CURRENCY_EQUIVALENTS, requireContractId(contractId));
    return parseUintString(value, 'currencyEquivalent');
  }

  /** Max and current supply of a token (the `CONTRACT_SUPPLY` database record). */
  async getContractSupply(contractId: string): Promise<ContractSupply> {
    const value = await this.getDatabaseValue(DATABASE_TYPE.CONTRACT_SUPPLY, requireContractId(contractId));
    return decodeContractSupply(value);
  }

  // --------------------------------------------------------------------------
  // Blocks & transactions
  // --------------------------------------------------------------------------

  /**
   * Fetch a block by height or hash.
   *
   * @throws KalvoraRpcError (`NOT_FOUND`) when the block does not exist
   */
  async getBlock(selector: BlockSelector, signal?: AbortSignal): Promise<Block> {
    const payload = selector.hash !== undefined
      ? { case: 'blockHash' as const, value: selector.hash.toLowerCase().replace(/^0x/u, '') }
      : { case: 'blockHeight' as const, value: parseUint64(selector.height, 'height') };
    const response = await this.raw.block(create(BlockRequestSchema, { payload, encoded: false }), signal ? { signal } : undefined);
    if (!response.block) {
      throw new Error('Block response did not contain a block');
    }
    return response.block;
  }

  /** `true` if a block exists at `height`. */
  async hasBlock(height: bigint | number | string): Promise<boolean> {
    try {
      await this.getBlock({ height });
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /**
   * Find the latest block height.
   *
   * The API has no "latest block" RPC, so this performs an exponential probe
   * followed by a binary search over `Block` (≈ 2·log₂(height) requests).
   * Pass a recent `hint` to make this much cheaper.
   *
   * @param hint - A height believed to exist (default `0`)
   */
  async getLatestBlockHeight(hint: bigint | number | string = 0n): Promise<bigint> {
    let low = parseUint64(hint, 'hint');
    if (!(await this.hasBlock(low))) {
      // Hint is beyond the tip (or the chain is empty): restart from genesis.
      if (low === 0n || !(await this.hasBlock(0n))) throw new Error('Chain has no blocks');
      low = 0n;
    }
    let step = 1n;
    let high = low + step;
    while (await this.hasBlock(high)) {
      low = high;
      step *= 2n;
      high = low + step;
    }
    // Invariant: block(low) exists, block(high) does not.
    while (high - low > 1n) {
      const mid = low + (high - low) / 2n;
      if (await this.hasBlock(mid)) low = mid;
      else high = mid;
    }
    return low;
  }

  /**
   * Look up a transaction's processing result in a specific block.
   *
   * @returns The result, or `undefined` if the block does not contain the hash
   */
  async getTransactionResult(txnHash: string, blockHeight: bigint | number | string): Promise<TransactionResult | undefined> {
    const block = await this.getBlock({ height: blockHeight });
    return findTransactionResult(block, txnHash);
  }

  /**
   * Wait until a transaction has an explicit processing receipt in a block, scanning forward from
   * `fromHeight`.
   * With a finality verifier, re-poll each provisional height until its block is finalized.
   *
   * @param txnHash - Hex transaction hash (as returned by `send*` functions)
   * @throws Error on timeout or abort
   *
   * @example
   * ```typescript
   * const fromHeight = await query.getLatestBlockHeight(lastKnownHeight);
   * const hash = await sendCoinTXN(signed);
   * const result = await query.waitForTransaction(hash, { fromHeight });
   * if (!result.success) throw new Error(result.statusName);
   * ```
   */
  async waitForTransaction(txnHash: string, options: WaitForTransactionOptions): Promise<ConfirmedTransaction> {
    parseHash32(txnHash.toLowerCase(), 'txnHash');
    const timeoutMs = options.timeoutMs ?? 120_000;
    const pollIntervalMs = options.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;
    let height = parseUint64(options.fromHeight, 'fromHeight');
    if (options.signal?.aborted) throw new Error('Aborted');
    const controller = new AbortController();
    const { signal } = controller;
    const timeoutError = () => new Error(`Timed out after ${timeoutMs} ms waiting for transaction ${txnHash} (searched up to height ${height - 1n})`);
    const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
    const onAbort = () => controller.abort(new Error('Aborted'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      for (;;) {
        let block: Block | undefined;
        try {
          block = await untilAborted(this.getBlock({ height }, signal), signal);
        } catch (error) {
          signal.throwIfAborted();
          if (!isNotFound(error)) throw error;
        }
        if (block && options.verifyFinalizedBlock && block.blockHeader?.blockHeight !== height) {
          throw new Error('Finality check received a block with an unexpected height');
        }
        if (block && (!options.verifyFinalizedBlock || await untilAborted(Promise.resolve(options.verifyFinalizedBlock(block, signal)), signal))) {
          signal.throwIfAborted();
          const result = findTransactionResult(block, txnHash);
          if (result) return { ...result, blockHeight: height };
          height += 1n;
          if (Date.now() <= deadline) continue;
        }
        if (Date.now() + pollIntervalMs > deadline) throw timeoutError();
        await sleep(pollIntervalMs, signal);
      }
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  // --------------------------------------------------------------------------
  // Governance
  // --------------------------------------------------------------------------

  /** Read every voter from one active, digest-pinned proposal snapshot. */
  async getProposalDetail(id: string, pageSize = 0): Promise<{
    firstPage: ProposalDetailResponse;
    voters: ProposalDetailResponse['voters'];
  } | undefined> {
    const proposalId = parseHash32(id, 'proposalId');
    if (!Number.isInteger(pageSize) || pageSize < 0 || pageSize > 1000) throw new RangeError('pageSize must be 0–1000');
    // Bound restarts when the proposal is changing faster than it can be read.
    for (let attempt = 0; ; attempt++) {
      const voters: ProposalDetailResponse['voters'] = [];
      let firstPage: ProposalDetailResponse | undefined;
      let voterOffset = 0;
      try {
        for (;;) {
          const page: ProposalDetailResponse = await this.raw.proposalDetail({
            proposalId, voterOffset, pageSize,
            ...(firstPage ? { expectedStateDigest: firstPage.stateDigest } : {})
          });
          if (!bytesEqual(page.proposalId, proposalId) || page.voterOffset !== voterOffset ||
              page.stateDigest.length !== 32 || (firstPage && !bytesEqual(firstPage.stateDigest, page.stateDigest))) {
            throw new Error('Inconsistent proposal detail page');
          }
          firstPage ??= page;
          voters.push(...page.voters);
          if (voters.length > 1000) throw new Error('Proposal electorate exceeds 1000 voters');
          if (!page.hasMore) {
            if (firstPage.granular && voters.length !== firstPage.granular.whitelistSize) {
              throw new Error('Granular voter count disagrees with the proposal whitelist size');
            }
            return { firstPage, voters };
          }
          if (!page.voters.length || page.nextVoterOffset !== voters.length) throw new Error('Invalid next voter offset');
          voterOffset = page.nextVoterOffset;
        }
      } catch (error) {
        if (isNotFound(error)) return undefined;
        if (!isKalvoraRpcError(error) || error.code !== Code.Aborted || attempt >= 2) throw error;
      }
    }
  }

  /**
   * Proposal ledger records.
   *
   * @param type - `ALL_PROPOSALS`, `ALL_LEDGERS`, `PROPOSAL_BY_ID`, or `LEDGER_BY_ID`
   * @param key - Proposal or ledger ID for the `*_BY_ID` variants
   */
  async getProposalLedger(type: PROPOSAL_TYPE = PROPOSAL_TYPE.ALL_PROPOSALS, key = ''): Promise<ProposalLedgerView> {
    const raw = await this.raw.proposalLedger(create(ProposalLedgerRequestSchema, {
      // The proto declares this field as DATABASE_TYPE, but its documented
      // selectors are the PROPOSAL_TYPE values (ALL_PROPOSALS … LEDGER_BY_ID).
      type: type as unknown as DATABASE_TYPE,
      key
    }));
    return {
      ledgers: zipMap(raw.ledgerKeys, raw.ledgerValues, 'ledgers'),
      proposals: zipMap(raw.proposalKeys, raw.proposalValues, 'proposals'),
      wallets: zipMap(raw.walletsKeys, raw.walletsValues, 'wallets'),
      temp: zipMap(raw.tempKeys, raw.tempValues, 'temp'),
      voted: zipMap(raw.votedKeys, raw.votedValues, 'voted'),
      statuses: raw.proposalStatuses.map(toProposalStatusView),
      raw
    };
  }

  // --------------------------------------------------------------------------
  // Smart contracts
  // --------------------------------------------------------------------------

  /**
   * Search stored events. Positive page sizes use signed, request-bound cursor paging.
   *
   * @param smartContractId - Smart contract name
   * @param since - Only return events at or after this time (default: all)
   */
  async searchSmartContractEvents(smartContractId: string, since?: Date, verification?: {
    operator?: RegisteredOperator;
    pageSize?: number;
  }): Promise<SmartContractEvent[]> {
    if (typeof smartContractId !== 'string' || smartContractId.trim() === '') {
      throw new Error('smartContractId must be a non-empty string');
    }
    const pageSize = verification?.pageSize ?? 0;
    if (!Number.isInteger(pageSize) || pageSize < 0 || pageSize > 256) throw new RangeError('pageSize must be 0–256');
    const expected = await this.expectedOperator(verification?.operator);
    if (pageSize && !expected) throw new Error('Paged event search requires a trusted operator');
    const request = create(SmartContractEventsSearchRequestSchema, {
      smartContractId,
      pageSize,
      ...(since ? { searchStart: create(TimestampSchema, toTimestampInit(since, 'since')) } : {})
    });
    const events: SmartContractEventsResponse[] = [];
    const seen = new Set<string>();
    let restarts = 0;
    for (;;) {
      let page;
      try {
        page = await this.raw.smartContractEventsSearch(request);
      } catch (error) {
        if (!request.pageCursor.length || !isKalvoraRpcError(error) || error.code !== Code.FailedPrecondition || restarts >= 2) throw error;
        restarts++;
        events.length = 0;
        seen.clear();
        request.pageCursor = new Uint8Array();
        continue;
      }
      if (expected && !verifyOperatorResponse(page, expected)) {
        throw new Error('Event search signature did not verify');
      }
      if (pageSize && !bytesEqual(eventSearchRequestDigest(request), page.requestDigest)) {
        throw new Error('Event search request digest mismatch');
      }
      events.push(...page.events);
      if (!pageSize || !page.nextPageCursor.length) break;
      const cursor = bytesToHex(page.nextPageCursor);
      if (seen.has(cursor)) throw new Error('Repeated event search cursor');
      seen.add(cursor);
      request.pageCursor = page.nextPageCursor;
    }
    return events.map(event => ({
      operatorVerified: !!expected,
      smartContract: event.smartContract,
      instance: event.instance,
      function: event.function,
      eventData: event.eventData,
      blockHeight: event.blockHeight,
      blockHash: event.blockHash,
      txnHash: event.txnHash,
      timestamp: toDate(event.timestamp),
      gasUsed: event.gasUsed,
      gasApproved: event.gasApproved,
      raw: event
    }));
  }

  // --------------------------------------------------------------------------
  // Low level
  // --------------------------------------------------------------------------

  /**
   * Read a raw, uncertified diagnostic validator database record. This is
   * not certified history or proof of committed state. The raw RPC exposes
   * the accompanying `diagnosticUnverified` flag.
   *
   * Values are validator-internal encodings that differ per table (plain
   * decimal strings, binary protobuf, or protobuf text format). Prefer the
   * typed helpers ({@link getCurrencyEquivalent}, {@link getContractSupply})
   * where available.
   *
   * @throws KalvoraRpcError (`NOT_FOUND`) when the key does not exist
   */
  async getDatabaseValue(type: DATABASE_TYPE, key: string): Promise<string> {
    const response = await this.raw.database(create(DatabaseRequestSchema, { type, key }));
    return response.value;
  }

  /**
   * Read one NFT/SBT item from `CONTRACT_ITEMS`.
   *
   * The database key is `db_key::item_contract`: a 4-byte big-endian length
   * and the bytes of `itemId`, then the same for `contractId`. `Items` only
   * returns the id pair; this record has the holder, fees, and metadata.
   */
  async getContractItem(itemId: string, contractId: string): Promise<NFT> {
    const key = itemContractDatabaseKey(itemId, requireContractId(contractId));
    const value = await this.getDatabaseValue(DATABASE_TYPE.CONTRACT_ITEMS, key);
    return fromBinary(NFTSchema, latin1ToBytes(value));
  }
}

/**
 * Create a {@link KalvoraQueryClient}.
 *
 * @param config - Endpoint / transport configuration (defaults to protonet over HTTPS)
 */
export function createQueryClient(config: GRPCConfig = {}): KalvoraQueryClient {
  return new KalvoraQueryClient(config);
}

export { CONFIRMATION_LEVEL, DATABASE_TYPE, PROPOSAL_TYPE, PROPOSAL_PHASE, PRE_GOVERNANCE_OUTCOME };
