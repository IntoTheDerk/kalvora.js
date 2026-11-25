import { create } from '@bufbuild/protobuf';
import type { Client } from '@connectrpc/connect';

import type { TokenFeeInfoResponse, NonceResponse, BalanceResponse, BaseFeeResponse, SigningWalletResponse, ProposalDetailRequest, ProposalDetailResponse } from '../../../proto/generated/kal_api_pb.js';
import { APIService } from '../../../proto/generated/kal_api_pb.js';
import { NonceRequestSchema, TokenFeeInfoRequestSchema, BalanceRequestSchema, BaseFeeRequestSchema } from '../../../proto/generated/kal_api_pb.js';
import type { PublicKey } from '../../../proto/generated/txn_pb.js';
import { PublicKeySchema, TRANSACTION_TYPE } from '../../../proto/generated/txn_pb.js';
import { sanitizeAndDecodeAddress } from '../../shared/crypto/address-utils.js';
import { decodeWalletAddress, isWalletAddressBytes } from '../../shared/crypto/falcon-address.js';
import type { GRPCConfig } from '../../types/index.js';
import { createClient } from '../client-factory.js';

/**
 * Validator API client interface
 */
export function additionalFeeSigner(identity: string | PublicKey): PublicKey {
  if (typeof identity === 'string') return create(PublicKeySchema, { walletAddress: decodeWalletAddress(identity) });
  if (!identity.walletAddress || !isWalletAddressBytes(identity.walletAddress) || identity.witnesses.length ||
      identity.single.length || identity.multi || identity.smartContractAuth !== undefined ||
      identity.governanceAuth !== undefined || identity.parentContract !== undefined) {
    throw new Error('Additional fee signer must contain only a registered wallet address');
  }
  return identity;
}

export interface ValidatorAPIClient {
  /**
   * Get nonce for an address
   */
  getNonce(address: string): Promise<NonceResponse>;
    
  /**
   * Get comprehensive token fee information
   */
  getTokenFeeInfo(request: { contractIds: string[] }): Promise<TokenFeeInfoResponse>;
  
  /**
   * Get balance for an address and contract ID
   */
  getBalance(address: string, contractId: string): Promise<BalanceResponse>;

  /**
   * Get base fee info for a transaction type and public key
   */
  getBaseFee(publicKey: PublicKey | undefined, txnType: TRANSACTION_TYPE, additionalSigner?: PublicKey): Promise<BaseFeeResponse>;
  getSigningWallet(address: string): Promise<SigningWalletResponse>;
  proposalDetail(request: ProposalDetailRequest): Promise<ProposalDetailResponse>;
}

/**
 * Validator API Client Class
 */
class ValidatorAPIClientImpl implements ValidatorAPIClient {
  private client: Client<typeof APIService>;

  constructor(options: GRPCConfig = {}) {
    const config = { ...options };
    this.client = createClient(APIService, config);
  }

  /**
   * Get nonce for an address
   */
  async getNonce(address: string): Promise<NonceResponse> {
    const request = create(NonceRequestSchema, {
      walletAddress: new Uint8Array(sanitizeAndDecodeAddress(address)),
      encoded: false
    });
    return this.client.nonce(request);
  }

  /**
   * Get comprehensive token fee information
   */
  async getTokenFeeInfo(request: { contractIds: string[] }): Promise<TokenFeeInfoResponse> {
    const protoRequest = create(TokenFeeInfoRequestSchema, {
      contractIds: request.contractIds
    });
    return this.client.getTokenFeeInfo(protoRequest);
  }

  /**
   * Get balance for an address and contract ID
   */
  async getBalance(address: string, contractId: string): Promise<BalanceResponse> {
    const request = create(BalanceRequestSchema, {
      walletAddress: new Uint8Array(sanitizeAndDecodeAddress(address)),
      contractId: contractId,
      encoded: false
    });
    return this.client.balance(request);
  }

  /**
   * Get base fee info for a transaction type and public key
   */
  async getBaseFee(publicKey: PublicKey | undefined, txnType: TRANSACTION_TYPE, additionalSigner?: PublicKey): Promise<BaseFeeResponse> {
    const request = create(BaseFeeRequestSchema, {
      ...(publicKey ? { publicKey } : {}),
      ...(additionalSigner ? { additionalSigner: additionalFeeSigner(additionalSigner) } : {}),
      txnType: txnType
    });
    return this.client.baseFee(request);
  }

  getSigningWallet(address: string): Promise<SigningWalletResponse> {
    return this.client.getSigningWallet({ walletAddress: decodeWalletAddress(address) });
  }

  proposalDetail(request: ProposalDetailRequest): Promise<ProposalDetailResponse> {
    return this.client.proposalDetail(request);
  }
}

/**
 * Create a pre-configured validator API client
 */
export function createValidatorAPIClient(options: GRPCConfig = {}): ValidatorAPIClient {
  return new ValidatorAPIClientImpl(options);
}
