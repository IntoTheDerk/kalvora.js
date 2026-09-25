/**
 * Validator Query Client — read-only subset of `zera_validator.ValidatorService`.
 *
 * `ValidatorService` is primarily a node-to-node protocol (block sync,
 * gossip, attestation streams). This client wraps only the operations that are
 * useful to applications and node operators:
 *
 * | Method                 | RPC                 | Auth                    |
 * |------------------------|---------------------|-------------------------|
 * | {@link getNonce}       | `Nonce`             | none                    |
 * | {@link getBalance}     | `Balance`           | none                    |
 * | {@link getCheckpointInfo} | `GetCheckpointInfo` | signed request       |
 * | {@link syncValidatorList} | `SyncValidatorList` | signed request       |
 *
 * ## Signed requests
 * Authenticated requests carry the caller's `public_key` and a `signature`
 * over the protobuf encoding of the request **with `signature` unset**
 * (verified against a live node). The node also rejects timestamps that are
 * too far from its clock, so build requests right before sending them.
 *
 * Streaming and block-production RPCs are intentionally not exposed; use the
 * raw client (`.raw`) if you operate a validator.
 *
 * @module query/validator-client
 */

import { create, toBinary } from '@bufbuild/protobuf';
import type { Client } from '@connectrpc/connect';

import { TimestampSchema } from '../../proto/generated/google/protobuf/timestamp_pb.js';
import { PublicKeySchema, type Validator } from '../../proto/generated/txn_pb.js';
import {
  BalanceRequestSchema,
  CheckpointInfoRequestSchema,
  NonceRequestSchema,
  ValidatorService,
  ValidatorSyncRequestSchema
} from '../../proto/generated/validator_pb.js';
import { createClient } from '../grpc/client-factory.js';
import { getPublicKeyBytes } from '../shared/crypto/address-utils.js';
import { parseAddress, requireContractId, toTimestampInit } from '../shared/tx/standard.js';
import { bytesToHex } from '../shared/utils/byte-utils.js';
import type { KalvoraSigner } from '../sign/signer.js';
import type { GRPCConfig } from '../types/index.js';

import { parseUintString } from './decoders.js';

/** Latest validator state checkpoint advertised by a node. */
export interface CheckpointInfo {
  /** Checkpoint version identifier, e.g. `v100002`. */
  version: string;
  /** Block height captured by the checkpoint. */
  blockHeight: bigint;
  /** Lower-case hex hash of the checkpoint block. */
  blockHash: string;
  /** Size of the checkpoint archive (tar.gz) in bytes. */
  totalSize: bigint;
  /** Creation time. */
  createdAt: Date | undefined;
}

/**
 * Typed client for the read-only subset of `zera_validator.ValidatorService`.
 * Construct with {@link createValidatorQueryClient}.
 */
export class ValidatorQueryClient {
  /** Raw generated ConnectRPC client (errors normalised to `KalvoraRpcError`). */
  readonly raw: Client<typeof ValidatorService>;

  /** @param config - Endpoint / transport configuration */
  constructor(config: GRPCConfig = {}) {
    this.raw = createClient(ValidatorService, config);
  }

  /**
   * Current nonce of a wallet as seen by the validator.
   *
   * Unlike `APIService.Nonce`, validators report unknown wallets as an error
   * (`CANCELED: Wallet address does not exist.`).
   */
  async getNonce(address: string): Promise<bigint> {
    const response = await this.raw.nonce(create(NonceRequestSchema, {
      walletAddress: parseAddress(address, 'address')
    }));
    return response.nonce;
  }

  /** Balance (smallest units) of one token in a wallet, as seen by the validator. */
  async getBalance(address: string, contractId: string): Promise<bigint> {
    const response = await this.raw.balance(create(BalanceRequestSchema, {
      walletAddress: parseAddress(address, 'address'),
      contractId: requireContractId(contractId),
      encoded: false
    }));
    return parseUintString(response.balance, 'balance');
  }

  /**
   * Latest state checkpoint of the node (signed request).
   *
   * @param signer - Any signer; the node verifies the signature but does not
   *   require the key to belong to a validator.
   * @param now - Request timestamp (default: current time)
   * @throws KalvoraRpcError `NOT_FOUND` when the node has no checkpoint,
   *   `UNAUTHENTICATED` on a bad signature, `INVALID_ARGUMENT` on clock skew
   */
  async getCheckpointInfo(signer: KalvoraSigner, now: Date = new Date()): Promise<CheckpointInfo> {
    const request = create(CheckpointInfoRequestSchema, {
      publicKey: create(PublicKeySchema, { single: new Uint8Array(getPublicKeyBytes(signer.publicKey)) }),
      timestamp: create(TimestampSchema, toTimestampInit(now, 'now'))
    });
    request.signature = await signer.sign(toBinary(CheckpointInfoRequestSchema, request));
    const response = await this.raw.getCheckpointInfo(request);
    const created = response.createdAt;
    return {
      version: response.version,
      blockHeight: response.blockHeight,
      blockHash: bytesToHex(response.blockHash),
      totalSize: response.totalSize,
      createdAt: created ? new Date(Number(created.seconds) * 1000 + Math.floor(created.nanos / 1_000_000)) : undefined
    };
  }

  /**
   * Current validator set (signed request).
   *
   * Note: public gateways commonly do not route this RPC and answer
   * `UNIMPLEMENTED`; call a validator directly.
   */
  async syncValidatorList(signer: KalvoraSigner): Promise<Validator[]> {
    const request = create(ValidatorSyncRequestSchema, {
      publicKey: create(PublicKeySchema, { single: new Uint8Array(getPublicKeyBytes(signer.publicKey)) })
    });
    request.signature = await signer.sign(toBinary(ValidatorSyncRequestSchema, request));
    const response = await this.raw.syncValidatorList(request);
    return response.validators;
  }
}

/**
 * Create a {@link ValidatorQueryClient}.
 *
 * @param config - Endpoint / transport configuration
 */
export function createValidatorQueryClient(config: GRPCConfig = {}): ValidatorQueryClient {
  return new ValidatorQueryClient(config);
}
