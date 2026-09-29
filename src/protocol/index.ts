/**
 * Raw protocol bindings.
 *
 * The generated protobuf-es v2 modules for every Kalvora service, grouped by
 * proto package. Use these for fields and messages the higher-level SDK does
 * not wrap, together with `create`, `toBinary`, and `fromBinary` from
 * `@bufbuild/protobuf`.
 *
 * @example
 * ```typescript
 * import { create, toBinary } from '@bufbuild/protobuf';
 * import { proto } from 'kalvora.js';
 *
 * const pk = create(proto.txn.PublicKeySchema, { single: bytes });
 * const wrapper = create(proto.txn.TXNWrapperSchema, { payload: { case: 'coinTxn', value: coinTxn } });
 * const bytes = toBinary(proto.txn.TXNWrapperSchema, wrapper);
 * ```
 *
 * | Namespace   | Proto package     | Service            |
 * |-------------|-------------------|--------------------|
 * | `txn`       | `kal_txn`        | `TXNService`       |
 * | `api`       | `kal_api`        | `APIService`       |
 * | `validator` | `kal_validator`  | `ValidatorService` |
 * | `guardian`  | guardian package  | `GuardianService`  |
 *
 * The bridge guardian service uses its own protobuf package. Kalvora names
 * for its Kalvora-side identifiers (`NETWORK_TYPE_KALVORA`,
 * `KalvoraGuardianPayload`, ...) are exported from the package root.
 *
 * @module protocol
 */

export * as txn from '../../proto/generated/txn_pb.js';
export * as api from '../../proto/generated/kal_api_pb.js';
export * as validator from '../../proto/generated/validator_pb.js';
export * as guardian from '../../proto/generated/guardian_pb.js';
