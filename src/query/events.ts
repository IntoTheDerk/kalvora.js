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
import { ed25519 } from '@noble/curves/ed25519.js';
import { ed448 } from '@noble/curves/ed448.js';

import {
  SmartContractEventsResponseSchema,
  type SmartContractEventsResponse
} from '../../proto/generated/kal_api_pb.js';

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

function splitKey(single: Uint8Array): { prefix: string; raw: Uint8Array } {
  const underscore = single.lastIndexOf(0x5f, 3);
  if (underscore < 0) throw new Error('validator public key has no prefix');
  return {
    prefix: String.fromCharCode(...single.subarray(0, underscore + 1)),
    raw: single.subarray(underscore + 1)
  };
}

/** Verify the validator signature on a pushed or searched event. */
export function verifySmartContractEventSignature(event: SmartContractEventsResponse): boolean {
  const single = event.publicKey?.single;
  if (!single || single.length === 0 || event.signature.length === 0) return false;
  const unsigned = clone(SmartContractEventsResponseSchema, event);
  unsigned.signature = new Uint8Array();
  const message = toBinary(SmartContractEventsResponseSchema, unsigned);
  const { prefix, raw } = splitKey(single);
  if (prefix === 'A_') return ed25519.verify(event.signature, message, raw);
  if (prefix === 'B_') return ed448.verify(event.signature, message, raw);
  return false;
}

/**
 * Accept one event pushed by a validator.
 *
 * @throws Error when the validator signature does not verify
 */
export function acceptSmartContractEvent(event: SmartContractEventsResponse): AcceptedSmartContractEvent {
  if (!verifySmartContractEventSignature(event)) {
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
 * Next `search_start` after a page of events. Events are oldest-first and
 * pruned after about three days.
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
