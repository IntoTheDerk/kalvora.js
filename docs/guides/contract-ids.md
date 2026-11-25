---
title: Contract IDs
group: Guides
---

# Contract IDs

A Kalvora contract ID is the canonical Base58 encoding of a 32-byte BLAKE3
digest followed by a 4-byte BLAKE3 checksum (36 bytes decoded). Wallet
addresses use the full selected hash. A contract creator's wallet address enters ordinary ID derivation as raw bytes.

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
does this when you pass `vanityNonce` and omit `contractId`. If you pass
both, the derived id must match `contractId`.

```typescript
import { buildContractTXN, CONTRACT_TYPE, FalconWallet, proto, signAndFinalize } from 'kalvora.js';
import { create } from '@bufbuild/protobuf';

// Restore the registered signer from your protected key store.
const owner = FalconWallet.restore(await protectedKeyStore.load());

const unsigned = await buildContractTXN({
  contractVersion: 1000000n,
  symbol: 'MYT',                 // [A-Z0-9]{3,20}
  name: 'My Token',              // [A-Za-z0-9 ]{3,200}
  type: CONTRACT_TYPE.TOKEN,
  vanityNonce: 1n,
  publicKeyBase58Identifier: owner.walletAddress,
  maxSupply: '1000000000000',
  coinDenomination: create(proto.txn.CoinDenominationSchema, { denominationName: 'parts', amount: '1000000000' }),
  grpcConfig: { endpoint: operatorGrpcWebEndpoint, trustedOperatorAddress, transactionContext: { chainId: owner.chainId } }
});
const signed = await signAndFinalize(unsigned, owner);
signed.contractId;              // the derived Base58 ID
```

`symbol` and the optional denomination amount are part of the id preimage.
`deriveContractDataHash` and `deriveOrdinaryContractId` expose the same
steps when you need the id before building the transaction.
For a registered single-key or policy creator, use `CREATOR_AUTHORIZATION.WALLET_ADDRESS` (4),
`CREATOR_KEY_ALGORITHM.NONE` (0), and the complete decoded address as
`creatorAuthorizationBytes`. The two internal creator kinds use `SMART_CONTRACT` (2)
or `GOVERNANCE` (3), algorithm `NONE`, and the exact UTF-8 authority identifier.
The historical `SINGLE_KEY` form identifies contracts created under the earlier Ed key scheme.

Token contracts require `maxSupply` and `coinDenomination`. The SDK's NFT and SBT builders leave
`coinDenomination`, `premintWallets`, `expenseRatio`, and `contractFees`
unset. At most 50 restricted keys are accepted. A calculated creation fee
of exactly `"1"` is refused.

`encodeContractId` turns a 32-byte digest into the checksummed Base58 id.
`contractIdChecksum` is the first 4 bytes of the checksum hash.
`canonicalDecimal` strips leading zeros from a uint256 string used in a
preimage.
