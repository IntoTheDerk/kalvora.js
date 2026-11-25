# Transaction signing

Ordinary user transactions bind their concrete protobuf type, the `KAL_USER_TXN_V1` domain and a trusted 32-byte chain ID before fee sizing. Derive the ID with `deriveChainId(networkName, finalGenesisHash)`. Use a pinned client configuration for independent networks, or set one application-wide pin with `configureTransactionContext({ chainId })`.

## Owner and policy proofs

Use `signAndFinalize(txn, signer)` with a single-key or policy wallet. The signing copy clears the hash, base signature, owner witnesses and fee payer. A single-key wallet places its padded signature in the base. Policy members sign the same bytes and their witnesses occupy increasing slots in the registered descriptor. The policy owns its nonce.

For Coin, build the authorization slots and nonces, then pass the signers in order to `signCoinTXN(txn, signers)`. All inputs sign the same bytes with all authorization proofs cleared. Each policy input keeps an empty signature slot and stores witnesses on its authorization identity. A Coin sponsor contributes a signed zero-amount input and its own fee shares.

## Sponsorship and offline signing

For a supported non-Coin type, include the sponsor in fee sizing, collect the owner proof, then call `countersignTransaction(txn, sponsor, sponsorNonce)`. The countersignature covers the owner's approval and the sponsor's address and nonce. `finalizeTransactionHash` clears only the hash and commits all attached proofs with SHA3-256. Changing the cap, nonce, timestamp or another signed field requires fresh proofs.

For detached signing, `getTransactionSigningBytes` and `getSponsorSigningBytes` return the corresponding canonical protobuf bytes. Confirm the chain and intent independently on the signing device. Route validator assignments through the [two-role registration helpers](../validator-ops/README.md).

The historical Ed helpers `signWithKey` and `signCoinTXNWithKeys` remain available for archived formats. Fresh-genesis transactions use registered signer paths.
