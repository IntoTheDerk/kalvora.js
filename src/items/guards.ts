/**
 * Online checks for NFT and SBT item transactions.
 *
 * Skipped when the caller supplies both a nonce and a fee, so offline
 * construction stays deterministic.
 */

import bs58 from 'bs58';

import { CONTRACT_TYPE, type InstrumentContract } from '../../proto/generated/txn_pb.js';
import type { NFT } from '../../proto/generated/validator_pb.js';
import { createQueryClient } from '../query/api-client.js';
import { generateAddressFromPublicKey } from '../shared/crypto/address-utils.js';
import type { GRPCConfig } from '../types/index.js';

import { itemFeeParts } from './item-fee.js';

export async function assertCollectionType(
  contractId: string,
  expected: CONTRACT_TYPE,
  grpcConfig: GRPCConfig | undefined,
  label: string
): Promise<InstrumentContract> {
  const info = await createQueryClient(grpcConfig ?? {}).getContract(contractId);
  if (info.contract.type !== expected) {
    const actual = CONTRACT_TYPE[info.contract.type] ?? String(info.contract.type);
    throw new Error(`${label} requires a ${CONTRACT_TYPE[expected]} collection (contract type is ${actual})`);
  }
  return info.contract;
}

/** The item's holder must be the wallet derived from the signer's public key. */
export async function assertItemHeldBy(
  contractId: string,
  itemId: string,
  publicKey: string,
  grpcConfig: GRPCConfig | undefined
): Promise<NFT> {
  const item = await createQueryClient(grpcConfig ?? {}).getContractItem(itemId, contractId);
  const holder = item.holderAddress.length > 0 ? bs58.encode(item.holderAddress) : '';
  const wallet = generateAddressFromPublicKey(publicKey);
  if (holder !== wallet) {
    throw new Error(`item ${itemId} is held by ${holder || 'nobody'}, not ${wallet}`);
  }
  return item;
}

/**
 * When the item has `ItemContractFees`, the authorized amount must cover
 * `(fee-token denomination * item fee) / rate`, with rate `1` replaced by 10^18.
 */
export function assertItemFeeAuthorized(
  item: NFT,
  contractFeeAmount: string | undefined,
  feeTokenDenomination: string | undefined,
  feeTokenRate: string | undefined
): void {
  const fee = item.contractFees?.fee;
  if (!fee || fee === '0') return;
  if (contractFeeAmount === undefined || feeTokenDenomination === undefined) {
    throw new Error('this item has contract fees; set contractFeeId and contractFeeAmountParts');
  }
  const required = BigInt(itemFeeParts(fee, feeTokenDenomination, feeTokenRate));
  if (BigInt(contractFeeAmount) < required) {
    throw new Error(`contractFeeAmountParts must be at least ${required.toString()}`);
  }
}
