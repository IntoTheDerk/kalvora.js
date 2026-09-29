/**
 * WalletConnect v2 — Kalvora & Solana Namespace Definitions
 *
 * Defines the chain namespaces, methods, and events for WalletConnect v2
 * sessions. These constants are used by both the dApp side (SignClient)
 * and the wallet side (Web3Wallet) to negotiate session capabilities.
 *
 * Also exports `WalletConnectSigner` — a `KalvoraSigner` implementation that
 * delegates signing to an active WC session.
 *
 * @module adapter/walletconnect
 *
 * @example
 * ```typescript
 * import {
 *   KALVORA_WC_REQUIRED_NAMESPACES,
 *   SOLANA_WC_REQUIRED_NAMESPACES,
 *   WalletConnectSigner
 * } from 'kalvora.js';
 *
 * // dApp side: propose session with both chains
 * const { uri, approval } = await signClient.connect({
 *   requiredNamespaces: {
 *     ...KALVORA_WC_REQUIRED_NAMESPACES,
 *     ...SOLANA_WC_REQUIRED_NAMESPACES,
 *   }
 * });
 *
 * // After approval, sign transactions via WC
 * const signer = new WalletConnectSigner(signClient, session, publicKey);
 * const signed = await signAndFinalize(txn, signer);
 * ```
 */

import { KALVORA_PROTONET_NETWORK } from '../shared/network/constants.js';
import type { KalvoraSigner } from '../sign/signer.js';

// ============================================================================
// Kalvora NAMESPACE
// ============================================================================

/** WalletConnect namespace identifier for Kalvora (key in `requiredNamespaces`). */
export const KALVORA_WC_NAMESPACE = 'zera' as const; // wire value; fixed by the wallet protocol

/** Kalvora chain identifiers (CAIP-2 format). */
export const KALVORA_WC_CHAINS = [KALVORA_PROTONET_NETWORK] as const;

/** Kalvora WalletConnect JSON-RPC method names, by purpose. */
const WC_METHOD = {
  getAccounts: 'zera_getAccounts', // wire value; fixed by the wallet protocol
  signTransaction: 'zera_signTransaction', // wire value; fixed by the wallet protocol
  signMessage: 'zera_signMessage' // wire value; fixed by the wallet protocol
} as const;

/**
 * JSON-RPC methods the wallet must support for Kalvora, in order:
 * get accounts, sign transaction, sign message.
 */
export const KALVORA_WC_METHODS = [
  WC_METHOD.getAccounts,
  WC_METHOD.signTransaction,
  WC_METHOD.signMessage
] as const;

/** Events the wallet may emit for Kalvora */
export const KALVORA_WC_EVENTS = [
  'accountsChanged'
] as const;

/** Required namespaces object for Kalvora — pass to `signClient.connect()` */
export const KALVORA_WC_REQUIRED_NAMESPACES = {
  [KALVORA_WC_NAMESPACE]: {
    chains: KALVORA_WC_CHAINS as unknown as string[],
    methods: KALVORA_WC_METHODS as unknown as string[],
    events: KALVORA_WC_EVENTS as unknown as string[]
  }
} as const;

// ============================================================================
// SOLANA NAMESPACE (standard)
// ============================================================================

/** WalletConnect namespace identifier for Solana */
export const SOLANA_WC_NAMESPACE = 'solana' as const;

/** Solana chain identifiers (CAIP-2 format) */
export const SOLANA_WC_CHAINS = ['solana:mainnet'] as const;

/** JSON-RPC methods the wallet must support for Solana */
export const SOLANA_WC_METHODS = [
  'solana_signTransaction',
  'solana_signMessage'
] as const;

/** Events the wallet may emit for Solana */
export const SOLANA_WC_EVENTS = [
  'accountsChanged'
] as const;

/** Required namespaces object for Solana */
export const SOLANA_WC_REQUIRED_NAMESPACES = {
  [SOLANA_WC_NAMESPACE]: {
    chains: SOLANA_WC_CHAINS as unknown as string[],
    methods: SOLANA_WC_METHODS as unknown as string[],
    events: SOLANA_WC_EVENTS as unknown as string[]
  }
} as const;

// ============================================================================
// COMBINED NAMESPACES — convenience for dApps supporting both chains
// ============================================================================

/** All required namespaces for a dual-chain (Kalvora + Solana) session */
export const ALL_WC_REQUIRED_NAMESPACES = {
  ...KALVORA_WC_REQUIRED_NAMESPACES,
  ...SOLANA_WC_REQUIRED_NAMESPACES
} as const;

// ============================================================================
// TYPES
// ============================================================================

/** Minimal WC SignClient interface (avoids hard dependency on @walletconnect/sign-client) */
export interface WCSignClient {
  request<T = unknown>(params: {
    topic: string;
    chainId: string;
    request: { method: string; params: unknown };
  }): Promise<T>;
}

/** Minimal WC session object */
export interface WCSession {
  topic: string;
}

/** Response from the Kalvora WC sign-transaction method (`KALVORA_WC_METHODS[1]`) */
export interface KalvoraWCSignTransactionResult {
  signature: string; // base64-encoded signature bytes
}

/** Response from the Kalvora WC sign-message method (`KALVORA_WC_METHODS[2]`) */
export interface KalvoraWCSignMessageResult {
  signature: string; // base64-encoded signature bytes
}

/** Response from the Kalvora WC get-accounts method (`KALVORA_WC_METHODS[0]`) */
export interface KalvoraWCGetAccountsResult {
  accounts: Array<{
    publicKey: string;  // Kalvora public key identifier (e.g. "A_<base58>")
    address: string;    // Kalvora address
  }>;
}

// ============================================================================
// BASE64 HELPERS (isomorphic)
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

function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// WALLETCONNECT SIGNER
// ============================================================================

/**
 * `KalvoraSigner` implementation that delegates signing to an active
 * WalletConnect session.
 *
 * Used by dApps: after establishing a WC session with a Kalvora-compatible wallet,
 * pass this signer to `signAndFinalize()` to sign Kalvora transactions
 * remotely via the WC relay.
 *
 * @example
 * ```typescript
 * const signer = new WalletConnectSigner(signClient, session, publicKey);
 * const signed = await signAndFinalize(unsignedTxn, signer);
 * const hash = await sendCoinTXN(signed);
 * ```
 */
export class WalletConnectSigner implements KalvoraSigner {
  readonly publicKey: string;
  private readonly _client: WCSignClient;
  private readonly _session: WCSession;
  private readonly _chainId: string;

  constructor(
    client: WCSignClient,
    session: WCSession,
    publicKey: string,
    chainId: string = KALVORA_PROTONET_NETWORK
  ) {
    this._client = client;
    this._session = session;
    this.publicKey = publicKey;
    this._chainId = chainId;
  }

  /**
   * Sign transaction bytes by sending the Kalvora sign-transaction RPC
   * (`KALVORA_WC_METHODS[1]`) request through the WalletConnect relay to the connected wallet.
   *
   * The wallet will show an approval prompt; the returned signature
   * is the raw Ed25519 bytes.
   */
  async sign(data: Uint8Array): Promise<Uint8Array> {
    const result = await this._client.request<KalvoraWCSignTransactionResult>({
      topic: this._session.topic,
      chainId: this._chainId,
      request: {
        method: WC_METHOD.signTransaction,
        params: {
          transaction: toBase64(data)
        }
      }
    });

    return fromBase64(result.signature);
  }

  /**
   * Sign an arbitrary message (non-transaction).
   * Not part of KalvoraSigner, but useful for auth / proof-of-ownership.
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const result = await this._client.request<KalvoraWCSignMessageResult>({
      topic: this._session.topic,
      chainId: this._chainId,
      request: {
        method: WC_METHOD.signMessage,
        params: {
          message: toBase64(message)
        }
      }
    });

    return fromBase64(result.signature);
  }
}
