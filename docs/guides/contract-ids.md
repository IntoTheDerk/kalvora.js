---
title: Contract IDs
group: Guides
---

# Contract IDs

A Kalvora contract ID is the canonical Base58 encoding of a 32-byte BLAKE3
digest followed by a 4-byte BLAKE3 checksum (36 bytes decoded). Wallet
addresses are a different encoding. Do not pass an address to these helpers.

```typescript
import {
  GENESIS_CONTRACT_IDS,
  GENESIS_CONTRACT_NONCES,
  deriveGenesisContractId,
  isCanonicalContractId,
  isKalvoraMintId,
  decodeContractId
} from 'kalvora.js';

GENESIS_CONTRACT_IDS.KALV;                         // native token
deriveGenesisContractId(GENESIS_CONTRACT_NONCES.KALV) === GENESIS_CONTRACT_IDS.KALV;

isCanonicalContractId(GENESIS_CONTRACT_IDS.PREGOV); // true
isKalvoraMintId('$sol-USDC');                       // true — bridged form, not a checksum ID
decodeContractId(GENESIS_CONTRACT_IDS.KALV);        // { digest, checksum } or undefined
```

`isKalvoraMintId` accepts a checksum ID or a bridged id
`$chain-SYMBOL` with an optional `+version`. Placeholder ids such as
`KAL111112` are rejected. `KALVORA_NATIVE_TOKEN` is `GENESIS_CONTRACT_IDS.KALV`.

## Genesis IDs

`deriveGenesisContractId(vanityNonce)` hashes the domain, the network id, and
the nonce as a big-endian u64. It does not include a creator or a
contract-data hash. The published block-zero nonces and ids are
`GENESIS_CONTRACT_NONCES` and `GENESIS_CONTRACT_IDS` (`KALV`, `PREGOV`,
`KIP`, `LEGAL`, `MINT`, `TREASURY`, `TECH`, `MARKETING`, `BRIDGETOKENS`,
`BRIDGEGUARDIANS`, `SMARTCONTRACTMAINTENANCE`).

The vanity nonce is not `BaseTXN.nonce`.

## Ordinary IDs

An ordinary id commits the creator, a vanity nonce, and a hash of the
immutable contract fields. `buildContractTXN` (`buildInstrumentContract`)
does this when you pass `vanityNonce` and omits `contractId`. If you pass
both, the derived id must match `contractId`.

```typescript
import { buildContractTXN, CONTRACT_TYPE } from 'kalvora.js';

const unsigned = await buildContractTXN({
  contractVersion: 1000000n,
  symbol: 'MYT',                 // [A-Z0-9]{3,20}
  name: 'My Token',              // [A-Za-z0-9 ]{3,200}
  type: CONTRACT_TYPE.TOKEN,
  vanityNonce: 1n,
  publicKeyBase58Identifier: publicKey,
  coinDenomination: { denominationName: 'parts', amount: '1000000000' }
});
unsigned.contractId;             // the derived Base58 id
```

`symbol` and the optional denomination amount are part of the id preimage.
`deriveContractDataHash` and `deriveOrdinaryContractId` expose the same
steps when you need the id before building the transaction.
`CREATOR_AUTHORIZATION` is `SINGLE_KEY` (1), `SMART_CONTRACT` (2), or
`GOVERNANCE` (3). `CREATOR_KEY_ALGORITHM` is `NONE` (0), `ED25519` (1), or
`ED448` (2). Creator bytes are the exact `base.public_key` bytes: for a
user key that is the `A_` or `B_` prefix plus the raw public key.

Token contracts require `coinDenomination`. NFT and SBT contracts must leave
`coinDenomination`, `premintWallets`, `expenseRatio`, and `contractFees`
unset. At most 50 restricted keys are accepted. A calculated creation fee
of exactly `"1"` is refused.

`encodeContractId` turns a 32-byte digest into the checksummed Base58 id.
`contractIdChecksum` is the first 4 bytes of the checksum hash.
`canonicalDecimal` strips leading zeros from a uint256 string used in a
preimage.
