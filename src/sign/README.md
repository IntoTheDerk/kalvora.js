# Transaction signing

Pin the trusted target chain before calling any transaction builder or signing
helper. Obtain its ID from the network operator through a trusted channel:

```typescript
import { configureTransactionContext } from 'kalvora.js';

configureTransactionContext({ chainId: operatorSuppliedHex });
```

`chainId` must contain 64 hexadecimal characters (an optional `0x` prefix is
accepted), or exactly 32 raw bytes. There is no default chain identity, and
the SDK does not adopt one from an RPC response or an incoming transaction.
Endpoint configuration alone does not configure the chain ID.

This sets a process-wide default. Configure it once when the application
starts. Signing helpers accept an optional final `TransactionContext` argument
for offline work involving multiple networks, for example
`signAndFinalize(txn, signer, { chainId: anotherTrustedChainId })`. The same
override is available on `signWithKey`, both Coin signing helpers,
`getTransactionSigningBytes`, `getSponsorSigningBytes`, and
`finalizeTransactionHash`. These helpers check the transaction against the
trusted context; they do not repair a missing or mismatched context.

Builders set the ordinary `KAL_USER_TXN_V1` signature domain, pinned chain ID,
and intended type for the concrete protobuf message before fee sizing and
signing. Validator-generated `ProposalResult` uses its separate
`KAL_PROPOSAL_RESULT_V1` domain and is an internal network message. Public
clients do not create proposal results or sign `RequiredVersion` governance
children.

## Standard and Coin transactions

Build the complete transaction before asking anyone to sign. Timestamp, nonce,
fees, recipients, authorizations, and context are signed fields. The helpers
sign the concrete protobuf bytes and compute a raw SHA3-256 transaction hash.

For standard single-key transactions, use `signAndFinalize(txn, signer)` or
`signWithKey(txn, privateKey, publicKeyId)`. They clear the previous
`base.signature`, `base.hash`, and `base.feePayer` before collecting a fresh
signature. Registration also clears its generated-key co-signature. After an
edit, re-sign and re-hash; a previous sponsor signature or registration
co-signature must be collected again.

For Coin, use `signCoinTXN(txn, signers)` or `signCoinTXNWithKeys(txn, keys)`.
Populate every `auth.publicKey` and `auth.nonce` slot first. Supply signers in
that authorization order. Every input signs the same canonical byte sequence,
with all outer and inner Coin signature arrays cleared on a copy. Signatures
go in `auth.signature`, and `base.signature` stays absent. Re-signing replaces
the previous signatures and hash. Coin cannot use `base.feePayer`; use an
additional Coin input for fee contributions.

## Offline signing and multisig

`getTransactionSigningBytes(txn, context?)` returns the canonical user-signing
bytes without changing `txn`. It clears `base.hash`, `base.signature`, the
entire `base.feePayer`, and any base multisig signatures on a copy. For Coin it
also clears every `auth.signature` and each authorization's inner multisig
signatures; registration clears `generatedSignature`.

Construct all keys, patterns, hash tokens, nonce slots, inputs, outputs, and
fees before getting these bytes. For a base multisig transaction:

```typescript
import { getTransactionSigningBytes, finalizeTransactionHash } from 'kalvora.js';

// unsigned.base.publicKey.multi already contains the approved key/policy data.
const bytes = getTransactionSigningBytes(unsigned, trustedContext);
const multi = unsigned.base!.publicKey!.multi!;
multi.signatures = multi.publicKeys.map(() => new Uint8Array(0));
multi.signatures[firstKeyIndex] = await firstSigner.sign(bytes);
multi.signatures[secondKeyIndex] = await secondSigner.sign(bytes);
// Collect the signatures required by the selected policy before finalizing.
finalizeTransactionHash(unsigned, trustedContext);
```

Each multisig sub-signature occupies the index of its key; leave unsigned
positions as empty byte arrays. Keep `base.signature` absent for a base
multisig. For Coin, the final `auth.signature` array has one slot per
authorization: a single-key input uses its outer slot, while a multisig input
leaves that slot empty and fills the corresponding inner
`auth.publicKey[i].multi.signatures` slots. All input and subkey signers use
the same bytes from `getTransactionSigningBytes`. The single-key convenience
signing helpers do not collect multisig signatures.

After assembling the complete signed message, `finalizeTransactionHash`
computes its hash with `base.hash` absent. It does not gather signatures or
verify that a multisig policy has enough signatures. If any approved field
changes, obtain new canonical bytes and collect fresh signatures.

## Fee sponsorship

Only transaction types allowed by the validator's fee-payer policy support
sponsorship. Sign the user's complete transaction with `base.feePayer` absent.
Then attach the sponsor's single public key and independent nonce, with its
signature empty. `getSponsorSigningBytes(txn, context?)` clears only
`base.hash` and `base.feePayer.signature` on a copy. It preserves the user
signature, the sponsor key and nonce, and the signed transaction context:

```typescript
import { getSponsorSigningBytes, finalizeTransactionHash } from 'kalvora.js';

// signed.base.feePayer has already been populated with sponsor key and nonce.
const bytes = getSponsorSigningBytes(signed, trustedContext);
signed.base!.feePayer!.signature = await sponsorSigner.sign(bytes);
finalizeTransactionHash(signed, trustedContext);
```

Do not call a user-signing helper after adding the sponsor: those helpers
remove the sponsor authorization to prepare a fresh user signature. A changed
user transaction requires both parties to sign again.

## Validator registration

Registration uses the ordinary user domain and its concrete registration type.
Build with `generatedPublicKey` set and `generatedSignature` empty. The owner
signs with `base.hash`, `base.signature`, and `generatedSignature` absent, then
the SDK computes `base.hash`. The generated operational key signs that raw
32-byte hash as a separate co-signature. `createValidatorRegistrationTXN`
performs these steps; the equivalent manual sequence is
`buildValidatorRegistrationTXN`, `signWithKey`, then
`attachGeneratedSignature`. The co-signature is excluded from the owner
signing bytes and registration hash.

## Timestamp and receipt handling

Ordinary signed transactions, including proposals, votes, and cancellations,
must have a timestamp within ten minutes before or after both admission and
first block inclusion. Builders use the current time unless an explicit
timestamp is supplied. If a transaction ages out, rebuild with a current
timestamp and valid current nonce, then collect all signatures and compute a
fresh hash.

RPC acceptance means admission for processing. Require a matching processing
receipt with an explicitly present `TXNStatusFees.status`, then verify the
block's finality evidence before treating it as confirmed. See the
[query module](../query/README.md).
