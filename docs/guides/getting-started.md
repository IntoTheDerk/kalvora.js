---
title: Getting Started
group: Guides
---

# Getting started

Install the SDK with `npm install kalvora.js`. Local Falcon signing has been tested in Node.js 24 and Microsoft Edge. The Node.js package requires 20.19 or later.

## Create a receiving address

Obtain the network name (`kal_main` or `kal_proto`), final block-zero hash, assigned operator wallet address and HTTPS gRPC-Web endpoint from your operator over a trusted channel. The client uses the operator address to verify signed responses, including contract lookups during minting. The following snippets use the same wallet and client throughout. Supply your own protected key store and a finality verifier for that chain.

```typescript
import { FalconWallet, KalvoraClient } from 'kalvora.js';

const wallet = FalconWallet.generate({
  networkName: 'kal_proto',
  genesisHash: trustedFinalGenesisHashHex
});
await protectedKeyStore.save(wallet.exportBackup());
const client = new KalvoraClient({
  grpc: {
    endpoint: operatorGrpcWebEndpoint,
    trustedOperatorAddress,
    transactionContext: { chainId: wallet.chainId }
  }
});
console.log(wallet.walletAddress); // share this Base58 receiving address
```

The default is Falcon-512 with BLAKE3-256. Store the **unencrypted** backup in protected storage. Use `FalconWallet.restore(savedBackup)` to reopen it. Each hash choice for a key produces an independent address and nonce. A legacy Ed25519 or Ed448 mnemonic still restores its historical wallet. Generate a new Falcon wallet for fresh-genesis deposits.

## Fund and register

An ordinary payment can fund the receiving address before registration. For this self-funded example, deposit enough native KALV to cover registration and payment fees. A separate, already registered single-key wallet can also sponsor registration. The raw nonce RPC returns the committed nonce. The SDK's `getNextNonce` adds one.

```typescript
import { buildWalletRegistration, signAndFinalize } from 'kalvora.js';

if (!await client.query.getSigningWallet(wallet.walletAddress)) {
  const txn = await buildWalletRegistration(wallet, { grpcConfig: client.grpcConfig });
  const signed = await signAndFinalize(txn, wallet);
  const registration = await client.submitAndWait(signed, { verifyFinalizedBlock });
  if (!registration.success) throw new Error(registration.statusName);
}
const registered = await client.query.getSigningWallet(wallet.walletAddress);
const key = registered?.identity.case === 'falcon' ? registered.identity.value : undefined;
const expectedKey = wallet.rawPublicKey;
if (!key || key.variant !== wallet.variant || key.rawPublicKey.length !== expectedKey.length ||
    !key.rawPublicKey.every((byte, i) => byte === expectedKey[i])) {
  throw new Error('The finalized signing key differs from the selected wallet');
}
```

`verifyFinalizedBlock` is an application callback that verifies the expected chain and committee or consults a trusted finalized source. Submission acknowledges queuing. A matched receipt with a present status tells you whether execution succeeded and what fees were charged.

## Make the first payment

A registration finalized in block H enables spending in H+1. The first transaction after a nonce-1 registration normally uses nonce 2. The example fetches the committed nonce and fee inputs through the pinned client configuration.

```typescript
import { createCoinTXN, KALVORA_NATIVE_TOKEN, partsToWhole } from 'kalvora.js';

const { balance, denomination } = await client.query.getBalance(wallet.walletAddress, KALVORA_NATIVE_TOKEN);
console.log(partsToWhole(balance, denomination));

const payment = await createCoinTXN(
  [{ signer: wallet, amount: '1.5' }],
  [{ to: recipientAddress, amount: '1.5' }],
  KALVORA_NATIVE_TOKEN,
  { baseFeeId: KALVORA_NATIVE_TOKEN },
  '',
  client.grpcConfig
);
const result = await client.submitAndWait(payment, { verifyFinalizedBlock });
if (!result.success) throw new Error(result.statusName);
console.log(result.hash, result.blockHeight);
```

Coin amounts use whole tokens. Other builders such as Mint accept amounts in smallest units. For a safe send, set `safeSend: true` in the last Coin build-options argument. Every destination must already be registered in the finalized parent. Creating a destination's first token balance can incur a separate fee.

Keep the signed protobuf and locally computed hash before submitting a payment. If submission times out, reconcile the original receipt and committed nonce. Within the validity window, resubmitting identical bytes preserves the hash. A fresh Falcon signature changes it.

## Sign through an external wallet

Pass the selected registered address to the builder. A compatible adapter supplies that address, a trusted wire chain ID and a signing method. Offline standard builders accept an explicit nonce and authorized fee cap. Coin also needs the token denomination for amount conversion.

```typescript
import { buildMintTXN, signAndFinalize as finalizeMint } from 'kalvora.js';

const unsigned = await buildMintTXN(
  { contractId, amount: 1_000_000n, recipientAddress, publicKey: adapter.address! },
  { grpcConfig: client.grpcConfig }
);
const mint = await finalizeMint(unsigned, adapter.signer!);
```

The signing wallet must hold the contract's mint permission. A provider's public key can have more than one registered address. [Wallet adapter integration](../adapter-integration-guide.md)

## Handle RPC errors

```typescript
import { isKalvoraRpcError, RpcCode } from 'kalvora.js';

try {
  await client.query.getContract(contractId);
} catch (error) {
  if (!isKalvoraRpcError(error) || error.code !== RpcCode.NotFound) throw error;
  console.log('Contract not found');
}
```

For API details, see [transactions](./transactions.md), [contract IDs](./contract-ids.md), [proposals](../../src/proposal/README.md) and [queries](./querying.md).
