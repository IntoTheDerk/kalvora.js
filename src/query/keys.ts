/**
 * Binary database keys.
 *
 * `db_key::item_contract` is not text concatenation. Each component is a
 * 4-byte big-endian length followed by its bytes. The API `Database` key
 * field is a string, so the bytes are transported as latin-1.
 */

import bs58 from 'bs58';

import { isPaymentRecipientBytes } from '../shared/crypto/address-utils.js';

const TEXT = new TextEncoder();

/** Balance and nonce also accept the burn wallet and the "p_" + 32-byte proposal escrow. */
export function decodeBalanceNonceAddress(address: string): Uint8Array {
  if (typeof address !== 'string' || !address.trim()) throw new Error('address must be a non-empty base58 address');
  const text = address.trim();
  // Native MAX_QUERY_ENCODED_ADDRESS_BYTES bounds Base58 conversion work.
  const raw = text.length <= Math.floor(1126 * 138 / 100) + 1 ? bs58.decodeUnsafe(text) : undefined;
  if (raw && (isPaymentRecipientBytes(raw) || (raw.length === 34 && raw[0] === 0x70 && raw[1] === 0x5f))) return raw;
  throw new Error('address is not a valid base58 address for a balance or nonce query');
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function component(value: string): Uint8Array {
  const bytes = TEXT.encode(value);
  const out = new Uint8Array(4 + bytes.length);
  out.set(u32(bytes.length), 0);
  out.set(bytes, 4);
  return out;
}

/** Key for `DATABASE_TYPE.CONTRACT_ITEMS`. */
export function itemContractDatabaseKey(itemId: string, contractId: string): string {
  const item = component(itemId);
  const contract = component(contractId);
  const bytes = new Uint8Array(item.length + contract.length);
  bytes.set(item, 0);
  bytes.set(contract, item.length);
  let key = '';
  for (const byte of bytes) key += String.fromCharCode(byte);
  return key;
}

/** Decode a database value that the node sent as a binary string. */
export function latin1ToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0xff) throw new Error('database value is not a binary string');
    bytes[i] = code;
  }
  return bytes;
}
