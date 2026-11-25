/**
 * Shared utilities for standard (non-CoinTXN) transactions
 */

import { protoInt64, create } from '@bufbuild/protobuf';

import { TimestampSchema } from '../../../proto/generated/google/protobuf/timestamp_pb.js';
import { BaseTXNSchema, PublicKeySchema } from '../../../proto/generated/txn_pb.js';
import type { BaseTXN } from '../../../proto/generated/txn_pb.js';
import { getNonce as fetchNonce } from '../../api/handler/nonce/service.js';
import { generateAddressFromPublicKey, getPublicKeyBytes } from '../../shared/crypto/address-utils.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { transactionContextFields, type TransactionContext } from '../../sign/context.js';
import type { GRPCConfig } from '../../types/index.js';
import { decodeWalletAddress } from '../crypto/falcon-address.js';

/** Registered wallets use their selected address. Prefixed keys decode historical envelopes. */
export function signerPublicKey(identity: string) {
  if (identity.startsWith('sc_')) return create(PublicKeySchema, { smartContractAuth: new TextEncoder().encode(identity) });
  if (identity.startsWith('gov_')) return create(PublicKeySchema, { governanceAuth: new TextEncoder().encode(identity) });
  return create(PublicKeySchema, identity.includes('_')
    ? { single: getPublicKeyBytes(identity) }
    : { walletAddress: decodeWalletAddress(identity) });
}

/**
 * Build a standard BaseTXN (includes public key and nonce)
 */
export function buildStandardBaseTXN(
  params: {
    publicKeyId: string;
    feeId?: string;
    feeAmountParts?: string;
    nonce: bigint;
    memo?: string;
    timestamp?: Date;
    context?: TransactionContext;
  },
  transactionTypeName: string
): BaseTXN {
  const { publicKeyId, nonce, memo } = params;
  const finalFeeId = params.feeId || KALVORA_NATIVE_TOKEN;
  const finalFeeAmount = params.feeAmountParts || '1';
  if (!finalFeeAmount || finalFeeAmount === '0') {
    throw new Error('Base fee must be provided and cannot be 0');
  }

  const now = params.timestamp ?? new Date();
  const timestampMilliseconds = now instanceof Date ? now.getTime() : Number.NaN;
  const earliestProtobufTimestamp = Date.parse('0001-01-01T00:00:00.000Z');
  const latestProtobufTimestamp = Date.parse('9999-12-31T23:59:59.999Z');
  if (
    !Number.isFinite(timestampMilliseconds) ||
    timestampMilliseconds < earliestProtobufTimestamp ||
    timestampMilliseconds > latestProtobufTimestamp
  ) {
    throw new Error('Base transaction timestamp must be a valid protobuf Date');
  }
  const timestampSeconds = Math.floor(timestampMilliseconds / 1000);
  const timestamp = create(TimestampSchema, {
    seconds: protoInt64.parse(timestampSeconds),
    nanos: (timestampMilliseconds - timestampSeconds * 1000) * 1000000
  });

  const publicKey = signerPublicKey(publicKeyId);
  if (publicKey.walletAddress && nonce <= 0n) throw new Error('A registered wallet needs a positive next nonce');

  const base: Record<string, unknown> = {
    ...transactionContextFields(transactionTypeName, params.context),
    publicKey,
    timestamp,
    feeAmount: String(finalFeeAmount),
    feeId: finalFeeId,
    nonce
  };
  if (memo && memo.trim() !== '') base.memo = memo;

  return create(BaseTXNSchema, base);
}

/**
 * Derive address from public key identifier and fetch its nonce
 */
export async function getAddressAndNonce(
  publicKeyId: string,
  grpcConfig: GRPCConfig = {}
): Promise<{ address: string; nonce: bigint }> {
  const address = publicKeyId.includes('_') ? generateAddressFromPublicKey(publicKeyId) : publicKeyId;
  const nonceDecimal = await fetchNonce(address, grpcConfig);
  const nonce = protoInt64.uParse(nonceDecimal.toString());
  return { address, nonce };
}
