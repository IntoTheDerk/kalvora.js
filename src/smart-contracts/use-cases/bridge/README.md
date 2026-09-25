# Kalvora ↔ Solana Bridge SDK

Complete SDK for cross-chain token transfers between Kalvora and Solana networks.

## Quick Start

### Lock SPL Tokens (Solana → Kalvora)

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { solana } from "kalvora.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const wallet = Keypair.fromSecretKey(yourSecretKey);

// Build lock transaction
const { transaction } = await solana.buildLockSplTransaction(
  {
    amount: BigInt(1_000_000), // 1 USDC (6 decimals)
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    zeraAddress: "your-zera-address",
  },
  wallet.publicKey,
  connection,
);

// Sign and send
transaction.sign(wallet);
const sig = await connection.sendRawTransaction(transaction.serialize());
```

### Lock Native SOL (Solana → Kalvora)

```typescript
const { transaction } = await solana.buildLockSolTransaction(
  {
    amount: BigInt(1_000_000_000), // 1 SOL
    zeraAddress: "your-zera-address",
  },
  wallet.publicKey,
  connection,
);
```

### Lock Token-2022 Tokens (Solana → Kalvora)

```typescript
const { transaction, accounts } = await solana.buildLockToken2022Transaction(
  {
    amount: BigInt(1_000_000),
    mint: "your-token-2022-mint",
    zeraAddress: "your-zera-address",
  },
  wallet.publicKey,
  connection,
);

console.log("Token-2022 vault ATA:", accounts.vaultAta.toBase58());
```

### Pick the Solana Token Type Explicitly

Use `buildLockSolanaTransaction` when your app wants one Solana lock path and
chooses between native SOL, classic SPL, and Token-2022 at runtime.

```typescript
const { transaction } = await solana.buildLockSolanaTransaction(
  {
    tokenType: solana.SolanaTokenType.TOKEN2022,
    amount: BigInt(1_000_000),
    mint: "your-token-2022-mint",
    zeraAddress: "your-zera-address",
  },
  wallet.publicKey,
  connection,
);
```

For native SOL, use `tokenType: solana.SolanaTokenType.SOL` and omit `mint`.
For classic SPL, use `tokenType: solana.SolanaTokenType.SPL` with `mint`.

### Register a Token-2022 Mint

```typescript
await solana.buildRequestTokenRegistrationTransaction(
  {
    mint: "your-token-2022-mint",
    tokenProgramId: solana.TOKEN_2022_PROGRAM_ID.toBase58(),
  },
  wallet.publicKey,
  connection,
);
```

## Transaction Builders

### User Operations

| Function                      | Direction     | Description              |
| ----------------------------- | ------------- | ------------------------ |
| `buildLockSolanaTransaction`  | Solana → Kalvora | Lock SOL, SPL, or Token-2022 by `tokenType` |
| `buildLockSplTransaction`     | Solana → Kalvora | Lock SPL tokens          |
| `buildLockSolTransaction`     | Solana → Kalvora | Lock native SOL          |
| `buildLockToken2022Transaction` | Solana → Kalvora | Lock Token-2022 tokens   |
| `buildBurnWrappedTransaction` | Solana → Kalvora | Burn wrapped Kalvora tokens |

### Guardian Operations

| Function                              | Direction     | Description                               |
| ------------------------------------- | ------------- | ----------------------------------------- |
| `buildReleaseSolanaTransaction`       | Kalvora → Solana | Release SOL, SPL, or Token-2022 by `tokenType` |
| `buildReleaseSplTransaction`          | Kalvora → Solana | Release locked SPL tokens (including SOL) |
| `buildReleaseToken2022Transaction`    | Kalvora → Solana | Release locked Token-2022 tokens          |
| `buildMintWrappedTransaction`         | Kalvora → Solana | Mint wrapped tokens (first-time)          |
| `buildMintWrappedExistingTransaction` | Kalvora → Solana | Mint wrapped tokens (existing)            |
| `buildRegisterTokenTransaction`       | -             | Register new token with bridge            |

## Guardian Service

Query the guardian service for attestations:

```typescript
import { guardian } from "kalvora.js";

const client = guardian.createGuardianClient();

// Get payload by transaction hash
const payload = await client.getPayload(
  guardian.GetPayloadRequest.create({
    txnHash: "zera-tx-hash",
    networkType: guardian.NETWORK_TYPE.ZERA,
  }),
);

// Search recent payloads
const results = await client.searchPayload(
  guardian.SearchPayloadRequest.create({
    searchStartTime: BigInt(Date.now() - 86400000),
  }),
);
```

## PDA Derivation

```typescript
import { solana } from "kalvora.js";

// Bridge PDAs
const [routerSigner] = solana.deriveRouterSignerPDA();
const [routerSigner2022] = solana.deriveRouterSigner2022PDA();
const [vault] = solana.deriveVaultPDA();

// Token PDAs
const [registration] = solana.deriveTokenRegistrationPDA(mint);
const [extensionWhitelist] = solana.deriveExtensionWhitelist2022PDA();
const [wrappedMint] = solana.deriveWrappedMintPDA("KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao");

// Associated Token Account
const ata = solana.getATA(owner, mint);
const token2022Ata = solana.getATAWithProgramId(
  owner,
  mint,
  solana.TOKEN_2022_PROGRAM_ID,
);
```

## Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Kalvora      │         │  Guardians  │         │   Solana    │
│   Chain     │◄───────►│   (VAA)     │◄───────►│   Chain     │
└─────────────┘         └─────────────┘         └─────────────┘
      │                       │                       │
      │  1. Lock on Kalvora      │                       │
      │ ──────────────────────►                       │
      │                       │  2. Sign VAA          │
      │                       │ ──────────────────────►
      │                       │                       │  3. Release on Solana
```

## Examples

- [examples/e2e-solana-sol-roundtrip.ts](./examples/e2e-solana-sol-roundtrip.ts) - native SOL full roundtrip
- [examples/e2e-spl-roundtrip.ts](./examples/e2e-spl-roundtrip.ts) - classic SPL full roundtrip
- [examples/e2e-token2022-roundtrip.ts](./examples/e2e-token2022-roundtrip.ts) - Token-2022 full roundtrip
- [examples/e2e-token-registration.ts](./examples/e2e-token-registration.ts) - request/register token flow
- [solana/examples/solana-token2022-bridge-examples.ts](./solana/examples/solana-token2022-bridge-examples.ts) - Token-2022 request/register/lock/release builder usage
