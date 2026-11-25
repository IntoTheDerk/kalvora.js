# Expense ratio (`ExpenseRatioTXN`)

Starts collection of a contract's configured expense ratio. The contract's `expense_ratio` schedule is a list of `{ day, month, percent }` entries, where `percent` uses 100,000 = 100%. Collection pulls from the listed holder addresses into an output address. Submitted with `TXNService.ExpenseRatio`.

The signer must hold the contract's `expense_ratio` restricted-key permission. The transaction carries no amounts: validators compute each wallet's amount from the contract's schedule, and report the results in an `ExpenseRatioResult`. A repeated collection is rejected with `EXPENSE_RATIO_DUPLICATE`.

```ts
import { createExpenseRatioTXN, sendExpenseRatioTXN } from 'kalvora.js';

const txn = await createExpenseRatioTXN({
  publicKey: manager.walletAddress,
  contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  addresses: [holder1.walletAddress, holder2.walletAddress],
  outputAddress: treasury.walletAddress
}, manager, { grpcConfig: client.grpcConfig });
await sendExpenseRatioTXN(txn, client.grpcConfig);
```

## Offline / deterministic building

Payers must be distinct wallet addresses. The payout accepts a wallet address or the burn address `W5jE3KNH`. With an empty payer list, the output can be omitted.

```ts
const unsigned = await buildExpenseRatioTXN(input, {
  grpcConfig: client.grpcConfig,
  nonce: 42,
  feeAmountParts: '1000000',
  timestamp: new Date('2026-01-01T00:00:00Z')
});
```

With `nonce` and `feeAmountParts` set, the builder makes no network calls, and the base fee lookup for `contractId` is skipped.
