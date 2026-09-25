/**
 * Kalvora Transaction Signing — Signer Abstractions
 *
 * Defines the `KalvoraSigner` interface for decoupled transaction signing,
 * and a built-in `KeyPairSigner` implementation for direct private-key usage.
 *
 * @module sign/signer
 *
 * @example
 * ```typescript
 * import { KeyPairSigner } from 'kalvora.js';
 *
 * // Backend / CLI usage — sign with a local private key
 * const signer = new KeyPairSigner(publicKey, privateKey);
 * const signature = await signer.sign(transactionBytes);
 *
 * // Browser wallet — implement KalvoraSigner
 * const walletSigner: KalvoraSigner = {
 *   publicKey: wallet.publicKey,
 *   sign: (data) => wallet.signTransaction(data),
 * };
 * ```
 */

import { signTransactionData } from '../shared/crypto/signature-utils.js';

// ============================================================================
// SIGNER INTERFACE
// ============================================================================

/**
 * Universal signer interface for Kalvora transactions.
 *
 * Any entity capable of producing a cryptographic signature can implement
 * this interface — private keys, browser wallets, hardware wallets, etc.
 */
export interface KalvoraSigner {
  /** Base58-encoded public key identifier (used to derive address and verify signatures) */
  readonly publicKey: string;

  /**
   * Sign arbitrary transaction bytes and return the raw signature.
   *
   * @param data - The serialized transaction bytes to sign
   * @returns The raw signature bytes (Ed25519 — 64 bytes, Ed448 — 114 bytes)
   */
  sign(data: Uint8Array): Promise<Uint8Array>;
}

// ============================================================================
// KEY PAIR SIGNER
// ============================================================================

/**
 * Built-in signer that uses a local private key.
 *
 * Wraps the SDK's existing `signTransactionData` utility, providing
 * backwards-compatible signing for backend services, CLI tools, and tests.
 *
 * @example
 * ```typescript
 * const signer = new KeyPairSigner(
 *   'A_9Xk3...',         // Ed25519 public key identifier
 *   '5Jd8HkR...'          // private key (base58)
 * );
 *
 * const sig = await signer.sign(txBytes);
 * ```
 */
export class KeyPairSigner implements KalvoraSigner {
  readonly publicKey: string;
  private readonly privateKey: string;

  /**
   * @param publicKey  - Base58-encoded public key identifier (e.g. 'A_9Xk3...')
   * @param privateKey - Base58-encoded private key
   */
  constructor(publicKey: string, privateKey: string) {
    if (!publicKey) throw new Error('publicKey is required');
    if (!privateKey) throw new Error('privateKey is required');
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  /**
   * Sign transaction bytes using the local private key.
   * Automatically detects key type (Ed25519 / Ed448) from the public key identifier.
   */
  async sign(data: Uint8Array): Promise<Uint8Array> {
    return signTransactionData(data, this.privateKey, this.publicKey);
  }
}
