# Allowance (`AllowanceTXN`)

Lets the signer (the **granter**) authorize another wallet (the **spender**) to move a capped amount of one token out of the granter's wallet. Submitted with `TXNService.Allowance`.

## Fields

| Input | Proto field | Notes |
|---|---|---|
| `publicKey` | `base.public_key` | Granter's base58 public key identifier (`A_…`) |
| `contractId` | `contract_id` | Token the spender may move |
| `walletAddress` | `wallet_address` | Spender's base58 address; must not be the granter |
| `allowedAmount` | `allowed_amount` | Cap in smallest units (parts) |
| `allowedCurrencyEquivalent` | `allowed_currency_equivalent` | Cap in USD, scaled so `1e18` = $1.00 |
| `periodMonths` / `periodSeconds` | `period_months` / `period_seconds` | Optional reset period (uint32, > 0) |
| `startTime` | `start_time` | Required when authorizing |
| `authorize` | `authorize` | `true` (default) grants, `false` revokes |

Rules:
- When authorizing, give **exactly one** of `allowedAmount` / `allowedCurrencyEquivalent`.
- Give **at most one** of `periodMonths` / `periodSeconds`. If you give neither, the allowance never resets.

Use `usdToCurrencyEquivalent('12.50')` to get `'12500000000000000000'`, and `currencyEquivalentToUsd` to convert back. Both use exact integer math.

## Full flow

```ts
import { createAllowanceTXN, sendAllowanceTXN, usdToCurrencyEquivalent,
         createRevokeAllowanceTXN } from 'kalvora.js';
import { createCoinTXN, sendCoinTXN } from 'kalvora.js';

// 1. Alice lets Bob spend up to $250 of KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao per month.
const grant = await createAllowanceTXN({
  publicKey: alice.publicKey,
  contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  walletAddress: bob.address,
  allowedCurrencyEquivalent: usdToCurrencyEquivalent('250.00'),
  periodMonths: 1,
  startTime: new Date()
}, alice.privateKey);
await sendAllowanceTXN(grant);

// 2. Bob spends from Alice's wallet with a CoinTXN. His own input comes first:
//    it signs and pays the fee, and has no amount. Next comes an input that
//    names Alice's address as `allowanceAddress`.
const spend = await createCoinTXN(
  [
    { publicKey: bob.publicKey, privateKey: bob.privateKey },
    { allowanceAddress: alice.address, amount: '10' }
  ],
  [{ to: carol.address, amount: '10' }],
  'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
);
await sendCoinTXN(spend);

// 3. Alice revokes the allowance.
await sendAllowanceTXN(await createRevokeAllowanceTXN(
  { publicKey: alice.publicKey, contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', walletAddress: bob.address },
  alice.privateKey
));
```

To revoke, you can also call `buildAllowanceTXN` / `createAllowanceTXN` with `authorize: false`. A revocation needs no cap. `startTime` defaults to the transaction timestamp.

## Offline / deterministic building

Pass both `nonce` and `feeAmountParts` and the builder makes no network calls. Add a fixed `timestamp` as well and the bytes and hash are fully reproducible. This suits cold signing and tests:

```ts
const unsigned = await buildAllowanceTXN(input, {
  nonce: 42,                 // signer's next nonce (current + 1)
  feeAmountParts: '1000000', // exact base fee in parts of feeId
  timestamp: new Date('2026-01-01T00:00:00Z')
});
```
