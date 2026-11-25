# Coin transactions

`buildCoinTXN` builds an unsigned protobuf. Supply each signer's selected Base58 wallet address in `inputs[].publicKey` and authorize the result with `signCoinTXN(transaction, signers)`. `createCoinTXN` also accepts a registered signer directly in `inputs[].signer`. A policy uses its own address, nonce and participating witnesses. [Registration and signing](../sign/README.md)

## Transfer with a fee sponsor

Input and output amounts use whole-token decimal strings. Each input has independent `feePercent` and `contractFeePercent` shares between 0 and 100, with up to six decimal places. Each column must add up to 100. A contract-fee share defaults to that input's base-fee share.

```typescript
import { createCoinTXN, KALVORA_NATIVE_TOKEN, submitTransaction } from 'kalvora.js';

const transactionContext = { chainId: owner.chainId };
const coin = await createCoinTXN(
  [
    { signer: owner, amount: '3', feePercent: '0', contractFeePercent: '100' },
    { signer: sponsor, amount: '0', feePercent: '100', contractFeePercent: '0' }
  ],
  [{ to: recipientAddress, amount: '3' }], KALVORA_NATIVE_TOKEN, {}, '',
  { endpoint: apiEndpoint, transactionContext },
  { safeSend: true }
);
const hash = await submitTransaction(coin, { endpoint: txnEndpoint, transactionContext });
```

Opt into `safeSend` when every output must already have a signing-wallet registration in the finalized parent. Ordinary transfers may fund a wallet before registration. A new asset balance row can incur a separate fee.

## Allowance debits

Place one signing spender first, followed by one or more inputs with `allowanceAddress`, an amount, fee shares and an optional source nonce. The spender signs the common transaction with its own authorization nonce. The source addresses and their nonces use the separate allowance arrays, indexed in transfer order.

## Fee caps and offline building

Automatic quotes price each authorization and serialize a copy containing the selected proofs, all witnesses, a 32-byte hash and the decimal cap. Set `proofLayout.coin` to one variant or list of witness slots and variants per authorization when using policy inputs. A single-key variant can be resolved from the registry. Use the active `nonNativeMultiplier` for a non-native fee instrument. The legacy schedule default is 10.

An explicit `baseFeeParts` or `contractFeeParts` sets the corresponding cap in smallest units. Supply each next nonce and a preloaded `tokenInfoMap` in the final build options for offline construction. Base fee quotes include distinct first-time asset balance rows. `needsInitialization` can override the balance lookup if the caller knows the destination state.

For settlement, match the returned hash to a receipt with a present successful status in a trusted finalized block. Keep the original signed bytes when retrying submission.
