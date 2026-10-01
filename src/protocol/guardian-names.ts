/**
 * Kalvora names for guardian protocol identifiers.
 *
 * The bridge guardian service has its own protobuf package (`kal_guardian`).
 * This module gives the identifiers for the Kalvora side of the bridge stable
 * SDK names (`NETWORK_TYPE_KALVORA`, `KalvoraGuardian*Payload`, ...) that SDK
 * code and documentation use; the raw generated bindings remain available
 * under `proto.guardian`.
 *
 * @module protocol/guardian-names
 */

import {
  NETWORK_TYPE,
  type KalContractPayload,
  type KalMintPayload,
  type KalPayload,
  type KalRefundPayload,
  type KalReleasePayload
} from '../../proto/generated/guardian_pb.js';

/**
 * Guardian `NETWORK_TYPE` value that identifies the Kalvora network
 * (numeric value `0`). Pass it to `GuardianQueryClient.getPayload()` when the
 * source transaction is a Kalvora transaction.
 */
export const NETWORK_TYPE_KALVORA = NETWORK_TYPE.KALVORA; // wire value; fixed by the guardian protocol

/**
 * `PayloadResponse.payload.case` for a guardian-signed payload destined for
 * Kalvora (a Solana → Kalvora transfer).
 */
export const GUARDIAN_KALVORA_PAYLOAD_CASE = 'kalPayload' as const; // generated case name of the guardian proto's `kal_payload` field

/** Guardian-signed payload for a Solana → Kalvora transfer (release, mint or contract creation). */
export type KalvoraGuardianPayload = KalPayload;

/** Kalvora-side payload: create a wrapped token contract for a new Solana mint. */
export type KalvoraGuardianContractPayload = KalContractPayload;

/** Kalvora-side payload: mint wrapped tokens for an existing Solana mint. */
export type KalvoraGuardianMintPayload = KalMintPayload;

/** Kalvora-side payload: release previously locked Kalvora tokens. */
export type KalvoraGuardianReleasePayload = KalReleasePayload;

/** Kalvora-side payload: refund a failed bridge transfer. */
export type KalvoraGuardianRefundPayload = KalRefundPayload;
