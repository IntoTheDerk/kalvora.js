import { TRANSACTION_TYPE, type BaseTXN } from '../../proto/generated/txn_pb.js';

/** Trusted network identity, supplied by the operator through a trusted channel. */
export interface TransactionContext {
  /** Exact named chain ID or opaque configured wire bytes; explicit legacy hex pins remain supported. */
  chainId: Uint8Array | string;
}

let configuredChainId: Uint8Array | undefined;

/**
 * Pin the target chain before building or signing transactions. There is no
 * default chain identity. Configure once per application; use an explicit
 * context when signing for another chain. Passing undefined clears the pin.
 * Never obtain this value from an incoming transaction or untrusted RPC.
 */
export function configureTransactionContext(context: TransactionContext | undefined): void {
  configuredChainId = context === undefined ? undefined : parseChainId(context.chainId);
}

function parseChainId(value: TransactionContext['chainId']): Uint8Array {
  if (value === 'kal_main' || value === 'kal_proto') return new TextEncoder().encode(value);
  if (typeof value === 'string' && /^(?:0x)?[0-9a-fA-F]{64}$/u.test(value)) {
    const hex = value.replace(/^0x/u, '');
    return Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  }
  if (value instanceof Uint8Array && value.length > 0 && value.length <= 64) return new Uint8Array(value);
  throw new Error('chainId must be an exact kal_main/kal_proto identifier, bounded raw bytes, or an explicit legacy 32-byte hex pin');
}

const TYPES: Readonly<Record<string, TRANSACTION_TYPE>> = {
  CoinTXN: TRANSACTION_TYPE.COIN_TYPE,
  MintTXN: TRANSACTION_TYPE.MINT_TYPE,
  ItemizedMintTXN: TRANSACTION_TYPE.ITEM_MINT_TYPE,
  InstrumentContract: TRANSACTION_TYPE.CONTRACT_TXN_TYPE,
  GovernanceVote: TRANSACTION_TYPE.VOTE_TYPE,
  GovernanceProposal: TRANSACTION_TYPE.PROPOSAL_TYPE,
  SmartContractTXN: TRANSACTION_TYPE.SMART_CONTRACT_TYPE,
  SmartContractExecuteTXN: TRANSACTION_TYPE.SMART_CONTRACT_EXECUTE_TYPE,
  ExpenseRatioTXN: TRANSACTION_TYPE.EXPENSE_RATIO_TYPE,
  NFTTXN: TRANSACTION_TYPE.NFT_TYPE,
  ContractUpdateTXN: TRANSACTION_TYPE.UPDATE_CONTRACT_TYPE,
  ValidatorRegistration: TRANSACTION_TYPE.VALIDATOR_REGISTRATION_TYPE,
  ValidatorHeartbeat: TRANSACTION_TYPE.VALIDATOR_HEARTBEAT_TYPE,
  ProposalResult: TRANSACTION_TYPE.PROPOSAL_RESULT_TYPE,
  DelegatedTXN: TRANSACTION_TYPE.DELEGATED_VOTING_TYPE,
  RevokeTXN: TRANSACTION_TYPE.REVOKE_TYPE,
  ComplianceTXN: TRANSACTION_TYPE.COMPLIANCE_TYPE,
  BurnSBTTXN: TRANSACTION_TYPE.SBT_BURN_TYPE,
  SmartContractInstantiateTXN: TRANSACTION_TYPE.SMART_CONTRACT_INSTANTIATE_TYPE,
  AllowanceTXN: TRANSACTION_TYPE.ALLOWANCE_TYPE,
  ProposalCancelTXN: TRANSACTION_TYPE.PROPOSAL_CANCEL_TYPE
};

/** Context fields must be present before fee sizing and before any signature. */
export function transactionContextFields(typeName: string, context?: TransactionContext): Pick<BaseTXN, 'chainId' | 'signatureDomain' | 'intendedType'> {
  const name = typeName.startsWith('kal_txn.') ? typeName.slice(8) : typeName;
  const intendedType = TYPES[name];
  if (intendedType === undefined) throw new Error(`Unsupported signed transaction type: ${typeName}`);
  const chainId = context === undefined ? configuredChainId : parseChainId(context.chainId);
  if (!chainId) throw new Error('Trusted chainId is required; call configureTransactionContext before building or signing');
  return {
    chainId: new Uint8Array(chainId),
    signatureDomain: new TextEncoder().encode(name === 'ProposalResult' ? 'KAL_PROPOSAL_RESULT_V1' : 'KAL_USER_TXN_V1'),
    intendedType
  };
}

/** Validate incoming intent against trusted configuration without repairing it. */
export function assertTransactionContext(txn: { $typeName?: string; base?: BaseTXN }, context?: TransactionContext): void {
  if (!txn.base) throw new Error('Cannot sign transaction: it has no base (BaseTXN) envelope');
  const expected = transactionContextFields(txn.$typeName ?? '', context);
  const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((value, i) => value === b[i]);
  if (!equal(txn.base.chainId, expected.chainId)) throw new Error('Transaction chainId does not match the trusted target chain');
  if (!equal(txn.base.signatureDomain, expected.signatureDomain)) throw new Error('Invalid transaction signatureDomain');
  if (txn.base.intendedType !== expected.intendedType) throw new Error('Transaction intendedType does not match its concrete protobuf type');
}
