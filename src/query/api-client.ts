/**
 * Kalvora Query Client — typed access to every read RPC of `zera_api.APIService`.
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

import { create } from '@bufbuild/protobuf';
import type { Client } from '@connectrpc/connect';

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
  ProposalLedgerRequestSchema,
  SmartContractEventsSearchRequestSchema,
  TokenFeeInfoRequestSchema,
  TotalBalanceRequestSchema,
  type ProposalLedgerResponse,
  type SmartContractEventsResponse
} from '../../proto/generated/api_pb.js';
import { TimestampSchema } from '../../proto/generated/google/protobuf/timestamp_pb.js';
import {
  CONTRACT_FEE_TYPE,
  PublicKeySchema,
  TRANSACTION_TYPE,
  type ContractFees,
  type InstrumentContract,
  type PublicKey
} from '../../proto/generated/txn_pb.js';
import type { Block } from '../../proto/generated/validator_pb.js';
import { createClient } from '../grpc/client-factory.js';
import { getPublicKeyBytes } from '../shared/crypto/address-utils.js';
import { parseAddress, parseUint64, requireContractId, toTimestampInit } from '../shared/tx/standard.js';
import type { GRPCConfig } from '../types/index.js';

import {
  decodeContractSupply,
  findTransactionResult,
  parseUintString,
  type ContractSupply,
  type TransactionResult
} from './decoders.js';

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
  /** Fee per signing key, USD × 1e18. */
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
  /** Raw response. */
  raw: ProposalLedgerResponse;
}

/** Smart contract event, with decoded convenience fields. */
export interface SmartContractEvent {
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

/** Result of {@link KalvoraQueryClient.waitForTransaction}. */
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

function zipMap(keys: string[], values: string[]): Map<string, string> {
  const map = new Map<string, string>();
  keys.forEach((key, index) => map.set(key, values[index] ?? ''));
  return map;
}

function toPublicKey(publicKey: string | PublicKey): PublicKey {
  return typeof publicKey === 'string'
    ? create(PublicKeySchema, { single: new Uint8Array(getPublicKeyBytes(publicKey)) })
    : publicKey;
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

// ============================================================================
// CLIENT
// ============================================================================

/**
 * Typed client for `zera_api.APIService`.
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

  /** @param config - Endpoint / transport configuration. Defaults to protonet over HTTPS. */
  constructor(config: GRPCConfig = {}) {
    this.raw = createClient(APIService, config);
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
      walletAddress: parseAddress(address, 'address'),
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

  /**
   * Balance of one token in a wallet.
   *
   * @param address - Base58 wallet address
   * @param contractId - Token mint ID
   * @throws KalvoraRpcError (`NOT_FOUND`) when the wallet holds no balance of the token
   */
  async getBalance(address: string, contractId: string): Promise<TokenBalance> {
    const response = await this.raw.balance(create(BalanceRequestSchema, {
      walletAddress: parseAddress(address, 'address'),
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
      walletAddress: parseAddress(address, 'address'),
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
  async getContract(contractId: string): Promise<ContractInfo> {
    const response = await this.raw.contract(create(ContractRequestSchema, {
      contractId: requireContractId(contractId)
    }));
    if (!response.contract) {
      throw new Error(`Contract ${contractId} returned an empty definition`);
    }
    return {
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
  async getBaseFee(txnType: TRANSACTION_TYPE, publicKey: string | PublicKey): Promise<BaseFeeInfo> {
    const response = await this.raw.baseFee(create(BaseFeeRequestSchema, {
      txnType,
      publicKey: toPublicKey(publicKey)
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

  /** Every token that may be used to pay base fees. */
  async getAuthorizedFeeTokens(): Promise<AuthorizedFeeToken[]> {
    const response = await this.raw.getAllAuthorizedFees({});
    return response.authorizedFees.map(fee => ({
      contractId: fee.contractId,
      allowedFees: fee.allowedFees,
      usedFees: parseUintString(fee.usedFees, 'usedFees')
    }));
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
  async getBlock(selector: BlockSelector): Promise<Block> {
    const payload = selector.hash !== undefined
      ? { case: 'blockHash' as const, value: selector.hash.toLowerCase().replace(/^0x/u, '') }
      : { case: 'blockHeight' as const, value: parseUint64(selector.height, 'height') };
    const response = await this.raw.block(create(BlockRequestSchema, { payload, encoded: false }));
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
   * Wait until a transaction is included in a block, scanning forward from
   * `fromHeight`.
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
    const timeoutMs = options.timeoutMs ?? 120_000;
    const pollIntervalMs = options.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;
    let height = parseUint64(options.fromHeight, 'fromHeight');

    for (;;) {
      if (options.signal?.aborted) throw new Error('Aborted');
      let block: Block | undefined;
      try {
        block = await this.getBlock({ height });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      if (block) {
        const result = findTransactionResult(block, txnHash);
        if (result) return { ...result, blockHeight: height };
        height += 1n;
        continue;
      }
      if (Date.now() + pollIntervalMs > deadline) {
        throw new Error(`Timed out after ${timeoutMs} ms waiting for transaction ${txnHash} (searched up to height ${height - 1n})`);
      }
      await sleep(pollIntervalMs, options.signal);
    }
  }

  // --------------------------------------------------------------------------
  // Governance
  // --------------------------------------------------------------------------

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
      ledgers: zipMap(raw.ledgerKeys, raw.ledgerValues),
      proposals: zipMap(raw.proposalKeys, raw.proposalValues),
      wallets: zipMap(raw.walletsKeys, raw.walletsValues),
      temp: zipMap(raw.tempKeys, raw.tempValues),
      voted: zipMap(raw.votedKeys, raw.votedValues),
      raw
    };
  }

  // --------------------------------------------------------------------------
  // Smart contracts
  // --------------------------------------------------------------------------

  /**
   * Events emitted by a smart contract since a point in time.
   *
   * @param smartContractId - Smart contract name
   * @param since - Only return events at or after this time (default: all)
   */
  async searchSmartContractEvents(smartContractId: string, since?: Date): Promise<SmartContractEvent[]> {
    if (typeof smartContractId !== 'string' || smartContractId.trim() === '') {
      throw new Error('smartContractId must be a non-empty string');
    }
    const response = await this.raw.smartContractEventsSearch(create(SmartContractEventsSearchRequestSchema, {
      smartContractId,
      ...(since ? { searchStart: create(TimestampSchema, toTimestampInit(since, 'since')) } : {})
    }));
    return response.events.map(event => ({
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
   * Read a raw validator database record.
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
}

/**
 * Create a {@link KalvoraQueryClient}.
 *
 * @param config - Endpoint / transport configuration (defaults to protonet over HTTPS)
 */
export function createQueryClient(config: GRPCConfig = {}): KalvoraQueryClient {
  return new KalvoraQueryClient(config);
}

export { CONFIRMATION_LEVEL, DATABASE_TYPE, PROPOSAL_TYPE };
