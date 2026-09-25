/**
 * Byte Utilities
 * 
 * Low-level utilities for byte array manipulation and encoding.
 * These are general-purpose functions used across the SDK for:
 * - Hex encoding/decoding
 * - Integer encoding (LE/BE)
 * - Byte array manipulation
 */

/**
 * Convert a hex string to Uint8Array
 * 
 * @param hex - Hex string (with or without 0x prefix)
 * @returns Uint8Array of bytes
 * 
 * @example
 * ```typescript
 * hexToBytes('deadbeef');     // Uint8Array [0xde, 0xad, 0xbe, 0xef]
 * hexToBytes('0xdeadbeef');   // Uint8Array [0xde, 0xad, 0xbe, 0xef]
 * ```
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 * 
 * @param bytes - Uint8Array to convert
 * @returns Hex string (without 0x prefix)
 * 
 * @example
 * ```typescript
 * bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef])); // 'deadbeef'
 * ```
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Concatenate multiple Uint8Arrays into one
 * 
 * @param arrays - Arrays to concatenate
 * @returns Single concatenated Uint8Array
 * 
 * @example
 * ```typescript
 * concatBytes(new Uint8Array([1, 2]), new Uint8Array([3, 4])); // [1, 2, 3, 4]
 * ```
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Encode a u64 as little-endian bytes
 * 
 * @param value - BigInt, number, or string to encode
 * @returns 8-byte Uint8Array in little-endian format
 */
export function encodeU64LE(value: bigint | number | string): Uint8Array {
  const bigValue = typeof value === 'bigint' ? value : BigInt(value);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, bigValue, true); // true = little-endian
  return new Uint8Array(buffer);
}

/**
 * Encode a u64 as big-endian bytes
 * 
 * @param value - BigInt, number, or string to encode
 * @returns 8-byte Uint8Array in big-endian format
 */
export function encodeU64BE(value: bigint | number | string): Uint8Array {
  const bigValue = typeof value === 'bigint' ? value : BigInt(value);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, bigValue, false); // false = big-endian
  return new Uint8Array(buffer);
}

/**
 * Encode a u32 as little-endian bytes
 * 
 * @param value - Number to encode
 * @returns 4-byte Uint8Array in little-endian format
 */
export function encodeU32LE(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, value, true); // true = little-endian
  return new Uint8Array(buffer);
}

/**
 * Encode a u32 as big-endian bytes
 * 
 * @param value - Number to encode
 * @returns 4-byte Uint8Array in big-endian format
 */
export function encodeU32BE(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, value, false); // false = big-endian
  return new Uint8Array(buffer);
}

/**
 * Encode a u16 as little-endian bytes
 * 
 * @param value - Number to encode
 * @returns 2-byte Uint8Array in little-endian format
 */
export function encodeU16LE(value: number): Uint8Array {
  const buffer = new ArrayBuffer(2);
  const view = new DataView(buffer);
  view.setUint16(0, value, true); // true = little-endian
  return new Uint8Array(buffer);
}

/**
 * Encode a u16 as big-endian bytes
 * 
 * @param value - Number to encode
 * @returns 2-byte Uint8Array in big-endian format
 */
export function encodeU16BE(value: number): Uint8Array {
  const buffer = new ArrayBuffer(2);
  const view = new DataView(buffer);
  view.setUint16(0, value, false); // false = big-endian
  return new Uint8Array(buffer);
}

/**
 * Decode a u64 from little-endian bytes
 * 
 * @param bytes - 8-byte Uint8Array in little-endian format
 * @returns BigInt value
 */
export function decodeU64LE(bytes: Uint8Array): bigint {
  if (bytes.length !== 8) {
    throw new Error('decodeU64LE requires exactly 8 bytes');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getBigUint64(0, true);
}

/**
 * Decode a u64 from big-endian bytes
 * 
 * @param bytes - 8-byte Uint8Array in big-endian format
 * @returns BigInt value
 */
export function decodeU64BE(bytes: Uint8Array): bigint {
  if (bytes.length !== 8) {
    throw new Error('decodeU64BE requires exactly 8 bytes');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getBigUint64(0, false);
}

/**
 * Decode a u32 from little-endian bytes
 * 
 * @param bytes - 4-byte Uint8Array in little-endian format
 * @returns Number value
 */
export function decodeU32LE(bytes: Uint8Array): number {
  if (bytes.length !== 4) {
    throw new Error('decodeU32LE requires exactly 4 bytes');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true);
}

/**
 * Compare two Uint8Arrays for equality
 * 
 * @param a - First array
 * @param b - Second array
 * @returns true if arrays are equal
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Zero-pad or truncate bytes to a fixed length
 * 
 * @param bytes - Input bytes
 * @param length - Target length
 * @param padStart - If true, pad/truncate from start; if false, from end
 * @returns Fixed-length Uint8Array
 */
export function fixedBytes(bytes: Uint8Array, length: number, padStart = false): Uint8Array {
  if (bytes.length === length) return bytes;
  
  const result = new Uint8Array(length);
  if (bytes.length > length) {
    // Truncate
    const offset = padStart ? bytes.length - length : 0;
    result.set(bytes.slice(offset, offset + length));
  } else {
    // Pad
    const offset = padStart ? length - bytes.length : 0;
    result.set(bytes, offset);
  }
  return result;
}
