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
Your dApp                         Kalvora Wallet
────────                         ──────────
adapter.connect()
  └─→ window.zera.request('zera_requestAccounts')
       └─→ Approval Modal ─── User approves
            └─→ Returns public key

adapter.signer.sign(txnBytes)
  └─→ window.zera.request('zera_signTransaction')
       └─→ Auth Gate (PIN / Biometric) ─── User authenticates
            └─→ Signs with private key
                 └─→ Returns signature
```

The `KalvoraWalletAdapter` detects `window.zera` (injected by a compatible wallet's dApp browser)
and produces a `WalletSigner` that implements the SDK's `KalvoraSigner` interface.
This means all existing SDK functions like `signAndFinalize()` work seamlessly.

---

## API Reference

### `KalvoraWalletAdapter`

```typescript
const adapter = new KalvoraWalletAdapter(config?: WalletAdapterConfig);
```

| Config        | Type    | Default            | Description                   |
| ------------- | ------- | ------------------ | ----------------------------- |
| `autoConnect` | boolean | `false`            | Auto-connect on creation      |
| `deepLinkUrl` | string  | `'zera-wallet://'` | Deep link for mobile redirect |
| `signTimeout` | number  | `300000` (5 min)   | Signing request timeout (ms)  |
| `callbackUrl` | string  | current page       | Explicit URL for wallet callbacks |

#### Properties

| Property     | Type                   | Description                                     |
| ------------ | ---------------------- | ----------------------------------------------- |
| `connected`  | `boolean`              | Whether wallet is connected                     |
| `publicKey`  | `string \| null`       | Connected wallet's public key                   |
| `signer`     | `WalletSigner \| DeepLinkSigner \| null` | KalvoraSigner for use with `signAndFinalize` |
| `state`      | `WalletAdapterState`   | `'disconnected' \| 'connecting' \| 'connected'` |
| `isEmbedded` | `boolean`              | True if inside a wallet's dApp browser          |

#### Methods

| Method                | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `connect()`           | Detect provider, request accounts, returns public key    |
| `disconnect()`        | Disconnect and clear state                               |
| `on(event, handler)`  | Listen for connection, error, and correlated sign-result events |
| `off(event, handler)` | Remove event listener                                    |
| `getDeepLink(url?)`   | Generate wallet deep link for the given URL              |

#### Static Methods

| Method                               | Description                           |
| ------------------------------------ | ------------------------------------- |
| `KalvoraWalletAdapter.isAvailable()`    | Check if a Kalvora provider is available |
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
function useZeraWallet() {
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
  const { adapter, connected, publicKey, connect } = useZeraWallet();

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

## Transaction Types

The adapter works with **all** SDK transaction builders:

| Builder                          | Use Case             |
| -------------------------------- | -------------------- |
| `buildCoinTXN()`                 | Token transfers      |
| `buildVoteTXN()`                 | Governance voting    |
| `buildContractTXN()`             | Contract deployment  |
| `buildContractUpdateTXN()`       | Contract updates     |
| `buildSmartContractTXN()`        | Smart contract deployment |
| `buildSmartContractTXN()`  | Smart contract deployment alias |
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
