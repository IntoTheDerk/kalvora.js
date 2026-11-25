/**
 * Smart-contract event receiver.
 *
 * `SmartContractEventsSearch` is the pull API. Subscriptions are push: the
 * validator calls `SmartContractEvents` on a server the wallet registered.
 * Pass each received `SmartContractEventsResponse` to
 * {@link acceptSmartContractEvent}. The signature is over the protobuf
 * encoding with `signature` cleared, using the validator key in `public_key`.
 */

import { clone, toBinary } from '@bufbuild/protobuf';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  ContractResponseSchema,
  SmartContractEventsResponseSchema,
  SmartContractEventsSearchResponseSchema,
  type ContractResponse,
  type SmartContractEventsResponse,
  type SmartContractEventsSearchRequest,
  type SmartContractEventsSearchResponse
} from '../../proto/generated/kal_api_pb.js';
import type { FalconPublicKey } from '../../proto/generated/txn_pb.js';
import { decodeWalletAddress, deriveFalconAddress, falconVariantFromKey, WALLET_HASH } from '../shared/crypto/falcon-address.js';
import { bytesEqual, concatBytes, encodeU64BE } from '../shared/utils/byte-utils.js';
import { verifyFalconSignature } from '../wallet-creation/falcon.js';

export interface AcceptedSmartContractEvent {
  smartContract: string;
  instance: bigint;
  function: string;
  eventData: string[];
  blockHeight: bigint;
  blockHash: string;
  txnHash: string;
  gasUsed: bigint;
  gasApproved: bigint;
  timestamp: Date | undefined;
  event: SmartContractEventsResponse;
}

/** Operator from a trusted validator assignment and its finalized single-key registry binding. */
export interface RegisteredOperator {
  address: string;
  key: FalconPublicKey;
}

export function matchesOperatorAddress(operator: RegisteredOperator): boolean {
  try {
    const raw = decodeWalletAddress(operator.address);
    return falconVariantFromKey(operator.key.rawPublicKey) === operator.key.variant &&
      Object.values(WALLET_HASH).some(hash => bytesEqual(deriveFalconAddress(operator.key.rawPublicKey, hash), raw));
  } catch {
    return false;
  }
}

/** Verify the enclosing concrete protobuf, including embedded event bodies and cursor. */
export function verifyOperatorResponse(
  response: ContractResponse | SmartContractEventsResponse | SmartContractEventsSearchResponse,
  operator: RegisteredOperator
): boolean {
  const signer = response.publicKey;
  if (!signer?.walletAddress || !matchesOperatorAddress(operator) || !bytesEqual(signer.walletAddress, decodeWalletAddress(operator.address)) ||
      signer.single.length || signer.multi || signer.governanceAuth !== undefined ||
      signer.smartContractAuth !== undefined || signer.parentContract !== undefined || signer.witnesses.length) return false;
  const schema = response.$typeName === 'kal_api.ContractResponse' ? ContractResponseSchema
    : response.$typeName === 'kal_api.SmartContractEventsResponse' ? SmartContractEventsResponseSchema
      : SmartContractEventsSearchResponseSchema;
  const unsigned = clone(schema, response);
  unsigned.signature = new Uint8Array();
  return verifyFalconSignature(operator.key.rawPublicKey, toBinary(schema, unsigned), response.signature);
}

export function verifySmartContractEventSignature(event: SmartContractEventsResponse, operator: RegisteredOperator): boolean {
  return verifyOperatorResponse(event, operator);
}

export function eventSearchRequestDigest(request: SmartContractEventsSearchRequest): Uint8Array {
  const encoder = new TextEncoder();
  const id = encoder.encode(request.smartContractId);
  return sha256(concatBytes(encoder.encode('KAL_EVENT_SEARCH_REQUEST_V1'), encodeU64BE(id.length), id,
    encodeU64BE(request.searchStart?.seconds ?? 0n), encodeU64BE(request.searchStart?.nanos ?? 0),
    encodeU64BE(request.pageSize), encodeU64BE(request.pageCursor.length), request.pageCursor));
}

/**
 * Accept one event pushed by a validator.
 *
 * @throws Error when the validator signature does not verify
 */
export function acceptSmartContractEvent(event: SmartContractEventsResponse, operator: RegisteredOperator): AcceptedSmartContractEvent {
  if (!verifySmartContractEventSignature(event, operator)) {
    throw new Error('smart contract event signature did not verify');
  }
  const timestamp = event.timestamp
    ? new Date(Number(event.timestamp.seconds) * 1000 + Math.floor(event.timestamp.nanos / 1_000_000))
    : undefined;
  return {
    smartContract: event.smartContract,
    instance: event.instance,
    function: event.function,
    eventData: event.eventData,
    blockHeight: event.blockHeight,
    blockHash: event.blockHash,
    txnHash: event.txnHash,
    gasUsed: event.gasUsed,
    gasApproved: event.gasApproved,
    timestamp,
    event
  };
}

/**
 * Next timestamp filter after a batch of events. This is not a cursor and
 * does not guarantee complete pagination. Events are pruned after about three days.
 */
export function nextSmartContractEventSearchStart(
  events: readonly { timestamp?: Date }[]
): Date | undefined {
  let newest: Date | undefined;
  for (const event of events) {
    if (!event.timestamp) continue;
    if (!newest || event.timestamp.getTime() > newest.getTime()) newest = event.timestamp;
  }
  return newest ? new Date(newest.getTime() + 1) : undefined;
}
