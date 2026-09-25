---
title: Getting Started
group: Guides
---

# Getting Started

## Install

```bash
npm install kalvora.js
```

Node.js ≥ 20, modern browsers, and React Native are supported. The package
ships ESM (`dist/index.mjs`), CommonJS (`dist/index.cjs`), and type
declarations.

## 1. Create a wallet

```typescript
import { createWallet, generateMnemonicPhrase, KEY_TYPE, HASH_TYPE } from 'kalvora.js';

const mnemonic = generateMnemonicPhrase(24);
const wallet = await createWallet({
  keyType: KEY_TYPE.ED25519,
  hashTypes: [HASH_TYPE.SHA3_256],
  mnemonic
});

wallet.address;    // base58 wallet address
wallet.publicKey;  // public key identifier used by every builder
wallet.privateKey; // base58 private key — keep secret
wallet.secureClear(); // wipe key material from memory when done
```

Kalvora uses SLIP-0010 hardened derivation with coin type `5258`
(`m/44'/5258'/account'/change'/address'`).

## 2. Connect to the network

```typescript
import { KalvoraClient } from 'kalvora.js';

const kalvora = new KalvoraClient();            // protonet, HTTPS
// const kalvora = new KalvoraClient({ grpc: { endpoint: 'https://my-node.example:443' } });

const nonce = await kalvora.query.getNextNonce(wallet.address);
const { balance, denomination } = await kalvora.query.getBalance(wallet.address, kalvora.nativeToken);
```

All amounts returned by the query client are `bigint`s in the token's
smallest unit. Convert for display with `partsToWhole(balance, denomination)`.

## 3. Send tokens

```typescript
import { createCoinTXN, KALVORA_NATIVE_TOKEN } from 'kalvora.js';

const txn = await createCoinTXN(
  [{ publicKey: wallet.publicKey, privateKey: wallet.privateKey, amount: '1.5' }],
  [{ to: recipientAddress, amount: '1.5' }],
  KALVORA_NATIVE_TOKEN,
  { baseFeeId: KALVORA_NATIVE_TOKEN },
  '',
  kalvora.grpcConfig
);

const result = await kalvora.submitAndWait(txn);
if (!result.success) {
  throw new Error(`Transaction failed on-chain: ${result.statusName}`);
}
console.log(`Included in block ${result.blockHeight}`);
```

`CoinTXN` amounts are in whole tokens (`'1.5'`); the SDK converts them using
the token's denomination. Newer single-purpose builders (mint, allowance, …)
take smallest-unit amounts to avoid a network lookup — see each module's docs.

## 4. Sign elsewhere (wallets, hardware, cold storage)

Every transaction type has an unsigned `build*` step. Sign with any
`KalvoraSigner` implementation:

```typescript
import { buildMintTXN, signAndFinalize, type KalvoraSigner } from 'kalvora.js';

const unsigned = await buildMintTXN(
  { contractId, amount: 1_000_000n, recipientAddress, publicKey: signer.publicKey },
  { grpcConfig: kalvora.grpcConfig }
);

const signer: KalvoraSigner = {
  publicKey: wallet.publicKey,
  sign: bytes => myHardwareWallet.sign(bytes)
};
const signed = await signAndFinalize(unsigned, signer);
await kalvora.submit(signed);
```

Pass both `nonce` and `feeAmountParts` to build without any network access.

## 5. Handle errors

```typescript
import { isKalvoraRpcError, RpcCode } from 'kalvora.js';

try {
  await kalvora.query.getContract('KALdoesnotexist');
} catch (error) {
  if (isKalvoraRpcError(error)) {
    console.log(error.codeName, error.method, error.detail); // e.g. INVALID_ARGUMENT Contract …
  }
}
```

## Next steps

- [Transactions](./transactions.md) — every transaction type, permissions, and options.
- [Querying](./querying.md) — balances, contracts, blocks, events, waiting for inclusion.
- [Architecture](./architecture.md) — transport, signing, and protocol sync.
- [Coming from zera.js](./coming-from-zera-js.md).
