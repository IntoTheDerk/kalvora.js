/**
 * Wallet Adapter - Transaction Serialization
 *
 * Universal, protobuf-driven encoding/decoding for Kalvora transactions.
 * Instead of hardcoding supported types, this module auto-discovers all
 * protobuf message schemas from the generated `txn_pb` module at runtime.
 *
 * Any new protobuf message type added to `txn_pb.ts` is automatically
 * supported — no code changes needed here.
 *
 * @module adapter/serialization
 */

import { type Message, type DescMessage, toBinary, fromBinary } from '@bufbuild/protobuf';

import * as txn_pb from '../../proto/generated/txn_pb.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A serialized transaction envelope containing the protobuf type name
 * and the base64-encoded binary data.
 */
export interface SerializedTransaction {
  /** Fully-qualified protobuf type name (e.g., "zera_txn.CoinTXN") */
  type: string;
  /** Base64-encoded protobuf bytes */
  data: string;
  /** Serialization format version (for forward compatibility) */
  version: 1;
}

// ============================================================================
// PROTOBUF TYPE REGISTRY (auto-populated from generated code)
// ============================================================================

/**
 * Auto-discovered registry: maps protobuf type names to their schema descriptors.
 *
 * At module load time, we iterate over all exports from `txn_pb` and register
 * any export ending in "Schema" that has a `typeName` property — i.e., any
 * generated protobuf message schema (v2 API).
 */
const schemaRegistry = new Map<string, DescMessage>();

// Populate the registry from all txn_pb exports
for (const [key, exported] of Object.entries(txn_pb)) {
  // In protobuf-es v2, schemas are named like "CoinTXNSchema" and are plain objects
  // with a `typeName` property (from DescMessage)
  if (
    key.endsWith('Schema') &&
    exported !== null &&
    typeof exported === 'object' &&
    'typeName' in exported &&
    typeof (exported as DescMessage).typeName === 'string'
  ) {
    const schema = exported as DescMessage;
    schemaRegistry.set(schema.typeName, schema);
  }
}

// ============================================================================
// BASE64 (Works in Node, browsers, and React Native)
// ============================================================================

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// PUBLIC UTILITY — Schema Lookup
// ============================================================================

/**
 * Look up the schema descriptor for a protobuf message by its `$typeName`.
 * Used by `finalize.ts` for generic `toBinary(schema, message)` calls.
 */
export function getSchemaForTypeName(typeName: string): DescMessage | undefined {
  return schemaRegistry.get(typeName);
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Serialize any protobuf transaction into a portable string envelope.
 *
 * Uses the protobuf's `$typeName` property (e.g., `"zera_txn.CoinTXN"`)
 * as the type discriminator, so **every** generated protobuf message type
 * is supported automatically — no manual mapping needed.
 *
 * @param txn - Any protobuf message (CoinTXN, GovernanceVote, etc.)
 * @param schema - The schema descriptor for the message type
 * @returns A `SerializedTransaction` envelope
 *
 * @example
 * ```typescript
 * import { CoinTXNSchema } from '../../proto/generated/txn_pb.js';
 * const envelope = serializeTransaction(coinTxn, CoinTXNSchema);
 * // envelope.type === "zera_txn.CoinTXN"
 * const json = JSON.stringify(envelope); // send over the wire
 * ```
 */
export function serializeTransaction(txn: Message, schema?: DescMessage): SerializedTransaction {
  const typeName = txn.$typeName;

  // If schema is provided, use it directly; otherwise look it up
  const resolvedSchema = schema || schemaRegistry.get(typeName);
  if (!resolvedSchema) {
    throw new Error(`Unknown protobuf type "${typeName}" — not found in txn_pb registry`);
  }

  return {
    type: typeName,
    data: toBase64(toBinary(resolvedSchema, txn)),
    version: 1
  };
}

/**
 * Deserialize a `SerializedTransaction` envelope back into a protobuf object.
 *
 * Looks up the type name in the auto-populated registry and calls `fromBinary`
 * on the corresponding schema.
 *
 * @param envelope - The serialized envelope (or its JSON string representation)
 * @returns The reconstructed protobuf message
 *
 * @example
 * ```typescript
 * const txn = deserializeTransaction(envelope);
 * if (txn.$typeName === 'zera_txn.CoinTXN') { ... }
 * ```
 */
export function deserializeTransaction(envelope: SerializedTransaction | string): Message {
  const parsed: SerializedTransaction = typeof envelope === 'string'
    ? JSON.parse(envelope) as SerializedTransaction
    : envelope;

  if (!parsed.type || !parsed.data) {
    throw new Error('Invalid serialized transaction: missing type or data');
  }
  if (parsed.version !== 1) {
    throw new Error(`Unsupported serialization version: ${parsed.version}`);
  }

  const schema = schemaRegistry.get(parsed.type);
  if (!schema) {
    throw new Error(
      `Unknown protobuf type "${parsed.type}" — not found in registry. ` +
      `Available types: ${[...schemaRegistry.keys()].join(', ')}`
    );
  }

  const bytes = fromBase64(parsed.data);
  return fromBinary(schema, bytes);
}

/**
 * Get all registered protobuf type names.
 * Useful for debugging or discovering available types.
 *
 * @returns Array of fully-qualified protobuf type names
 */
export function getRegisteredTypes(): string[] {
  return [...schemaRegistry.keys()];
}
