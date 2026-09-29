/**
 * Kalvora Transaction Signing Module
 *
 * @module sign
 *
 * @example
 * ```typescript
 * import { KeyPairSigner, signAndFinalize, signWithKey } from 'kalvora.js';
 *
 * // External signer
 * const signed = await signAndFinalize(txn, new KeyPairSigner(pub, priv));
 *
 * // Private key
 * signWithKey(txn, privateKey, publicKeyId);
 * ```
 */

// Signer interface and implementations
export {
  type KalvoraSigner,
  KeyPairSigner
} from './signer.js';

// Signing workflows
export {
  signAndFinalize,
  signWithKey,
  signCoinTXN,
  signCoinTXNWithKeys,
  type CoinTXNKeyPair
} from './finalize.js';
