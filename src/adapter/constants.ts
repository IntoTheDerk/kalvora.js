/**
 * Wallet Protocol Constants
 *
 * Exact strings shared between the SDK and compatible Kalvora wallet apps:
 * the injected provider global, the deep-link scheme, provider request
 * methods, deep-link callback parameters and the browser storage keys the
 * adapter uses to correlate redirects.
 *
 * These values are part of the wallet protocol. Wallet apps match on them
 * byte-for-byte, so they never change between SDK releases. Refer to them by
 * constant name rather than by value.
 *
 * @module adapter/constants
 */

// ============================================================================
// INJECTED PROVIDER
// ============================================================================

/**
 * Property name on `window` under which a compatible wallet's dApp browser
 * injects its {@link KalvoraProvider}. Read it with
 * `window[KALVORA_INJECTED_PROVIDER_KEY]`.
 */
export const KALVORA_INJECTED_PROVIDER_KEY = 'zera' as const; // wire value; fixed by the wallet protocol

/**
 * Boolean property an injected provider sets to `true` to identify itself as
 * a Kalvora wallet provider.
 */
export const KALVORA_PROVIDER_FLAG = 'isZeraWallet' as const; // wire value; fixed by the wallet protocol

/** JSON-RPC style methods the SDK sends to an injected provider via `provider.request()`. */
export const KALVORA_PROVIDER_METHODS = {
  /** Ask the wallet to connect and return its public key(s). */
  requestAccounts: 'zera_requestAccounts', // wire value; fixed by the wallet protocol
  /** Ask the wallet to sign base64-encoded transaction bytes. */
  signTransaction: 'zera_signTransaction', // wire value; fixed by the wallet protocol
  /** Tell the wallet the dApp is disconnecting. */
  disconnect: 'zera_disconnect' // wire value; fixed by the wallet protocol
} as const;

// ============================================================================
// DEEP LINKS
// ============================================================================

/** URL scheme registered by compatible wallet apps (without `://`). */
export const KALVORA_DEEP_LINK_SCHEME = 'zera-wallet' as const; // wire value; fixed by the wallet protocol

/** Default base deep link used by the adapter and `DeepLinkSigner`. */
export const KALVORA_DEFAULT_DEEP_LINK = `${KALVORA_DEEP_LINK_SCHEME}://` as const;

/**
 * Query parameters a wallet app appends to the dApp callback URL when it
 * redirects back after a deep-link request.
 */
export const KALVORA_DEEP_LINK_PARAMS = {
  /** Result payload: the public key (connect) or a base64 signature (sign). */
  result: 'zera_result', // wire value; fixed by the wallet protocol
  /** Error message when the user rejects or the wallet fails. */
  error: 'zera_error', // wire value; fixed by the wallet protocol
  /** Optional wallet address returned with a connect result. */
  address: 'zera_address', // wire value; fixed by the wallet protocol
  /** Echo of the request id the SDK generated, used for correlation. */
  requestId: 'zera_request_id' // wire value; fixed by the wallet protocol
} as const;

// ============================================================================
// BROWSER STORAGE & CROSS-TAB MESSAGES (compatibility)
// ============================================================================

/**
 * `localStorage` / `sessionStorage` keys used by the adapter. Kept stable so
 * sessions persisted by earlier SDK builds keep working.
 *
 * @internal
 */
export const KALVORA_ADAPTER_STORAGE_KEYS = {
  /** `localStorage`: the persisted connection. */
  connection: 'zera-wallet-adapter', // stored value; kept for session compatibility
  /** `sessionStorage`: the pending deep-link connect request. */
  pendingConnect: 'zera-wallet-pending', // stored value; kept for session compatibility
  /** `sessionStorage`: the pending deep-link sign request. */
  pendingSign: 'zera-wallet-sign-pending' // stored value; kept for session compatibility
} as const;

/**
 * `BroadcastChannel` name and message types used to forward a deep-link
 * callback that the wallet opened in a new tab back to the originating tab.
 *
 * @internal
 */
export const KALVORA_ADAPTER_BROADCAST = {
  channel: 'zera-wallet-bridge', // cross-tab value; kept for compatibility
  connectResult: 'zera-connect-result', // cross-tab value; kept for compatibility
  connectError: 'zera-connect-error', // cross-tab value; kept for compatibility
  signResult: 'zera-sign-result', // cross-tab value; kept for compatibility
  signError: 'zera-sign-error' // cross-tab value; kept for compatibility
} as const;
