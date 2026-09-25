# Kalvora Staking SDK

Complete SDK for interacting with the Kalvora staking system via the `staking_proxy` smart contract.

**All amounts are specified in smallest units** (raw parts, e.g., `'500000000000'`). Terms use string identifiers like `'6_months'`.

## Staking Types

There are two staking types, determined by which function you call:

- **Liquid Staking** (`stake`) — Locks tokens for a term with a wallet address for liquid token receipt. Works like a regular stake, but withdrawal can be triggered at any time with a short delay.
- **Instant Staking** (`instant_stake`) — Locks tokens directly for a term with no liquid token representation. Does not require a wallet address.

## Quick Start

### Liquid Staking

```typescript
import { staking } from "kalvora.js";

// Liquid stake tokens for 6 months
const hash = await staking.stakeAndSend(
  {
    amount: "500000000000",
    walletAddress: "Hg6QzYxK1AxfE7Y8PYLzCVwDXvobKiG9RhqQDdoi4gyf",
    term: "6_months",
  },
  publicKey,
  privateKey,
  { grpcConfig },
);

// Update the wallet associated with a liquid stake
await staking.updateWalletAndSend(
  {
    walletAddress: "Hg6QzYxK1AxfE7Y8PYLzCVwDXvobKiG9RhqQDdoi4gyf",
    bumpId: "28",
  },
  publicKey,
  privateKey,
  { grpcConfig },
);

// Release a liquid stake (can be triggered anytime with short delay)
await staking.releaseLiquidStakeAndSend(publicKey, privateKey, { grpcConfig });
```

### Instant Staking

```typescript
// Instant stake tokens (no liquid token, no wallet address needed)
const hash = await staking.instantStakeAndSend(
  { amount: "500000000000", term: "6_months" },
  publicKey,
  privateKey,
  { grpcConfig },
);

// Update instant stake wallet
await staking.updateInstantWalletAndSend(
  {
    walletAddress: "Hg6QzYxK1AxfE7Y8PYLzCVwDXvobKiG9RhqQDdoi4gyf",
    bumpId: "28",
  },
  publicKey,
  privateKey,
  { grpcConfig },
);

// Release an instant stake
await staking.releaseInstantAndSend(publicKey, privateKey, { grpcConfig });
```

## API Reference

### Liquid Staking

| Function             | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| `stake`              | Liquid stake tokens for a term — withdrawal can be triggered anytime |
| `updateWallet`       | Update the wallet address for a liquid stake position                |
| `releaseLiquidStake` | Release a liquid stake (triggers withdrawal with short delay)        |

### Instant Staking

| Function              | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `instantStake`        | Instant stake tokens for a term — no liquid token minted |
| `updateInstantWallet` | Update the wallet address for an instant stake position  |
| `releaseInstant`      | Release an instant stake                                 |

> **Tip:** Every function has an `AndSend` variant (e.g., `stakeAndSend`) that builds and submits the transaction in one call.

### Utilities

| Export                     | Description                     |
| -------------------------- | ------------------------------- |
| `STAKING_CONTRACT_NAME`    | Contract name (`staking_proxy`) |
| `STAKING_INSTANCE`         | Contract instance (`1`)         |
| `createStakingTransaction` | Low-level transaction builder   |

## Parameter Reference

### Amount

All amounts are in **smallest units** (raw parts). For example, `'500000000000'` represents 500 KALV with 9 decimals.

### Term

Staking term as a string identifier:

| Value      | Description |
| ---------- | ----------- |
| `liquid`   | Liquid term |
| `6_months` | 6 months    |
| `1_year`   | 1 year      |
| `2_years`  | 2 years     |
| `3_years`  | 3 years     |
| `4_years`  | 4 years     |
| `5_years`  | 5 years     |

### Wallet Address

The destination wallet for liquid staking tokens. Required for `stake` (liquid), not required for `instantStake`.

### Bump ID

A string identifier for the specific stake position to update (e.g., `'28'`).

## Lifecycle Examples

### Liquid Staking

```
1. stake                →  Liquid stake tokens for a term (wallet receives liquid tokens)
2. updateWallet         →  (Optional) Change the associated wallet
3. releaseLiquidStake   →  Trigger withdrawal (can be done anytime, short delay)
```

### Instant Staking

```
1. instantStake         →  Lock tokens directly for a term (no liquid token)
2. updateInstantWallet  →  (Optional) Change the associated wallet
3. releaseInstant       →  Release the instant stake
```

## Examples

See [examples/staking-operations.ts](./examples/staking-operations.ts) for a complete end-to-end example.
