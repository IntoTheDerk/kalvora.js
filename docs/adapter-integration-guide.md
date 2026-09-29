# Kalvora Wallet Adapter — Integration Guide

Connect your site to Kalvora wallets with a few lines of code using `kalvora.js`.

---

## Install

```bash
npm install kalvora.js
```

---

## Quickstart

```typescript
import {
  KalvoraWalletAdapter,
  buildVoteTXN,
  PROTONET_GRPC_CONFIG,
  signAndFinalize,
  sendVoteTXN,
} from "kalvora.js";

const grpcConfig = PROTONET_GRPC_CONFIG;
const proposalHash = "00".repeat(32);

// 1. Connect
const adapter = new KalvoraWalletAdapter();
await adapter.connect();
console.log("Connected:", adapter.publicKey);

// 2. Build an unsigned transaction
const txn = await buildVoteTXN(
  "KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao",
  proposalHash, // 64 hexadecimal characters
  adapter.publicKey!,
  { support: true, grpcConfig },
);

// 3. Sign via wallet (no private keys needed)
const signed = await signAndFinalize(txn, adapter.signer!);

// 4. Submit
const hash = await sendVoteTXN(signed, grpcConfig);
console.log("Vote submitted:", hash);

// 5. Disconnect
await adapter.disconnect();
```

---

## How It Works

```
Your dApp                             Kalvora wallet
─────────                             ──────────────
adapter.connect()
  └─→ provider.request(KALVORA_PROVIDER_METHODS.requestAccounts)
       └─→ Approval prompt ─── user approves
            └─→ Returns public key

adapter.signer.sign(txnBytes)
  └─→ provider.request(KALVORA_PROVIDER_METHODS.signTransaction)
       └─→ Wallet authentication ─── user confirms
            └─→ Signs with the private key
                 └─→ Returns the signature
```

`provider` is the object a compatible wallet's dApp browser injects at
`window[KALVORA_INJECTED_PROVIDER_KEY]` and marks with
`KALVORA_PROVIDER_FLAG`. The adapter detects it and produces a `WalletSigner`
that implements the SDK's `KalvoraSigner` interface, so `signAndFinalize()`
and every `build*` function work unchanged. Private keys never leave the
wallet.

### Two connection strategies

1. **Embedded** — inside a wallet's dApp browser the injected provider is
   used directly: no redirects, and `connect()` resolves with the public key.
2. **Deep link** — in an external browser (Safari, Chrome, Brave) `connect()`
   navigates to `<deepLinkUrl>connect?callback=…&requestId=…`. The wallet app
   asks for approval and redirects back to your page with the result in the
   query parameters listed in `KALVORA_DEEP_LINK_PARAMS`. The page reloads,
   so the promise from `connect()` never resolves; a new
   `KalvoraWalletAdapter` reads the callback in its constructor, checks that
   the request id matches the one it stored in `sessionStorage`, and emits
   `connect`. Signing with the resulting `DeepLinkSigner` works the same way:
   `sign()` navigates away and the adapter emits `signResult` (or
   `signError`) after the redirect back. Call
   `adapter.consumePendingSignResult()` if your listener is registered after
   the adapter was constructed.

Callbacks that do not match a live pending request are ignored, and the
address a wallet returns must match the one derived from its public key.

### Protocol constants

The strings the adapter exchanges with wallet apps are fixed by the wallet
protocol and exported as constants, so you never need to hard-code them:

| Constant | Meaning |
| --- | --- |
| `KALVORA_INJECTED_PROVIDER_KEY` | `window` property holding the injected provider |
| `KALVORA_PROVIDER_FLAG` | Boolean property that identifies a Kalvora provider |
| `KALVORA_PROVIDER_METHODS` | `requestAccounts`, `signTransaction`, `disconnect` request methods |
| `KALVORA_DEEP_LINK_SCHEME` | URL scheme registered by wallet apps |
| `KALVORA_DEFAULT_DEEP_LINK` | Default `deepLinkUrl` (the scheme followed by `://`) |
| `KALVORA_DEEP_LINK_PARAMS` | Callback query parameters: `result`, `error`, `address`, `requestId` |
| `KALVORA_WC_NAMESPACE` / `KALVORA_WC_METHODS` | WalletConnect v2 namespace and methods |

---

## API Reference

### `KalvoraWalletAdapter`

```typescript
const adapter = new KalvoraWalletAdapter(config?: WalletAdapterConfig);
```

| Config        | Type    | Default            | Description                   |
| ------------- | ------- | ------------------ | ----------------------------- |
| `autoConnect` | boolean | `false`            | Auto-connect on creation      |
| `deepLinkUrl` | string  | `KALVORA_DEFAULT_DEEP_LINK` | Deep link base for mobile redirect |
| `signTimeout` | number  | `300000` (5 min)   | Signing request timeout (ms)  |
| `callbackUrl` | string  | current page       | Explicit URL for wallet callbacks |

#### Properties

| Property     | Type                   | Description                                     |
| ------------ | ---------------------- | ----------------------------------------------- |
| `connected`  | `boolean`              | Whether wallet is connected                     |
| `publicKey`  | `string \| null`       | Connected wallet's public key                   |
| `address`    | `string \| null`       | Connected wallet's address (verified against the public key) |
| `signer`     | `WalletSigner \| DeepLinkSigner \| null` | KalvoraSigner for use with `signAndFinalize` |
| `state`      | `WalletAdapterState`   | `'disconnected' \| 'connecting' \| 'connected'` |
| `isEmbedded` | `boolean`              | True if connected through the injected provider |
| `connectionMode` | `'embedded' \| 'deeplink' \| 'manual' \| null` | How the wallet is connected |

#### Methods

| Method                | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `connect()`           | Detect provider, request accounts, returns public key (deep-link mode navigates away) |
| `connectManual(publicKey)` | View-only connection with a known key; signing uses deep links |
| `disconnect()`        | Disconnect and clear state                               |
| `on(event, handler)`  | Listen for `connect`, `disconnect`, `error`, `signResult`, `signError` |
| `consumePendingSignResult()` | Take a sign result delivered before your listener was attached |
| `off(event, handler)` | Remove event listener                                    |
| `getDeepLink(url?)`   | Generate wallet deep link for the given URL              |

#### Static Methods

| Method                               | Description                           |
| ------------------------------------ | ------------------------------------- |
| `KalvoraWalletAdapter.isAvailable()`    | Check if a Kalvora provider is injected |
| `KalvoraWalletAdapter.getDetectionStatus()` | `'injected'`, `'available'` (mobile, deep link) or `'unknown'` |
| `KalvoraWalletAdapter.truncateKey(key)` | Truncate a key for display            |

---

## React Integration

```tsx
import { useState, useEffect, useCallback } from "react";
import {
  PROTONET_GRPC_CONFIG,
  KalvoraWalletAdapter,
  buildVoteTXN,
  sendVoteTXN,
  signAndFinalize,
} from "kalvora.js";

const grpcConfig = PROTONET_GRPC_CONFIG;

// Custom hook
function useKalvoraWallet() {
  const [adapter] = useState(() => new KalvoraWalletAdapter());
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    adapter.on("connect", ({ publicKey }: any) => {
      setConnected(true);
      setPublicKey(publicKey);
    });
    adapter.on("disconnect", () => {
      setConnected(false);
      setPublicKey(null);
    });
    return () => {
      adapter.disconnect();
    };
  }, [adapter]);

  const connect = useCallback(() => adapter.connect(), [adapter]);
  const disconnect = useCallback(() => adapter.disconnect(), [adapter]);

  return { adapter, connected, publicKey, connect, disconnect };
}

// Usage in a component
function VoteButton({ proposalHash }: { proposalHash: string }) {
  const { adapter, connected, publicKey, connect } = useKalvoraWallet();

  const handleVote = async () => {
    if (!connected) await connect();

    const txn = await buildVoteTXN(
      "KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao",
      proposalHash,
      adapter.publicKey!,
      { support: true, grpcConfig },
    );

    const signed = await signAndFinalize(txn, adapter.signer!);
    await sendVoteTXN(signed, grpcConfig);
  };

  return (
    <button onClick={connected ? handleVote : connect}>
      {connected ? "Cast Vote" : "Connect Wallet"}
    </button>
  );
}
```

---

## Vanilla JavaScript

```html
<button id="connect">Connect Wallet</button>
<button id="vote" disabled>Vote</button>

<script type="module">
  import {
    KalvoraWalletAdapter,
    buildVoteTXN,
    PROTONET_GRPC_CONFIG,
    signAndFinalize,
    sendVoteTXN,
  } from "kalvora.js";

  const grpcConfig = PROTONET_GRPC_CONFIG;
  const proposalHash = "00".repeat(32);

  const adapter = new KalvoraWalletAdapter();

  document.getElementById("connect").onclick = async () => {
    await adapter.connect();
    document.getElementById("vote").disabled = false;
    document.getElementById("connect").textContent = adapter.publicKey;
  };

  document.getElementById("vote").onclick = async () => {
    const txn = await buildVoteTXN(
      "KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao",
      proposalHash,
      adapter.publicKey,
      { support: true, grpcConfig },
    );
    const signed = await signAndFinalize(txn, adapter.signer);
    await sendVoteTXN(signed, grpcConfig);
    alert("Vote submitted!");
  };
</script>
```

---

## Desktop Fallback

When not inside a wallet's dApp browser, redirect users:

```typescript
const adapter = new KalvoraWalletAdapter();

if (!KalvoraWalletAdapter.isAvailable()) {
  // Redirect to a Kalvora-compatible wallet with this page's URL
  window.location.href = adapter.getDeepLink();
} else {
  await adapter.connect();
}
```

---

## WalletConnect v2

For wallets on another device, use a WalletConnect v2 `SignClient` from
`@walletconnect/sign-client` (not bundled with kalvora.js) and the namespace
constants the SDK exports:

```typescript
import {
  KALVORA_WC_REQUIRED_NAMESPACES,
  WalletConnectSigner,
  signAndFinalize,
} from "kalvora.js";

const { uri, approval } = await signClient.connect({
  requiredNamespaces: KALVORA_WC_REQUIRED_NAMESPACES,
});
// show `uri` as a QR code, then:
const session = await approval();

const signer = new WalletConnectSigner(signClient, session, walletPublicKey);
const signed = await signAndFinalize(unsignedTxn, signer);
```

`ALL_WC_REQUIRED_NAMESPACES` requests the Kalvora and Solana namespaces
together.

---

## Transaction Types

The adapter works with **all** SDK transaction builders:

| Builder                          | Use Case             |
| -------------------------------- | -------------------- |
| `buildCoinTXN()`                 | Token transfers      |
| `buildVoteTXN()`                 | Governance voting    |
| `buildContractTXN()`             | Contract deployment  |
| `buildContractUpdateTXN()`       | Contract updates     |
| `buildSmartContractTXN()`        | Smart contract deployment |
| `buildSmartContractExecuteTXN()` | Smart contract calls |
| `buildSmartContractInstantiateTXN()` | Smart contract instantiation |
| `buildItemizedMintTXN()`         | NFT/SBT item minting |
| `buildNFTTXN()`                  | NFT item transactions |
| `buildBurnSBTTXN()`              | SBT item burns       |

The sign step is shared, but each builder and sender has its own documented
arguments. For example, a vote uses positional identifiers plus an options
object:

```typescript
const txn = await buildVoteTXN(
  "KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao",
  proposalHash,
  adapter.publicKey!,
  { support: true, grpcConfig },
);
const signed = await signAndFinalize(txn, adapter.signer!);
await sendVoteTXN(signed, grpcConfig);
```
