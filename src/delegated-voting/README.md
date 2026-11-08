# Delegated voting (`DelegatedTXN`)

Builds a contract-scoped delegation assignment: delegate wallet addresses,
contract/priority pairs, and optional fee authorizations. It carries no proposal
ID or ballot choice. Casting a ballot uses the separate `GovernanceVote` message;
the name `DelegateVote` identifies an assignment entry, not a ballot.

The existing build/create/send functions, input types, priority constants and
`DelegatedTXN` type are available from `kalvora.js/native` without Solana. The
package root retains the same APIs. No new wire format or signing scheme is used.

```ts
import { configureTransactionContext, createDelegatedTXN, sendDelegatedTXN } from 'kalvora.js/native';

// Obtain the exact chain ID independently from trusted operator configuration.
configureTransactionContext({ chainId: trustedChainId });

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
- A `contractId` may appear only once per delegate. The same contract may appear under different delegates.
- `priority` must be an integer in the protobuf int32 range. This is the existing SDK validation, not a guarantee that every value has supported validator semantics.
- `delegateFees` is optional. Each `contractId` may appear only once, and `authAmount` must be a positive integer in parts.

`DelegatedTXN` is not tied to one contract, so the base-fee lookup uses no contract ID.

## Semantics awaiting validator/indexer confirmation

This SDK does not establish priority ordering/ties, negative-priority behavior,
transitive delegation, cycles, direct-vote precedence, assignment replacement or
removal, or fee-authorization clearing/consumption. Validator state schemas use
uint32 priorities while transaction inputs use int32; do not infer a revocation
convention from that difference. The builder continues to reject empty
assignments and zero fee authorizations. `RevokeTXN` concerns NFT/SBT items and
is not a delegation-removal API.

There is no typed delegation-state or voter/proposal transaction-filter query
here. Block decoders retain assignment transactions and raw receipt
`delegatedData`; those fields alone do not prove effective voting weight or
identify the represented voter. Indexer association rules require their own
confirmed contract. RPC acceptance is not processing success or finality.

## Offline / deterministic building

```ts
import { buildDelegatedTXN } from 'kalvora.js/native';

const unsigned = await buildDelegatedTXN(input, {
  nonce: 42,
  feeAmountParts: '1000000',
  timestamp: new Date('2026-01-01T00:00:00Z')
});
```

With the trusted context configured, `nonce` and `feeAmountParts` set, and no
interface-fee lookup requested, the builder makes no network calls. It generates
`KAL_USER_TXN_V1` and `DELEGATED_VOTING_TYPE`; shared signers reject a mismatched
chain, domain or intended type. Native serialization also supports these messages.
