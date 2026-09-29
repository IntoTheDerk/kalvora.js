/**
 * Kalvora names for guardian protocol identifiers.
 *
 * The bridge guardian service uses its own protobuf package, whose generated
 * enum values, message names and oneof cases for the Kalvora side of the bridge
 * carry the network's former name. Those identifiers are part of the guardian
 * wire protocol and cannot change, so this module gives them Kalvora names.
 * SDK code and documentation use these names; the raw generated bindings
 * remain available under `proto.guardian`.
 *
 * @module protocol/guardian-names
 */

import {
  NETWORK_TYPE,
  type ZeraContractPayload,
  type ZeraMintPayload,
  type ZeraPayload,
  type ZeraRefundPayload,
  type ZeraReleasePayload
} from '../../proto/generated/guardian_pb.js';

/**
 * Guardian `NETWORK_TYPE` value that identifies the Kalvora network
 * (numeric value `0`). Pass it to `GuardianQueryClient.getPayload()` when the
 * source transaction is a Kalvora transaction.
 */
export const NETWORK_TYPE_KALVORA = NETWORK_TYPE.ZERA; // wire value; fixed by the guardian protocol

/**
 * `PayloadResponse.payload.case` for a guardian-signed payload destined for
 * Kalvora (a Solana → Kalvora transfer).
 */
export const GUARDIAN_KALVORA_PAYLOAD_CASE = 'zeraPayload' as const; // wire value; fixed by the guardian protocol

/** Guardian-signed payload for a Solana → Kalvora transfer (release, mint or contract creation). */
export type KalvoraGuardianPayload = ZeraPayload;

/** Kalvora-side payload: create a wrapped token contract for a new Solana mint. */
export type KalvoraGuardianContractPayload = ZeraContractPayload;

/** Kalvora-side payload: mint wrapped tokens for an existing Solana mint. */
export type KalvoraGuardianMintPayload = ZeraMintPayload;

/** Kalvora-side payload: release previously locked Kalvora tokens. */
export type KalvoraGuardianReleasePayload = ZeraReleasePayload;

/** Kalvora-side payload: refund a failed bridge transfer. */
export type KalvoraGuardianRefundPayload = ZeraRefundPayload;
