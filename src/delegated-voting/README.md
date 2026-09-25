# Delegated voting (`DelegatedTXN`)

Lets the signer (the **delegator**) give its governance voting power to one or more delegate wallets, per voting contract, with a priority for each pair. It can also pre-authorize fee spending through `DelegateFees`. Submitted with `TXNService.DelegatedVoting`.

```ts
import { createDelegatedTXN, sendDelegatedTXN } from 'kalvora.js';

const txn = await createDelegatedTXN({
  publicKey: alice.publicKey,
  delegateVotes: [
    { address: bob.address,     contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 1 }] },
    { address: charlie.address, contracts: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', priority: 2 }] }
  ],
  delegateFees: [{ contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', authAmount: '1000000000' }] // parts
}, alice.privateKey);
await sendDelegatedTXN(txn);
```

## Validation

- `delegateVotes` must not be empty, and neither may any delegate's `contracts`.
- A delegate address may appear only once and must not be the signer.
- A `contractId` may appear only once per delegate. The same contract may appear under different delegates, where their priorities rank them.
- `priority` must be an integer in the int32 range. The validator stores priorities as `uint32`, so prefer non-negative values.
- `delegateFees` is optional. Each `contractId` may appear only once, and `authAmount` must be a positive integer in parts.

`DelegatedTXN` is not tied to one contract, so the base-fee lookup uses no contract ID.

## Offline / deterministic building

```ts
const unsigned = await buildDelegatedTXN(input, {
  nonce: 42,
  feeAmountParts: '1000000',
  timestamp: new Date('2026-01-01T00:00:00Z')
});
```

With `nonce` and `feeAmountParts` set, the builder makes no network calls.
