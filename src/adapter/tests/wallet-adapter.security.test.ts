/* global MessageEvent, Storage */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KalvoraWalletAdapter } from '../wallet-adapter.js';
import { DeepLinkSigner } from '../wallet-signer.js';

const CONNECT_PENDING_KEY = 'zera-wallet-pending';
const SIGN_PENDING_KEY = 'zera-wallet-sign-pending';
const VALID_PUBLIC_KEY = 'A_AKpo7NMd3JhGAonxXJXuG8XgDXA8jZGikK6UaHDYxksU';
const VALID_ADDRESS = VALID_PUBLIC_KEY.slice(2);
const VALID_SIGNATURE_BASE64 = Buffer.from(new Uint8Array(64).fill(7)).toString('base64');

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  close(): void { /* no-op */ }
  postMessage(message: unknown): void { this.messages.push(message); }
  emit(message: unknown): void { this.onmessage?.({ data: message } as MessageEvent); }
}

let browserWindow: {
  location: { href: string; assign: ReturnType<typeof vi.fn> };
  history: { replaceState: (_state: unknown, _title: string, url: string) => void };
  close: ReturnType<typeof vi.fn>;
};

function setCallback(params: Record<string, string>): void {
  const url = new URL('https://dapp.example/callback');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  browserWindow.location.href = url.toString();
}

function setConnectPending(requestId: string, timestamp = Date.now()): void {
  sessionStorage.setItem(CONNECT_PENDING_KEY, JSON.stringify({
    type: 'connect',
    requestId,
    timestamp
  }));
}

function setSignPending(requestId: string, timestamp = Date.now()): void {
  sessionStorage.setItem(SIGN_PENDING_KEY, JSON.stringify({
    type: 'sign',
    requestId,
    timestamp,
    publicKey: VALID_PUBLIC_KEY
  }));
}

function listenerChannel(): FakeBroadcastChannel {
  const channel = FakeBroadcastChannel.instances.find(instance => instance.onmessage !== null);
  if (!channel) throw new Error('Adapter did not create a broadcast listener');
  return channel;
}

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  browserWindow = {
    location: { href: 'https://dapp.example/', assign: vi.fn() },
    history: {
      replaceState: (_state, _title, url) => { browserWindow.location.href = String(url); }
    },
    close: vi.fn()
  };

  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('KalvoraWalletAdapter connect callback correlation', () => {
  it('rejects an unsolicited callback', () => {
    setCallback({ zera_result: VALID_PUBLIC_KEY, zera_request_id: 'zr_unsolicited' });

    const adapter = new KalvoraWalletAdapter();

    expect(adapter.connected).toBe(false);
    expect(new URL(browserWindow.location.href).searchParams.has('zera_result')).toBe(false);
  });

  it('rejects a callback missing its request ID without consuming the pending request', () => {
    setConnectPending('zr_expected');
    setCallback({ zera_result: VALID_PUBLIC_KEY });

    const adapter = new KalvoraWalletAdapter();

    expect(adapter.connected).toBe(false);
    expect(sessionStorage.getItem(CONNECT_PENDING_KEY)).not.toBeNull();
  });

  it('rejects a mismatched callback without consuming the pending request', () => {
    setConnectPending('zr_expected');
    setCallback({ zera_result: VALID_PUBLIC_KEY, zera_request_id: 'zr_other' });

    const adapter = new KalvoraWalletAdapter();

    expect(adapter.connected).toBe(false);
    expect(sessionStorage.getItem(CONNECT_PENDING_KEY)).not.toBeNull();
  });

  it('rejects and removes a stale pending request', () => {
    setConnectPending('zr_expected', Date.now() - 11 * 60 * 1000);
    setCallback({ zera_result: VALID_PUBLIC_KEY, zera_request_id: 'zr_expected' });

    const adapter = new KalvoraWalletAdapter();

    expect(adapter.connected).toBe(false);
    expect(sessionStorage.getItem(CONNECT_PENDING_KEY)).toBeNull();
  });

  it('accepts an exact live match once and validates the public key', () => {
    setConnectPending('zr_expected');
    setCallback({ zera_result: VALID_PUBLIC_KEY, zera_request_id: 'zr_expected' });

    const adapter = new KalvoraWalletAdapter();

    expect(adapter.connected).toBe(true);
    expect(adapter.publicKey).toBe(VALID_PUBLIC_KEY);
    expect(sessionStorage.getItem(CONNECT_PENDING_KEY)).toBeNull();

    sessionStorage.removeItem(CONNECT_PENDING_KEY);
    setCallback({ zera_result: VALID_PUBLIC_KEY, zera_request_id: 'zr_expected' });
    expect(new KalvoraWalletAdapter().connected).toBe(false);
  });

  it('consumes a correlated callback with an invalid public key without connecting', () => {
    setConnectPending('zr_expected');
    setCallback({ zera_result: 'A_attackerControlled', zera_request_id: 'zr_expected' });

    const adapter = new KalvoraWalletAdapter();

    expect(adapter.connected).toBe(false);
    expect(sessionStorage.getItem(CONNECT_PENDING_KEY)).toBeNull();
  });

  it('rejects a correlated callback whose address does not match its public key', () => {
    setConnectPending('zr_expected');
    setCallback({
      zera_result: VALID_PUBLIC_KEY,
      zera_address: 'attacker-address',
      zera_request_id: 'zr_expected'
    });

    const adapter = new KalvoraWalletAdapter();

    expect(adapter.connected).toBe(false);
    expect(sessionStorage.getItem(CONNECT_PENDING_KEY)).toBeNull();
  });

  it('fails closed instead of throwing on a callback address containing a literal percent', () => {
    setConnectPending('zr_expected');
    setCallback({
      zera_result: VALID_PUBLIC_KEY,
      zera_address: '%',
      zera_request_id: 'zr_expected'
    });

    let adapter: KalvoraWalletAdapter | undefined;
    expect(() => { adapter = new KalvoraWalletAdapter(); }).not.toThrow();
    expect(adapter?.connected).toBe(false);
    expect(sessionStorage.getItem(CONNECT_PENDING_KEY)).toBeNull();
  });
});

describe('KalvoraWalletAdapter connected-key validation', () => {
  it('rejects malformed manual and persisted public keys', () => {
    const adapter = new KalvoraWalletAdapter();
    expect(() => adapter.connectManual('A_not-a-canonical-key')).toThrow(
      'valid Kalvora public key identifier'
    );

    localStorage.setItem('zera-wallet-adapter', JSON.stringify({
      publicKey: 'A_attackerControlled',
      mode: 'deeplink'
    }));
    const restored = new KalvoraWalletAdapter();
    expect(restored.connected).toBe(false);
    expect(localStorage.getItem('zera-wallet-adapter')).toBeNull();
  });

  it('rejects a malformed key returned by an injected provider', async () => {
    (browserWindow as unknown as Record<string, unknown>).zera = {
      isZeraWallet: true,
      isConnected: false,
      publicKey: null,
      request: vi.fn().mockResolvedValue(['A_attackerControlled'])
    };
    const adapter = new KalvoraWalletAdapter();

    await expect(adapter.connect()).rejects.toThrow('invalid Kalvora public key');
    expect(adapter.connected).toBe(false);
  });
});

describe('DeepLinkSigner sign callback correlation', () => {
  it('stores a same-tab pending record before starting a deep-link redirect', () => {
    const signer = new DeepLinkSigner(
      VALID_PUBLIC_KEY,
      'zera-wallet://',
      'https://dapp.example/callback'
    );

    void signer.sign(new Uint8Array([1, 2, 3]));

    const pending = JSON.parse(sessionStorage.getItem(SIGN_PENDING_KEY) as string) as {
      type: string;
      requestId: string;
      publicKey: string;
    };
    expect(pending.type).toBe('sign');
    expect(pending.requestId).toMatch(/^zr_sign_/u);
    expect(pending.publicKey).toBe(VALID_PUBLIC_KEY);
    expect(localStorage.getItem(SIGN_PENDING_KEY)).toBeNull();
    expect(browserWindow.location.assign).toHaveBeenCalledOnce();
  });

  it('rejects unsolicited and missing-ID sign callbacks', () => {
    setCallback({ zera_result: VALID_SIGNATURE_BASE64, zera_request_id: 'zr_sign_unsolicited' });
    expect(DeepLinkSigner.checkSignResult()).toBeNull();

    setSignPending('zr_sign_expected');
    setCallback({ zera_result: VALID_SIGNATURE_BASE64 });
    expect(DeepLinkSigner.checkSignResult()).toBeNull();
    expect(sessionStorage.getItem(SIGN_PENDING_KEY)).not.toBeNull();
  });

  it('rejects mismatched and stale sign callbacks', () => {
    setSignPending('zr_sign_expected');
    setCallback({ zera_result: VALID_SIGNATURE_BASE64, zera_request_id: 'zr_sign_other' });
    expect(DeepLinkSigner.checkSignResult()).toBeNull();
    expect(sessionStorage.getItem(SIGN_PENDING_KEY)).not.toBeNull();

    setSignPending('zr_sign_expected', Date.now() - 6 * 60 * 1000);
    setCallback({ zera_result: VALID_SIGNATURE_BASE64, zera_request_id: 'zr_sign_expected' });
    expect(DeepLinkSigner.checkSignResult()).toBeNull();
    expect(sessionStorage.getItem(SIGN_PENDING_KEY)).toBeNull();
  });

  it('accepts an exact live signature once and rejects an invalid signature length', () => {
    setSignPending('zr_sign_expected');
    setCallback({ zera_result: VALID_SIGNATURE_BASE64, zera_request_id: 'zr_sign_expected' });

    const result = DeepLinkSigner.checkSignResult();
    expect(result?.requestId).toBe('zr_sign_expected');
    expect(result?.signature).toHaveLength(64);
    expect(sessionStorage.getItem(SIGN_PENDING_KEY)).toBeNull();

    setCallback({ zera_result: VALID_SIGNATURE_BASE64, zera_request_id: 'zr_sign_expected' });
    expect(DeepLinkSigner.checkSignResult()).toBeNull();

    setSignPending('zr_sign_short');
    setCallback({
      zera_result: Buffer.from(new Uint8Array(63)).toString('base64'),
      zera_request_id: 'zr_sign_short'
    });
    expect(() => DeepLinkSigner.checkSignResult()).toThrow('invalid signature length');
    expect(sessionStorage.getItem(SIGN_PENDING_KEY)).toBeNull();
  });
});

describe('BroadcastChannel callback correlation', () => {
  it('ignores unsolicited and stale connect broadcasts', () => {
    const adapter = new KalvoraWalletAdapter();
    const channel = listenerChannel();

    channel.emit({
      type: 'zera-connect-result',
      publicKey: VALID_PUBLIC_KEY,
      requestId: 'zr_unsolicited'
    });
    expect(adapter.connected).toBe(false);

    setConnectPending('zr_stale', Date.now() - 11 * 60 * 1000);
    channel.emit({
      type: 'zera-connect-result',
      publicKey: VALID_PUBLIC_KEY,
      requestId: 'zr_stale'
    });
    expect(adapter.connected).toBe(false);
    expect(sessionStorage.getItem(CONNECT_PENDING_KEY)).toBeNull();
  });

  it('accepts only an exact pending connect broadcast and consumes it once', () => {
    setConnectPending('zr_expected');
    const adapter = new KalvoraWalletAdapter();
    const connect = vi.fn();
    adapter.on('connect', connect);
    const channel = listenerChannel();

    channel.emit({
      type: 'zera-connect-result',
      publicKey: VALID_PUBLIC_KEY,
      requestId: 'zr_other'
    });
    expect(adapter.connected).toBe(false);

    channel.emit({
      type: 'zera-connect-result',
      publicKey: VALID_PUBLIC_KEY,
      requestId: 'zr_expected'
    });
    expect(adapter.connected).toBe(true);
    expect(adapter.address).toBe(VALID_ADDRESS);
    expect(connect).toHaveBeenCalledWith({
      publicKey: VALID_PUBLIC_KEY,
      address: VALID_ADDRESS,
      mode: 'deeplink'
    });
    expect(sessionStorage.getItem(CONNECT_PENDING_KEY)).toBeNull();
  });

  it('accepts only an exact pending sign broadcast and consumes it once', () => {
    setSignPending('zr_sign_expected');
    const adapter = new KalvoraWalletAdapter();
    const channel = listenerChannel();

    channel.emit({
      type: 'zera-sign-result',
      encodedResult: VALID_SIGNATURE_BASE64,
      requestId: 'zr_sign_other'
    });
    expect(adapter.consumePendingSignResult()).toBeNull();

    channel.emit({
      type: 'zera-sign-result',
      encodedResult: VALID_SIGNATURE_BASE64,
      requestId: 'zr_sign_expected'
    });
    const result = adapter.consumePendingSignResult();
    expect(result).toMatchObject({
      requestId: 'zr_sign_expected',
      operation: 'sign',
      publicKey: VALID_PUBLIC_KEY
    });
    expect(result?.signature).toHaveLength(64);
    expect(sessionStorage.getItem(SIGN_PENDING_KEY)).toBeNull();

    channel.emit({
      type: 'zera-sign-result',
      encodedResult: VALID_SIGNATURE_BASE64,
      requestId: 'zr_sign_expected'
    });
    expect(adapter.consumePendingSignResult()).toBeNull();
  });

  it('ignores unsolicited and stale sign broadcasts', () => {
    const adapter = new KalvoraWalletAdapter();
    const channel = listenerChannel();

    channel.emit({
      type: 'zera-sign-result',
      encodedResult: VALID_SIGNATURE_BASE64,
      requestId: 'zr_sign_unsolicited'
    });
    expect(adapter.consumePendingSignResult()).toBeNull();

    setSignPending('zr_sign_stale', Date.now() - 6 * 60 * 1000);
    channel.emit({
      type: 'zera-sign-result',
      encodedResult: VALID_SIGNATURE_BASE64,
      requestId: 'zr_sign_stale'
    });
    expect(adapter.consumePendingSignResult()).toBeNull();
    expect(sessionStorage.getItem(SIGN_PENDING_KEY)).toBeNull();
  });
});
