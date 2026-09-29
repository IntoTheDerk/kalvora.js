/**
 * Shared types for contract operations
 */

import type { 
  Governance, 
  ContractFees, 
  RestrictedKey, 
  ExpenseRatio, 
  TokenCompliance,
  KeyValuePair,
  PreMintWallet,
  CoinDenomination,
  MaxSupplyRelease,
  CONTRACT_TYPE
} from '../../../proto/generated/txn_pb.js';
import type { GRPCConfig } from '../../types/index.js';

/**
 * Contract creation options
 */
export interface CreateContractOptions {
  /** Contract version (typically major_minorxxx_patchxxx for new contracts ie 1000000 for version 1.0.0) */
  contractVersion: bigint;
  /** Contract symbol (e.g., 'KALV') */
  symbol: string;
  /** Contract name */
  name: string;
  /** Contract type (TOKEN, NFT, SBT) */
  type: CONTRACT_TYPE;
  /** Contract ID (e.g., 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao') */
  contractId: string;
  /** Public key identifier of the contract creator */
  publicKeyBase58Identifier: string;
  /** Private key in base58 format */
  privateKeyBase58: string;
  /** Optional governance configuration */
  governance?: Governance;
  /** Optional restricted keys */
  restrictedKeys?: RestrictedKey[];
  /** Optional maximum supply */
  maxSupply?: string;
  /** Optional contract fees */
  contractFees?: ContractFees;
  /** Optional premint wallets */
  premintWallets?: PreMintWallet[];
  /** Coin denomination (required) */
  coinDenomination: CoinDenomination;
  /** Optional custom parameters */
  customParameters?: KeyValuePair[];
  /** Optional expense ratios */
  expenseRatio?: ExpenseRatio[];
  /** Whether to update contract fees */
  updateContractFees?: boolean;
  /** Whether to update expense ratio */
  updateExpenseRatio?: boolean;
  /** Optional quash threshold */
  quashThreshold?: number;
  /** Optional token compliance settings */
  tokenCompliance?: TokenCompliance[];
  /** Whether KYC status is required */
  kycStatus?: boolean;
  /** Whether KYC status is immutable */
  immutableKycStatus?: boolean;
  /** Optional max supply releases */
  maxSupplyRelease?: MaxSupplyRelease[];
  /** Optional fee ID (defaults to `KALVORA_NATIVE_TOKEN`) */
  feeId?: string;
  /** Optional fee amount in parts */
  feeAmountParts?: string;
  /** Optional memo */
  memo?: string;
  /** Optional gRPC configuration */
  grpcConfig?: GRPCConfig;
  /**
   * Optional nonce override. When provided, skips network nonce fetch.
   * WARNING: Manually specified nonces are not validated. Incorrect nonces will cause transaction failure.
   */
  nonce?: string | number | bigint;
}

/**
 * Contract update options
 */
export interface UpdateContractOptions {
  /** Contract ID to update */
  contractId: string;
  /** Contract version (must be current version + 1) */
  contractVersion: bigint;
  /** Public key identifier of the contract owner */
  publicKeyBase58Identifier: string;
  /** Private key in base58 format */
  privateKeyBase58: string;
  /** Optional new contract name */
  name?: string;
  /** Optional governance configuration */
  governance?: Governance;
  /** Optional restricted keys */
  restrictedKeys?: RestrictedKey[];
  /** Optional contract fees */
  contractFees?: ContractFees;
  /** Optional custom parameters */
  customParameters?: KeyValuePair[];
  /** Optional expense ratios */
  expenseRatio?: ExpenseRatio[];
  /** Optional token compliance settings */
  tokenCompliance?: TokenCompliance[];
  /** Optional KYC status */
  kycStatus?: boolean;
  /** Optional immutable KYC status */
  immutableKycStatus?: boolean;
  /** Optional quash threshold */
  quashThreshold?: number;
  /** Optional fee ID (defaults to `KALVORA_NATIVE_TOKEN`) */
  feeId?: string;
  /** Optional fee amount in parts */
  feeAmountParts?: string;
  /** Optional memo */
  memo?: string;
  /** Optional gRPC configuration */
  grpcConfig?: GRPCConfig;
  /**
   * Optional nonce override. When provided, skips network nonce fetch.
   * WARNING: Manually specified nonces are not validated. Incorrect nonces will cause transaction failure.
   */
  nonce?: string | number | bigint;
}

