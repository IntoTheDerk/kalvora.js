/* global BroadcastChannel, MessageEvent, URLSearchParams */
/**
 * Kalvora Wallet Adapter
 *
 * Framework-agnostic wallet connection manager for browser dApps. Handles:
 * - Provider detection (`window.zera` injected by compatible wallet apps)
 * - Deep-link redirect strategy for external browsers (Brave, Safari, Chrome)
 * - Connection lifecycle (connect / disconnect / reconnect)
 * - Produces a `KalvoraSigner` for use with `signAndFinalize()`
 * - Event emission (connect, disconnect, error)
 *
 * @module adapter/wallet-adapter
 *
 * @example
 * ```typescript
 * import {
 *   KalvoraWalletAdapter,
 *   buildVoteTXN,
 *   signAndFinalize,
 *   sendVoteTXN
 * } from 'kalvora.js';
 *
 * const adapter = new KalvoraWalletAdapter();
 * await adapter.connect();
 *
 * const txn = await buildVoteTXN(
 *   'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
 *   proposalHash,
 *   adapter.publicKey!,
 *   { support: true, grpcConfig }
 * );
 *
 * const signed = await signAndFinalize(txn, adapter.signer!);
 * await sendVoteTXN(signed, grpcConfig);
 * ```
 */

import bs58 from 'bs58';

import { generateAddressFromPublicKey } from '../shared/crypto/address-utils.js';

import {
  WalletSigner,
  DeepLinkSigner,
  type CorrelatedSignResult,
  type KalvoraProvider
} from './wallet-signer.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration options for `KalvoraWalletAdapter`.
 */
export interface WalletAdapterConfig {
  /** Attempt auto-connect on instantiation (default: false) */
  autoConnect?: boolean;
  /** Base deep link URL for wallet actions (default: 'zera-wallet://') */
  deepLinkUrl?: string;
  /** Timeout for signing requests in ms (default: 300000 = 5 min) */
  signTimeout?: number;
  /**
   * Callback URL to redirect back to after the wallet app processes
   * deep-link requests. Defaults to `window.location.href` (current page).
   * The SDK strips any existing `zera_*` params before using this.
   */
  callbackUrl?: string;
}

/** Events emitted by the adapter */
export type WalletAdapterEvent = 'connect' | 'disconnect' | 'error' | 'signResult' | 'signError';
type EventHandler = (...args: unknown[]) => void;

/** Adapter connection state */
export type WalletAdapterState = 'disconnected' | 'connecting' | 'connected';

/** Strategy the adapter used to connect */
export type WalletConnectionMode = 'embedded' | 'deeplink' | 'manual';

// ============================================================================
// CONSTANTS
// ============================================================================

const STORAGE_KEY = 'zera-wallet-adapter';
const PENDING_KEY = 'zera-wallet-pending';

// URL param keys used in deep-link callback
const PARAM_RESULT = 'zera_result';
const PARAM_REQUEST_ID = 'zera_request_id';
const PARAM_ERROR = 'zera_error';

// BroadcastChannel for cross-tab result forwarding
// When the wallet app redirects back (opening a new browser tab), the new tab
// broadcasts the result so the original tab can complete the connection.
const BROADCAST_CHANNEL = 'zera-wallet-bridge';
const CONNECT_REQUEST_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

interface PendingConnectRequest {
  type: 'connect';
  requestId: string;
  timestamp: number;
}

function isValidWalletPublicKey(publicKey: unknown): publicKey is string {
  if (typeof publicKey !== 'string') return false;
  const match = /^(?:r_)?([AB])_(?:(?:[abc])_)*([1-9A-HJ-NP-Za-km-z]+)$/u.exec(publicKey);
  if (!match) return false;

  try {
    const decoded = bs58.decode(match[2] as string);
    return decoded.length === (match[1] === 'A' ? 32 : 57);
  } catch {
    return false;
  }
}

function resolveWalletAddress(publicKey: string, suppliedAddress?: unknown): string {
  const derivedAddress = generateAddressFromPublicKey(publicKey);
  if (suppliedAddress === undefined || suppliedAddress === null || suppliedAddress === '') {
    return derivedAddress;
  }
  if (typeof suppliedAddress !== 'string' || suppliedAddress !== derivedAddress) {
    throw new Error('Wallet returned an address that does not match its public key');
  }
  return suppliedAddress;
}

// ============================================================================
// ADAPTER
// ============================================================================

/**
 * Framework-agnostic wallet adapter for Kalvora dApps.
 *
 * **Two connection strategies:**
 *
 * 1. **Embedded** (wallet dApp browser) — detects `window.zera`, auto-connects,
 *    signs via PostMessage bridge. Zero redirects.
 *
 * 2. **Deep-link redirect** (external browser — Brave, Safari, Chrome) — redirects
 *    to `zera-wallet://connect?callback=...`, any compatible wallet app shows
 *    approval, redirects back with `?zera_result=...`. Signing also uses
 *    deep-link round-trips.
 *
 * Works in any JavaScript framework — React, Vue, Svelte, vanilla JS, etc.
 */
export class KalvoraWalletAdapter {
  // ── State ────────────────────────────────────────────────────────────
  private _state: WalletAdapterState = 'disconnected';
  private _publicKey: string | null = null;
  private _address: string | null = null;
  private _signer: WalletSigner | DeepLinkSigner | null = null;
  private _provider: KalvoraProvider | null = null;
  private _connectionMode: WalletConnectionMode | null = null;
  private _listeners: Record<string, EventHandler[]> = {};
  private readonly _config: Required<WalletAdapterConfig>;
  private _broadcastChannel: BroadcastChannel | null = null;
  private _pendingSignResult: CorrelatedSignResult | null = null;

  constructor(config?: WalletAdapterConfig) {
    this._config = {
      autoConnect: config?.autoConnect ?? false,
      deepLinkUrl: config?.deepLinkUrl ?? 'zera-wallet://',
      signTimeout: config?.signTimeout ?? 5 * 60 * 1000,
      callbackUrl: config?.callbackUrl ?? ''
    };

    // Check for deep-link callback result on page load
    if (typeof window !== 'undefined') {
      this._handleRedirectResult();
      this._setupBroadcastListener();
    }

    if (this._config.autoConnect && typeof window !== 'undefined') {
      this.connect().catch((err) => {
        this._emit('error', err);
      });
    }
  }

  // ── Public Getters ───────────────────────────────────────────────────

  /** Current connection state */
  get state(): WalletAdapterState { return this._state; }

  /** Whether the wallet is currently connected */
  get connected(): boolean { return this._state === 'connected'; }

  /** Connected wallet's public key (null if disconnected) */
  get publicKey(): string | null { return this._publicKey; }

  /** Connected wallet's display address (null if disconnected) */
  get address(): string | null { return this._address; }

  /**
   * A `KalvoraSigner` bound to the connected wallet.
   * Pass this to `signAndFinalize(txn, adapter.signer)`.
   * Returns `null` if not connected.
   */
  get signer(): WalletSigner | DeepLinkSigner | null { return this._signer; }

  /** The underlying window.zera provider (null if using deep-link mode) */
  get provider(): KalvoraProvider | null { return this._provider; }

  /** Whether running inside a wallet's dApp browser (window.zera exists) */
  get isEmbedded(): boolean {
    return this._connectionMode === 'embedded';
  }

  /** How the wallet is connected: 'embedded', 'deeplink', 'manual', or null */
  get connectionMode(): WalletConnectionMode | null { return this._connectionMode; }

  /**
   * Consume a buffered sign result from a deep-link redirect.
   * Returns the result and clears the buffer. Returns null if no pending result.
   *
   * This handles the timing race where the adapter processes the URL params
   * in its constructor, before React components have mounted their event listeners.
   */
  consumePendingSignResult(): CorrelatedSignResult | null {
    const result = this._pendingSignResult;
    this._pendingSignResult = null;
    return result;
  }

  // ── Static Helpers ───────────────────────────────────────────────────

  /**
   * Check if a Kalvora provider is available in the current environment.
   * Returns true if `window.zera` exists and identifies as a Kalvora wallet.
   */
  static isAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    const provider = (window as unknown as Record<string, unknown>).zera as KalvoraProvider | undefined;
    return provider?.isZeraWallet === true;
  }

  /**
   * Get a more detailed detection status for UI display.
   *
   * - `'injected'` — Running inside a wallet's dApp browser (`window.zera` exists)
   * - `'available'` — On a mobile device where deep-link connect will work
   * - `'unknown'`  — Desktop browser with no injected provider detected
   */
  static getDetectionStatus(): 'injected' | 'available' | 'unknown' {
    if (typeof window === 'undefined') return 'unknown';
    const provider = (window as unknown as Record<string, unknown>).zera as KalvoraProvider | undefined;
    if (provider?.isZeraWallet) return 'injected';
    // On mobile, deep link connection is always an option
    if (typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent)) {
      return 'available';
    }
    return 'unknown';
  }

  /**
   * Truncate a public key for display: `"ed25519:9Xk3a...bY4f"`
   */
  static truncateKey(key: string, prefixLen = 6, suffixLen = 4): string {
    if (key.length <= prefixLen + suffixLen + 3) return key;
    return `${key.slice(0, prefixLen)}...${key.slice(-suffixLen)}`;
  }

  // ── Connection Lifecycle ─────────────────────────────────────────────

  /**
   * Connect to the Kalvora wallet.
   *
   * **Strategy 1 — Embedded (window.zera available):**
   * Calls `zera_requestAccounts`, returns immediately with public key.
   *
   * **Strategy 2 — Deep-link redirect (external browser):**
   * Saves pending request to `sessionStorage`, navigates to
   * `zera-wallet://connect?callback=...`. The wallet app shows approval,
   * then redirects back with `?zera_result=...` to resolve the connection.
   *
   * **Manual fallback:**
   * Call `connectManual(publicKey)` to connect with a known public key
   * (view-only, signing requires deep-link round-trip).
   *
   * @returns The connected public key
   */
  async connect(): Promise<string> {
    if (this._state === 'connected' && this._publicKey) {
      return this._publicKey;
    }

    this._state = 'connecting';

    // Strategy 1: Embedded provider (window.zera)
    const provider = this._detectProvider();
    if (provider) {
      return this._connectViaProvider(provider);
    }

    // Strategy 2: Deep-link redirect (iOS, Android, external browsers)
    return this._connectViaDeepLink();
  }

  /**
   * Connect with a known public key (view-only mode).
   * Signing will use deep-link round-trips through a compatible wallet app.
   */
  connectManual(publicKey: string): void {
    if (!isValidWalletPublicKey(publicKey)) {
      throw new Error('publicKey must be a valid Kalvora public key identifier');
    }
    this._publicKey = publicKey;
    this._address = resolveWalletAddress(publicKey);
    this._connectionMode = 'manual';
    this._signer = new DeepLinkSigner(publicKey, this._config.deepLinkUrl, this._getCallbackUrl());
    this._state = 'connected';
    this._persistConnection();
    this._emit('connect', { publicKey, address: this._address, mode: 'manual' });
  }

  /**
   * Disconnect from the wallet and clear all state.
   */
  async disconnect(): Promise<void> {
    if (this._provider) {
      try {
        await this._provider.request('zera_disconnect', {});
      } catch {
        // Ignore disconnect errors
      }
    }

    this._publicKey = null;
    this._address = null;
    this._signer = null;
    this._provider = null;
    this._connectionMode = null;
    this._state = 'disconnected';
    this._clearPersistence();
    this._emit('disconnect');
  }

  // ── Event Emitter ────────────────────────────────────────────────────

  /** Subscribe to adapter events */
  on(event: WalletAdapterEvent, handler: EventHandler): void {
    const list = this._listeners[event] ?? (this._listeners[event] = []);
    list.push(handler);
  }

  /** Unsubscribe from adapter events */
  off(event: WalletAdapterEvent, handler: EventHandler): void {
    const handlers = this._listeners[event];
    if (!handlers) return;
    this._listeners[event] = handlers.filter(h => h !== handler);
  }

  // ── Convenience Methods ──────────────────────────────────────────────

  /**
   * Generate a deep link to open a URL in a compatible wallet's dApp browser.
   */
  getDeepLink(targetUrl?: string): string {
    const url = targetUrl ?? (typeof window !== 'undefined' ? window.location.href : '');
    return `${this._config.deepLinkUrl}browse?url=${encodeURIComponent(url)}`;
  }

  // ── Private: Connection Strategies ───────────────────────────────────

  /** Strategy 1: Connect via detected window.zera provider */
  private async _connectViaProvider(provider: KalvoraProvider): Promise<string> {
    this._provider = provider;
    this._setupProviderListeners(provider);

    try {
      const result = await provider.request('zera_requestAccounts', {});
      const accounts = Array.isArray(result) ? result : (result as { accounts?: string[] })?.accounts ?? [];
      // Parse optional addresses array (wallet app provides actual wallet address)
      const addresses = !Array.isArray(result) ? (result as { addresses?: string[] })?.addresses ?? [] : [];

      if (!accounts.length) {
        throw new Error('No accounts returned from wallet');
      }

      const publicKey = accounts[0] as string;
      const address = addresses[0] as string | undefined;
      if (!isValidWalletPublicKey(publicKey)) {
        throw new Error('Wallet provider returned an invalid Kalvora public key');
      }
      const verifiedAddress = resolveWalletAddress(publicKey, address);
      this._publicKey = publicKey;
      this._address = verifiedAddress;
      this._signer = new WalletSigner(publicKey, provider);
      this._connectionMode = 'embedded';
      this._state = 'connected';
      this._persistConnection();

      this._emit('connect', { publicKey, address: this._address, mode: 'embedded' });
      return publicKey;
    } catch (err) {
      this._state = 'disconnected';
      this._emit('error', err);
      throw err;
    }
  }

  /**
   * Helper to format deep links. On Android Chrome, `window.location.href='scheme://'`
   * is often blocked. We must use the `intent://` fallback syntax for reliable routing.
   */
  private _formatDeepLink(action: string, params: URLSearchParams): string {
    const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
    const base = this._config.deepLinkUrl;
    
    if (isAndroid && base.startsWith('zera-wallet://')) {
      // Adding sdk_redirect_caller_package helps VisionHub bounce back to the same browser on Android
      // Note: In Chrome, we can't reliably read the own package name without native code,
      // but passing "com.android.chrome" as a best-effort default covers 90% of Android users.
      if (!params.has('sdk_redirect_caller_package')) {
        params.append('sdk_redirect_caller_package', 'com.android.chrome');
      }
      return `intent://${action}?${params.toString()}#Intent;scheme=zera-wallet;package=com.visiondynamics.visionhub;end`;
    }
    
    return `${base}${action}?${params.toString()}`;
  }

  /**
   * Strategy 2: Connect via deep-link redirect to a compatible wallet app.
   *
   * Saves a pending request to sessionStorage and navigates to
   * `zera-wallet://connect?callback=...&requestId=...`.
   *
   * This will cause a full page navigation. When the wallet redirects back,
   * the constructor's `_handleRedirectResult()` reads the params and
   * completes the connection.
   *
   * @returns Never (page navigates away). Throws if sessionStorage unavailable.
   */
  private async _connectViaDeepLink(): Promise<string> {
    if (typeof sessionStorage === 'undefined') {
      this._state = 'disconnected';
      throw new Error(
        'No Kalvora wallet provider found and sessionStorage is unavailable. ' +
        'Open this page in a compatible wallet\'s dApp browser.'
      );
    }

    const requestId = this._generateRequestId();
    const callbackUrl = this._getCallbackUrl();

    // Save pending state so we can pick it up when the wallet redirects back
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      type: 'connect',
      requestId,
      callbackUrl,
      timestamp: Date.now()
    }));

    // Redirect to wallet app
    const params = new URLSearchParams({
      callback: callbackUrl,
      requestId: requestId
    });
    
    const deepLink = this._formatDeepLink('connect', params);
    
    // Use assign for slightly better reliability in some browsers
    window.location.assign(deepLink);

    // This promise never resolves (page navigates away).
    // The connection completes via _handleRedirectResult on the next page load.
    return new Promise(() => {});
  }

  // ── Private: Deep-Link Redirect Handling ─────────────────────────────

  /**
   * Called on page load (constructor). Checks the URL for `?zera_result=...`
   * params from a wallet deep-link redirect, restores state from
   * sessionStorage, and completes the pending operation.
   */
  private _handleRedirectResult(): void {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const result = url.searchParams.get(PARAM_RESULT);
    const requestId = url.searchParams.get(PARAM_REQUEST_ID);
    const error = url.searchParams.get(PARAM_ERROR);

    // No deep-link result params? Try restoring from persistence.
    if (!result && !error) {
      this._restoreConnection();
      return;
    }

    const isSignCallback = requestId?.startsWith('zr_sign_') === true
      || requestId?.startsWith('zr_msg_') === true;

    if (isSignCallback) {
      this._restoreConnection();
      try {
        const signResult = DeepLinkSigner.checkSignResult(this._config.signTimeout);
        if (signResult) {
          this._pendingSignResult = signResult;
          setTimeout(() => this._emit('signResult', signResult), 0);
        } else if (requestId && result) {
          // A wallet may open the callback in a new tab. Forward the encoded
          // result; only the tab owning the exact pending request may consume it.
          this._broadcastMessage({ type: 'zera-sign-result', encodedResult: result, requestId });
        } else if (requestId && error) {
          this._broadcastMessage({ type: 'zera-sign-error', message: error, requestId });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setTimeout(() => this._emit('signError', err), 0);
        this._broadcastMessage({ type: 'zera-sign-error', message: errMsg, requestId });
      }
      return;
    }

    const correlated = this._validatePendingConnectRequest(requestId, false);
    if (!correlated) {
      // New-tab callbacks can only forward a correlated request identifier.
      // The initiating tab independently validates and consumes its pending
      // session record before accepting this message.
      if (requestId && result) {
        const forwardedPublicKey = result;
        if (isValidWalletPublicKey(forwardedPublicKey)) {
          const addressParam = url.searchParams.get('zera_address');
          const address = addressParam || null;
          this._broadcastMessage({
            type: 'zera-connect-result',
            publicKey: forwardedPublicKey,
            address,
            requestId
          });
        }
      } else if (requestId && error) {
        this._broadcastMessage({ type: 'zera-connect-error', message: error, requestId });
      }
      this._cleanUrl();
      return;
    }

    // A correlated callback is single-use even if its payload is malformed.
    this._validatePendingConnectRequest(requestId, true);
    this._cleanUrl();

    if (error) {
      const errObj = new Error(error);
      this._emit('error', errObj);
      return;
    }

    const publicKey = result;
    if (!isValidWalletPublicKey(publicKey)) {
      this._emit('error', new Error('Wallet returned an invalid Kalvora public key'));
      return;
    }

    const addressParam = url.searchParams.get('zera_address');
    const suppliedAddress = addressParam || null;
    let address: string;
    try {
      address = resolveWalletAddress(publicKey, suppliedAddress);
    } catch (err) {
      this._emit('error', err);
      return;
    }
    this._publicKey = publicKey;
    this._address = address;
    this._connectionMode = 'deeplink';
    this._signer = new DeepLinkSigner(publicKey, this._config.deepLinkUrl, this._getCallbackUrl());
    this._state = 'connected';
    this._persistConnection();

    setTimeout(() => this._emit('connect', { publicKey, address, mode: 'deeplink' }), 0);
  }

  /**
   * Clean `zera_*` params from the URL without triggering a page reload.
   */
  private _cleanUrl(): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete(PARAM_RESULT);
    url.searchParams.delete(PARAM_REQUEST_ID);
    url.searchParams.delete(PARAM_ERROR);
    url.searchParams.delete('zera_address');
    window.history.replaceState({}, '', url.toString());
  }

  // ── Private: Persistence ─────────────────────────────────────────────

  private _persistConnection(): void {
    try {
      if (!this._publicKey) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        publicKey: this._publicKey,
        address: this._address,
        mode: this._connectionMode
      }));
    } catch { /* localStorage unavailable (iOS WebView) */ }
  }

  private _clearPersistence(): void {
    try { localStorage?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    try { sessionStorage?.removeItem(PENDING_KEY); } catch { /* ignore */ }
  }

  private _restoreConnection(): void {
    try {
      const stored = localStorage?.getItem(STORAGE_KEY);
      if (!stored) return;
      const { publicKey, address, mode } = JSON.parse(stored) as { publicKey: string; address?: string; mode: WalletConnectionMode };
      if (!publicKey) return;

      // Reject malformed or non-canonical keys before restoring signer state.
      if (!isValidWalletPublicKey(publicKey)) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      let verifiedAddress: string;
      try {
        verifiedAddress = resolveWalletAddress(publicKey, address);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      this._publicKey = publicKey;
      this._address = verifiedAddress;
      this._connectionMode = mode ?? 'manual';

      // Always try to detect the embedded provider first, regardless of
      // the stored mode. If the page was previously connected via deep-link
      // (because window.zera wasn't available at connect time, e.g. timing),
      // but it IS available now, upgrade to embedded mode for seamless signing.
      const provider = this._detectProvider();
      if (provider) {
        this._provider = provider;
        this._setupProviderListeners(provider);
        this._connectionMode = 'embedded';
        this._signer = new WalletSigner(publicKey, provider);
      } else {
        // No embedded provider — use deep-link signer
        this._connectionMode = mode === 'embedded' ? 'deeplink' : (mode ?? 'manual');
        this._signer = new DeepLinkSigner(publicKey, this._config.deepLinkUrl, this._getCallbackUrl());
      }

      this._state = 'connected';
      this._emit('connect', { publicKey, address: this._address, mode: this._connectionMode });
    } catch {
      // Corrupt storage or localStorage unavailable — ignore
    }
  }

  // ── Private: Cross-Tab Bridge ──────────────────────────────────────

  /**
   * Listen for wallet connect results from other tabs.
   * When the wallet app redirects to a NEW tab, the new tab broadcasts the
   * result here so the original tab can complete the connection seamlessly.
   */
  private _setupBroadcastListener(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this._broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL);
      this._broadcastChannel.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (!data) return;

        if (data.type === 'zera-connect-result') {
          // Don't process if already connected
          if (this._state === 'connected') return;

          const { publicKey, address, requestId } = data;
          if (!isValidWalletPublicKey(publicKey)
            || typeof requestId !== 'string'
            || !this._validatePendingConnectRequest(requestId, true)) return;

          let verifiedAddress: string;
          try {
            verifiedAddress = resolveWalletAddress(publicKey, address);
          } catch {
            return;
          }
          this._publicKey = publicKey;
          this._address = verifiedAddress;
          this._connectionMode = 'deeplink';
          this._signer = new DeepLinkSigner(publicKey, this._config.deepLinkUrl, this._getCallbackUrl());
          this._state = 'connected';
          this._persistConnection();

          this._emit('connect', { publicKey, address: verifiedAddress, mode: 'deeplink' });
        } else if (data.type === 'zera-connect-error') {
          if (this._state === 'connected') return;
          const { requestId, message } = data;
          if (typeof requestId !== 'string'
            || typeof message !== 'string'
            || !this._validatePendingConnectRequest(requestId, true)) return;
          this._emit('error', new Error(message));
        } else if (data.type === 'zera-sign-result') {
          const { encodedResult, requestId } = data;
          if (typeof encodedResult !== 'string' || typeof requestId !== 'string') return;
          try {
            const signResult = DeepLinkSigner.consumeBroadcastResult(
              encodedResult,
              requestId,
              this._config.signTimeout
            );
            if (!signResult) return;
            this._pendingSignResult = signResult;
            this._emit('signResult', signResult);
          } catch (err) {
            this._emit('signError', err);
          }
        } else if (data.type === 'zera-sign-error') {
          const { requestId, message } = data;
          if (typeof requestId !== 'string'
            || typeof message !== 'string'
            || !DeepLinkSigner.consumeBroadcastError(requestId, this._config.signTimeout)) return;
          this._emit('signError', new Error(message));
        }
      };
    } catch {
      // BroadcastChannel not supported — fall back to normal redirect flow
    }
  }

  /**
   * Broadcast a message to other tabs and attempt to close this
   * (redirect) tab so the user returns to their original tab.
   */
  private _broadcastMessage(msg: Record<string, unknown>): void {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL);
      bc.postMessage(msg);
      bc.close();

      // Try to close this duplicate tab.
      // window.close() works on mobile Safari/Chrome in most cases when the
      // tab was opened by the OS via deep-link redirect (not user-initiated).
      setTimeout(() => {
        try { window.close(); } catch { /* ignore */ }
      }, 300);
    } catch {
      // BroadcastChannel not supported — user will just stay in the new tab
    }
  }

  // ── Private: Helpers ─────────────────────────────────────────────────

  private _validatePendingConnectRequest(requestId: string | null, consume: boolean): boolean {
    if (!requestId) return false;

    try {
      const pendingJson = sessionStorage?.getItem(PENDING_KEY);
      if (!pendingJson) return false;

      let pending: PendingConnectRequest;
      try {
        pending = JSON.parse(pendingJson) as PendingConnectRequest;
      } catch {
        sessionStorage.removeItem(PENDING_KEY);
        return false;
      }

      const validShape = pending.type === 'connect'
        && typeof pending.requestId === 'string'
        && pending.requestId.length > 0
        && typeof pending.timestamp === 'number'
        && Number.isFinite(pending.timestamp);
      if (!validShape) {
        sessionStorage.removeItem(PENDING_KEY);
        return false;
      }

      const ageMs = Date.now() - pending.timestamp;
      if (ageMs > CONNECT_REQUEST_TTL_MS || ageMs < -MAX_CLOCK_SKEW_MS) {
        sessionStorage.removeItem(PENDING_KEY);
        return false;
      }

      if (pending.requestId !== requestId) return false;
      if (consume) sessionStorage.removeItem(PENDING_KEY);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Bind native event listeners to the injected provider so the adapter React State
   * organically reacts to background disconnections and auto-connections natively.
   */
  private _setupProviderListeners(provider: KalvoraProvider): void {
    if (typeof provider.on !== 'function') return;

    provider.on('connect', (...args: unknown[]) => {
      const info = args[0] as { publicKey?: string; address?: string | null } | undefined;
      if (!info) return;

      // Don't emit if already connected to this exact key
      if (this._state === 'connected' && this._publicKey === info.publicKey) return;

      if (isValidWalletPublicKey(info.publicKey)) {
        let verifiedAddress: string;
        try {
          verifiedAddress = resolveWalletAddress(info.publicKey, info.address);
        } catch (err) {
          this._emit('error', err);
          return;
        }
        this._publicKey = info.publicKey;
        this._address = verifiedAddress;
        this._connectionMode = 'embedded';
        this._signer = new WalletSigner(info.publicKey, provider);
        this._state = 'connected';
        this._persistConnection();
        this._emit('connect', { publicKey: info.publicKey, address: verifiedAddress, mode: 'embedded' });
      }
    });

    provider.on('disconnect', () => {
      if (this._state === 'disconnected') return;
      this._publicKey = null;
      this._address = null;
      this._signer = null;
      this._connectionMode = null;
      this._state = 'disconnected';
      this._clearPersistence();
      this._emit('disconnect');
    });
  }

  private _detectProvider(): KalvoraProvider | null {
    if (typeof window === 'undefined') return null;
    const win = window as unknown as Record<string, unknown>;
    const provider = win.zera as KalvoraProvider | undefined;
    if (provider?.isZeraWallet) return provider;
    return null;
  }

  private _getCallbackUrl(): string {
    if (this._config.callbackUrl) return this._config.callbackUrl;
    if (typeof window === 'undefined') return '';

    // Strip existing zera_* params from current URL
    const url = new URL(window.location.href);
    url.searchParams.delete(PARAM_RESULT);
    url.searchParams.delete(PARAM_REQUEST_ID);
    url.searchParams.delete(PARAM_ERROR);
    return url.toString();
  }

  private _generateRequestId(): string {
    return `zr_${crypto.randomUUID().replace(/-/g, '')}`;
  }

  private _emit(event: string, ...args: unknown[]): void {
    const handlers = this._listeners[event];
    if (!handlers) return;
    for (const handler of handlers) {
      try { handler(...args); } catch { /* swallow listener errors */ }
    }
  }
}
