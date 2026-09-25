/* global URLSearchParams */
/**
 * Wallet Signers
 *
 * Three implementations of the `KalvoraSigner` interface:
 *
 * 1. **WalletSigner** — delegates `sign()` to `window.zera` (PostMessage bridge).
 *    Used when running inside a wallet's dApp browser (embedded mode).
 *
 * 2. **DeepLinkSigner** — delegates `sign()` via a `zera-wallet://sign` deep link.
 *    Used when running in an external browser (Brave, Safari, Chrome).
 *    The signing flow causes a full page redirect; the result is read from
 *    URL params on the next page load.
 *
 *
 * @module adapter/wallet-signer
 */

import type { KalvoraSigner } from '../sign/signer.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimal interface for a Kalvora wallet provider.
 * Matches the `window.zera` object injected by compatible wallet apps.
 */
export interface KalvoraProvider {
  readonly isZeraWallet: boolean;
  readonly isConnected: boolean;
  readonly publicKey: string | null;
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  off?(event: string, handler: (...args: unknown[]) => void): void;
}

/** Metadata emitted only after an exact, live, one-use deep-link correlation. */
export interface CorrelatedSignResult {
  signature: Uint8Array;
  requestId: string;
  operation: 'sign' | 'sign-message';
  publicKey: string | null;
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
// WALLET SIGNER (embedded mode — window.zera)
// ============================================================================

/**
 * A `KalvoraSigner` implementation that delegates signing to an in-page
 * wallet provider (`window.zera`). Used when embedded in a wallet's
 * dApp browser — no page redirects needed.
 */
export class WalletSigner implements KalvoraSigner {
  readonly publicKey: string;
  private readonly provider: KalvoraProvider;

  constructor(publicKey: string, provider: KalvoraProvider) {
    if (!publicKey) throw new Error('publicKey is required');
    if (!provider) throw new Error('provider is required');
    this.publicKey = publicKey;
    this.provider = provider;
  }

  /**
   * Sign transaction bytes by delegating to the external wallet provider.
   *
   * @param data - Serialized transaction bytes
   * @returns Raw signature bytes (Ed25519 — 64 bytes)
   */
  async sign(data: Uint8Array): Promise<Uint8Array> {
    const encoded = toBase64(data);

    const result = await this.provider.request('zera_signTransaction', {
      transaction: encoded
    }) as { signedTransaction?: string; signature?: string } | string;

    // The provider may return the signature directly or in an object
    let sigBase64: string;
    if (typeof result === 'string') {
      sigBase64 = result;
    } else if (result && typeof result === 'object') {
      sigBase64 = (result as { signedTransaction?: string; signature?: string }).signature
        ?? (result as { signedTransaction?: string; signature?: string }).signedTransaction
        ?? '';
    } else {
      throw new Error('Unexpected signing response from wallet provider');
    }

    if (!sigBase64) {
      throw new Error('Wallet provider returned empty signature');
    }

    return decodeAndValidateSignature(sigBase64, this.publicKey);
  }
}

// ============================================================================
// DEEP LINK SIGNER (external browser mode)
// ============================================================================

const SIGN_PENDING_KEY = 'zera-wallet-sign-pending';
const DEFAULT_SIGN_REQUEST_TTL_MS = 5 * 60 * 1000;
const MAX_SIGN_REQUEST_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

interface PendingSignRequest {
  type: 'sign' | 'sign-message';
  requestId: string;
  timestamp: number;
  publicKey?: string;
}

function expectedSignatureLength(publicKey?: string): number | null {
  const unrestrictedKey = publicKey?.startsWith('r_') ? publicKey.slice(2) : publicKey;
  if (unrestrictedKey?.startsWith('A_')) return 64;
  if (unrestrictedKey?.startsWith('B_')) return 114;
  return null;
}

function decodeAndValidateSignature(encodedSignature: string, publicKey?: string): Uint8Array {
  let normalized: string;
  try {
    normalized = decodeURIComponent(encodedSignature);
  } catch {
    throw new Error('Wallet returned an invalid signature encoding');
  }

  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    throw new Error('Wallet returned an invalid base64 signature');
  }

  const signature = fromBase64(normalized);
  const expectedLength = expectedSignatureLength(publicKey);
  const validLength = expectedLength === null
    ? signature.length === 64 || signature.length === 114
    : signature.length === expectedLength;

  if (!validLength) {
    const expected = expectedLength === null ? '64 or 114' : String(expectedLength);
    throw new Error(`Wallet returned an invalid signature length: expected ${expected} bytes`);
  }

  return signature;
}

/**
 * A `KalvoraSigner` implementation for external browsers (Brave, Safari, Chrome).
 *
 * When `sign()` is called, it:
 * 1. Saves the pending sign request to `sessionStorage`
 * 2. Navigates to `zera-wallet://sign?txn=...&callback=...`
 * 3. The wallet app signs and redirects back with `?zera_result=...`
 * 4. The adapter reads the URL param and resolves the pending promise
 *
 * **Important:** This causes a full page redirect. The calling code must
 * handle the fact that `sign()` will not return during this page load.
 * The result is picked up on the next page load by the adapter.
 */
export class DeepLinkSigner implements KalvoraSigner {
  readonly publicKey: string;
  private readonly deepLinkUrl: string;
  private readonly callbackUrl: string;

  constructor(publicKey: string, deepLinkUrl: string, callbackUrl: string) {
    if (!publicKey) throw new Error('publicKey is required');
    this.publicKey = publicKey;
    this.deepLinkUrl = deepLinkUrl;
    this.callbackUrl = callbackUrl;
  }

  /**
   * Helper to format deep links. On Android Chrome, `window.location.href='scheme://'`
   * is often blocked. We must use the `intent://` fallback syntax for reliable routing.
   */
  private _formatDeepLink(action: string, params: URLSearchParams): string {
    const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
    
    if (isAndroid && this.deepLinkUrl.startsWith('zera-wallet://')) {
      // Adding sdk_redirect_caller_package helps VisionHub bounce back to the same browser on Android
      // Note: In Chrome, we can't reliably read the own package name without native code,
      // but passing "com.android.chrome" as a best-effort default covers 90% of Android users.
      if (!params.has('sdk_redirect_caller_package')) {
        params.append('sdk_redirect_caller_package', 'com.android.chrome');
      }
      return `intent://${action}?${params.toString()}#Intent;scheme=zera-wallet;package=com.visiondynamics.visionhub;end`;
    }
    
    return `${this.deepLinkUrl}${action}?${params.toString()}`;
  }

  /**
   * Sign transaction bytes via deep-link redirect to a compatible wallet app.
   *
   * This triggers a page navigation. The signature is delivered
   * via URL params when the wallet app redirects back.
   */
  async sign(data: Uint8Array): Promise<Uint8Array> {
    if (typeof window === 'undefined') {
      throw new Error('Deep-link signing requires a browser environment');
    }

    const encoded = toBase64(data);
    const requestId = `zr_sign_${crypto.randomUUID().replace(/-/g, '')}`;

    // sessionStorage survives a same-tab wallet redirect/reload while keeping
    // the request scoped to the tab that initiated it.
    try {
      sessionStorage.setItem(SIGN_PENDING_KEY, JSON.stringify({
        type: 'sign',
        requestId,
        transaction: encoded,
        timestamp: Date.now(),
        publicKey: this.publicKey
      }));
    } catch {
      throw new Error('Deep-link signing requires sessionStorage to correlate the wallet callback');
    }

    // Redirect to wallet app
    const params = new URLSearchParams({
      txn: encoded,
      callback: this.callbackUrl,
      requestId,
      publicKey: this.publicKey
    });
    const deepLink = this._formatDeepLink('sign', params);
    window.location.assign(deepLink);

    // This promise never resolves — the page navigates away.
    // The SDK adapter handles the result on the next page load.
    return new Promise(() => {});
  }

  /**
   * Sign an arbitrary message via deep-link redirect to a compatible wallet app.
   *
   * This triggers a page navigation. The signature is delivered
   * via URL params when the wallet app redirects back.
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (typeof window === 'undefined') {
      throw new Error('Deep-link signing requires a browser environment');
    }

    const encoded = toBase64(message);
    const requestId = `zr_msg_${crypto.randomUUID().replace(/-/g, '')}`;

    // sessionStorage survives a same-tab wallet redirect/reload while keeping
    // the request scoped to the tab that initiated it.
    try {
      sessionStorage.setItem(SIGN_PENDING_KEY, JSON.stringify({
        type: 'sign-message',
        requestId,
        message: encoded,
        timestamp: Date.now(),
        publicKey: this.publicKey
      }));
    } catch {
      throw new Error('Deep-link signing requires sessionStorage to correlate the wallet callback');
    }

    // Redirect to wallet app
    const params = new URLSearchParams({
      message: encoded,
      callback: this.callbackUrl,
      requestId,
      publicKey: this.publicKey
    });
    const deepLink = this._formatDeepLink('sign-message', params);
    window.location.assign(deepLink);

    // This promise never resolves — the page navigates away.
    return new Promise(() => {});
  }

  /**
   * Check URL params for a signing result from a deep-link redirect.
   * Called by the adapter on page load.
   *
   * @returns The signature bytes, or null if no pending sign result
   */
  static checkSignResult(maxAgeMs = DEFAULT_SIGN_REQUEST_TTL_MS): CorrelatedSignResult | null {
    if (typeof window === 'undefined') return null;

    const url = new URL(window.location.href);
    const sigBase64 = url.searchParams.get('zera_result');
    const requestId = url.searchParams.get('zera_request_id');
    const error = url.searchParams.get('zera_error');

    if (!sigBase64 && !error) return null;

    const pending = this._getPendingRequest(requestId, maxAgeMs);
    if (!pending) {
      this._cleanCallbackUrl(url);
      return null;
    }

    // A correlated callback is single-use even if its payload is malformed.
    this._removePendingRequest();
    this._cleanCallbackUrl(url);

    if (error) {
      throw new Error(error);
    }

    return {
      signature: decodeAndValidateSignature(sigBase64 as string, pending.publicKey),
      requestId: pending.requestId,
      operation: pending.type,
      publicKey: pending.publicKey ?? null
    };
  }

  /**
   * Consume a signature forwarded by another tab. The receiving tab must own
   * the exact live request; otherwise the message is ignored.
   */
  static consumeBroadcastResult(
    encodedSignature: string,
    requestId: string,
    maxAgeMs = DEFAULT_SIGN_REQUEST_TTL_MS
  ): CorrelatedSignResult | null {
    const pending = this._getPendingRequest(requestId, maxAgeMs);
    if (!pending) return null;

    // Claim the correlated response before parsing so even a malformed result
    // cannot be replayed against the same signing request.
    this._removePendingRequest();
    const signature = decodeAndValidateSignature(encodedSignature, pending.publicKey);
    return {
      signature,
      requestId: pending.requestId,
      operation: pending.type,
      publicKey: pending.publicKey ?? null
    };
  }

  /** Consume a correlated signing error forwarded by another tab. */
  static consumeBroadcastError(requestId: string, maxAgeMs = DEFAULT_SIGN_REQUEST_TTL_MS): boolean {
    const pending = this._getPendingRequest(requestId, maxAgeMs);
    if (!pending) return false;
    this._removePendingRequest();
    return true;
  }

  private static _getPendingRequest(requestId: string | null, maxAgeMs: number): PendingSignRequest | null {
    if (!requestId || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return null;

    try {
      const pendingJson = sessionStorage?.getItem(SIGN_PENDING_KEY);
      if (!pendingJson) return null;

      let pending: PendingSignRequest;
      try {
        pending = JSON.parse(pendingJson) as PendingSignRequest;
      } catch {
        this._removePendingRequest();
        return null;
      }

      const validShape = (pending.type === 'sign' || pending.type === 'sign-message')
        && typeof pending.requestId === 'string'
        && pending.requestId.length > 0
        && typeof pending.timestamp === 'number'
        && Number.isFinite(pending.timestamp);
      const requestMatchesType = pending.type === 'sign'
        ? pending.requestId.startsWith('zr_sign_')
        : pending.requestId.startsWith('zr_msg_');
      if (!validShape || !requestMatchesType) {
        this._removePendingRequest();
        return null;
      }

      const ageMs = Date.now() - pending.timestamp;
      const effectiveTtlMs = Math.min(maxAgeMs, MAX_SIGN_REQUEST_TTL_MS);
      if (ageMs > effectiveTtlMs || ageMs < -MAX_CLOCK_SKEW_MS) {
        this._removePendingRequest();
        return null;
      }

      return pending.requestId === requestId ? pending : null;
    } catch {
      return null;
    }
  }

  private static _removePendingRequest(): void {
    try { sessionStorage?.removeItem(SIGN_PENDING_KEY); } catch { /* ignore */ }
  }

  private static _cleanCallbackUrl(url: URL): void {
    url.searchParams.delete('zera_result');
    url.searchParams.delete('zera_request_id');
    url.searchParams.delete('zera_error');
    window.history.replaceState({}, '', url.toString());
  }
}
