# HD key derivation

How kalvora.js turns a mnemonic (or any seed) into a Kalvora key. This page is
the specification: every byte below decides which address a mnemonic restores
to, so it changes only with a new major scheme and a migration.

| key type | scheme | standard? |
|---|---|---|
| Ed25519 (`A_` identifiers) | [SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md) | yes, exactly |
| Ed448 (`B_` identifiers) | Kalvora's own scheme, described below | no standard exists |

## Path

Kalvora's registered SLIP-44 coin type is **5258** (`KALVORA_TYPE`). Wallets
live at

```
m/44'/5258'/account'/change'/address'
```

with every segment hardened. The first wallet is `m/44'/5258'/0'/0'/0'`
(`SLIP0010_DERIVATION_PATH`); `deriveMultipleWallets` steps `account`.

Because every segment is hardened, these addresses cannot be reproduced by a
BIP-44 wallet that derives `change` and `address` unhardened, and vice versa.
That is inherent to EdDSA — public-key (unhardened) derivation does not exist
for Ed25519 under SLIP-0010.

## From mnemonic to seed

Standard [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki):
PBKDF2-HMAC-SHA512 over the mnemonic, salt `"mnemonic" + passphrase`, 2,048
iterations, 64 bytes (`generateSeed`). Nothing Kalvora-specific happens here.

## Ed25519: SLIP-0010

Exactly as specified by SLIP-0010 for the `ed25519` curve:

```
master:  I = HMAC-SHA512(key = "ed25519 seed", data = seed)
         k = I[0:32], c = I[32:64]

child i (hardened only, i >= 2^31):
         I = HMAC-SHA512(key = c, data = 0x00 || k || ser32(i))
         k = I[0:32], c = I[32:64]
```

`ser32` is the 4-byte **big-endian** index including the hardened offset. The
final `k` is the Ed25519 private key (RFC 8032 seed), and the public key is
`ed25519.getPublicKey(k)`. A path with any unhardened segment is rejected,
because SLIP-0010 does not define one for Ed25519.

Any SLIP-0010 implementation — hardware wallets, other SDKs — derives the same
Ed25519 key from the same seed and path. The suite checks the official
SLIP-0010 "Test vector 1 for ed25519" at every depth
(`src/wallet-creation/tests/hd-derivation-vectors.test.ts`).

## Ed448: Kalvora's scheme

SLIP-0010 does not cover Ed448, and no other HD standard does. kalvora.js keeps
the scheme it has always used, so existing Ed448 wallets are unaffected:

```
master:  I = HMAC-SHA512(key = "Kalvora seed", data = seed)
         k = I[0:32], c = I[32:64]

child i: I = HMAC-SHA512(key = c, data = ser32LE(i) || k)
         k = I[0:32], c = I[32:64]
```

`ser32LE` is the 4-byte **little-endian** index; hardened segments carry the
2^31 offset and unhardened segments are accepted. The 32-byte node key is then
expanded to the 57-byte Ed448 secret key `Ed448KeyPair` uses:

```
t  = SHA3-256(k)
x  = HMAC-SHA512(key = t, data = "ed448-expansion")[0:57]
x[56] &= 0xFC
public key = ed448.getPublicKey(x)
```

This is interoperable only with kalvora.js and implementations that copy this
page. If an Ed448 HD standard emerges, adopting it will be a new, opt-in scheme.

## Using it

The wallet factory (`createWallet`, `deriveMultipleWallets`) applies all of the
above. For a key alone:

```typescript
import { deriveHDPrivateKey, SLIP0010_DERIVATION_PATH, KEY_TYPE } from 'kalvora.js/wallet';

const key = deriveHDPrivateKey(seed);                       // Ed25519, m/44'/5258'/0'/0'/0'
const key448 = deriveHDPrivateKey(seed, SLIP0010_DERIVATION_PATH, KEY_TYPE.ED448);
try {
  // ...
} finally {
  key.fill(0);
  key448.fill(0);
}
```

`deriveHDPrivateKey` returns only the 32-byte node key, never keeps a reference
to `seed`, and zeroes every intermediate node and chain code.

`kalvora.js/wallet` is the wallet surface on its own — mnemonics, derivation,
key pairs, and address encoding — depending only on `@noble/curves`,
`@noble/hashes`, `bip39`, and `bs58`, with no network, protobuf, or
transaction code. The same exports are available from the main `kalvora.js`
entry. It is ESM-only; CommonJS callers use the main entry.

## Reference vectors

For the BIP-39 test mnemonic
`abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`
with no passphrase:

| path | Ed25519 address (SLIP-0010) |
|---|---|
| `m/44'/5258'/0'/0'/0'` | `35q7SEc9HVV7Gd9oVKCnZjPMxpLrH9DftTcBUyHahTZP` |
| `m/44'/5258'/1'/0'/0'` | `7WtND9GaeT2ZVhRzKnf98fx7Yn4cpT4FyTYJpq8tYFHj` |
| `m/44'/5258'/2'/0'/0'` | `CWtEMYzMt9hvd1B7wrsTpagHEupFKPsENTjSQNWvQhTR` |

| path | Ed448 address (Kalvora scheme) |
|---|---|
| `m/44'/5258'/0'/0'/0'` | `UAAGQbF9y5ZgooMBPXDzjz3YWcP4S2G4sW4Xirbv73g7E8SSngGANK36tNngSdAZvY6C26BnLwgKyq` |
| `m/44'/5258'/1'/0'/0'` | `Re9noD1ifu6CEc9bkMtmgGRPpC6GizMapEJL5yofExiYz15HSS5iasZYgY9EAq9TZMK8pZNvW5CH7D` |
| `m/44'/5258'/2'/0'/0'` | `LiwTYNNsXjDXF7Bfu59J3VP9xtD6ydod1W4X3SeKhz2D7v8EULmzAYammv3ow8vNtCEQcg76ZRKxn3` |

An address is the base58 of the raw public key; the identifier is that address
behind `A_` (Ed25519) or `B_` (Ed448).

## History

Before 0.0.1-alpha.0, Ed25519 used the Ed448 scheme above (`"Kalvora seed"`,
little-endian `index || key`). That scheme is not SLIP-0010, so the same
mnemonic gave a different Ed25519 address in kalvora.js than in any SLIP-0010
wallet: the test mnemonic's first address was
`Hb6KH2BhgcjCYnc3JwDU1VNfbLds2yfMDMVwZGUWSunE`. No Kalvora wallet had
shipped on that scheme, so it was replaced outright rather than kept as a
legacy option.
