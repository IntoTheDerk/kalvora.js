# Kalvora Bootstrapping SDK

SDK helpers for the Kalvora LP bootstrapping protocol via the `bootstrapping_proxy` smart contract.

This module follows the *Strategic Liquidity & Ecosystem Infrastructure* bootstrapping program (7-year emission schedule, lock multipliers, eligible 0.25% pools).

> **Beta:** the schedule, contract name, and LP token identifiers below come from the reference program. Confirm the deployed `bootstrapping_proxy` instance and eligible LP token IDs on the Kalvora network before relying on them.

## What This Module Covers

The proposal describes a long-term liquidity incentive system where rewards are weighted by:

`locked LP tokens × lock-duration multiplier`

This SDK currently exposes three contract actions for the bootstrapping proxy:

- `stake` / `stakeAndSend`
- `updateWallet` / `updateWalletAndSend`
- `processRewards` / `processRewardsAndSend`

In practice, `stake` is the deposit path for bootstrapping. You deposit eligible LP tokens into the contract by calling:

```cpp
execute("stake", "amount,term,lpTokenId")
```

For SDK callers, `amount` should now be passed in normal token units. Bootstrapping LP tokens use a fixed denomination of `1,000,000,000` parts per token, and the SDK converts automatically before building the contract payload.

The bootstrapping actions are independent:

- deposit / lock LP tokens with `stake`
- update the payout wallet with `update_wallet`
- process accrued rewards with `process_rewards`

Those map directly to:

```cpp
execute("stake", "amount,term,lpTokenId")
execute("update_wallet", "walletAddress,bumpId")
execute("process_rewards", "")
```

## Quick Start

The primary entrypoint is `stake`, which deposits and locks an eligible LP token position into `bootstrapping_proxy`.

```typescript
import { bootstrapping } from "kalvora.js";

// Deposit / lock LP tokens into the bootstrapping contract
// To deposit the Solana bridged pool token instead, use:
//   amount: "15000"
//   term: "6_years"
//   lpTokenId: "solana-8miyE000000"
await bootstrapping.stakeAndSend(
  {
    amount: "13183.5353144",
    term: "7_years",
    lpTokenId: "dex-ZRA25sol-USDC0000000000",
  },
  publicKey,
  privateKey,
  { grpcConfig },
);
```

### Additional Actions

Update the wallet attached to an existing bootstrapping position:

```typescript
await bootstrapping.updateWalletAndSend(
  {
    walletAddress: "Hg6QzYxK1AxfE7Y8PYLzCVwDXvobKiG9RhqQDdog6Hyf",
    bumpId: "1",
  },
  publicKey,
  privateKey,
  { grpcConfig },
);
```

Process rewards for your existing bootstrapping positions:

```typescript
await bootstrapping.processRewardsAndSend(
  publicKey,
  privateKey,
  { grpcConfig },
);
```

## Deposit / Staking Flow

Bootstrapping staking is LP-token deposit, not single-asset KALV staking.

The normal flow is:

1. Acquire or mint an eligible LP token position in one of the supported pools.
2. Deposit that LP position into `bootstrapping_proxy` with `stake`.
3. Optionally update the receiving wallet for that position with `updateWallet`.
4. Process accrued rewards whenever needed with `processRewards`.

These calls are not forced into a strict sequence beyond the initial deposit. `updateWallet` and `processRewards` are independent maintenance actions for an existing position.

### Supported Term Strings

Use one of these exact `term` values when calling `stake`:

```text
30_days
90_days
6_months
1_year
2_years
3_years
4_years
5_years
6_years
7_years
```

### Deposit Example

Canonical SDK example:

```typescript
// Native Kalvora DEX LP token example shown below.
// To switch to the Solana bridged pool token instead, replace these three fields with:
//   amount: "15000"
//   term: "6_years"
//   lpTokenId: "solana-8miyE000000"
await bootstrapping.stakeAndSend(
  {
    amount: "13183.5353144",
    term: "7_years",
    lpTokenId: "dex-ZRA25sol-USDC0000000000",
  },
  publicKey,
  privateKey,
  { grpcConfig },
);
```

## Governance Design Summary

### Initial Seeding

The proposal allocates:

- `1,000,000` to `1,250,000` KALV and `100,000` to `125,000` USDC for initial pool deployment
- at least `95%` of the initial capital to Solana DEX liquidity
- up to `5%` to the native Kalvora DEX
- a starting ratio of `10 KALV : 1 USDC`

It also earmarks another `50,000` to `75,000` USD over the following 6 months for additional LP support and OTC transactions.

### Reward Pool

The proposal allocates `7,000,000 KALV` to the bootstrapping reward contract, with `700,000 KALV` released per emission period. The schedule spans `4,215` days, which is approximately `11.5 years`.

| Period | Days         | Daily KALV |
| ------ | ------------ | --------- |
| 1      | 1 to 30      | 23,333.33 |
| 2      | 31 to 76     | 15,217.39 |
| 3      | 77 to 147    | 9,859.15  |
| 4      | 148 to 257   | 6,363.64  |
| 5      | 258 to 427   | 4,117.65  |
| 6      | 428 to 690   | 2,661.60  |
| 7      | 691 to 1,097 | 1,719.90  |
| 8      | 1,098 to 1,727 | 1,111.11 |
| 9      | 1,728 to 2,703 | 717.21   |
| 10     | 2,704 to 4,215 | 462.96   |

### Lockup Booster System

Rewards are weighted by how long LP tokens stay locked. The proposal multiplier table is:

| Lock Days | Years | Multiplier |
| --------- | ----- | ---------- |
| 30        | 0.08  | 1.00x      |
| 90        | 0.25  | 1.16x      |
| 180       | 0.49  | 1.40x      |
| 365       | 1.00  | 1.67x      |
| 730       | 2.00  | 2.01x      |
| 1,095     | 3.00  | 2.41x      |
| 1,460     | 4.00  | 2.89x      |
| 1,825     | 5.00  | 3.47x      |
| 2,190     | 6.00  | 4.17x      |
| 2,555     | 7.00  | 5.00x      |

## Supported Pairs

The proposal lists these eligible bootstrapping venues:

- Native Kalvora network DEX: `KALV / Wrapped USDC`
- Solana ecosystem DEX (Raydium): `Wrapped KALV / USDC`

Both are specified at the `0.25%` fee tier.

### Eligible Stakeable LP Tokens

For `stake`, the third parameter is the eligible LP token / pool token identifier.

The reference program's bootstrapping LP tokens are (verify on Kalvora before use):

- Native Kalvora DEX LP token: `dex-ZRA25sol-USDC0000000000`
- Solana bridged pool token: `solana-8miyE000000`
  Solana mint ID: `8miyEJg3WTsYSq2HUe8kwioFypiEcLTqoMTtQEkYDXW7`

In other words, the `lpTokenId` for bootstrapping deposits should currently be one of:

```text
dex-ZRA25sol-USDC0000000000
solana-8miyE000000
```

## API Reference

### `stake`

Deposits and locks an eligible LP position into the bootstrapping contract.

Parameters:

- `amount`: amount to deposit / lock in normal token units; the SDK multiplies by `1,000,000,000`
- `term`: one of `30_days`, `90_days`, `6_months`, `1_year`, `2_years`, `3_years`, `4_years`, `5_years`, `6_years`, `7_years`
- `lpTokenId`: eligible LP token / pool identifier, such as `dex-ZRA25sol-USDC0000000000` or `solana-8miyE000000`

Example:

```typescript
// Default example below uses the native Kalvora DEX LP token.
// For the bridged Solana pool token, replace these with:
//   amount: "15000"
//   term: "6_years"
//   lpTokenId: "solana-8miyE000000"
await bootstrapping.stakeAndSend(
  {
    amount: "13183.5353144",
    term: "7_years",
    lpTokenId: "dex-ZRA25sol-USDC0000000000",
  },
  publicKey,
  privateKey,
  { grpcConfig },
);
```

On-chain, that example becomes:

```text
13183535314400,7_years,dex-ZRA25sol-USDC0000000000
```

### `updateWallet`

Updates the payout wallet for a previously created bootstrapping LP position.

Parameters:

- `walletAddress`: destination address for rewards or wallet-linked accounting
- `bumpId`: position identifier passed as the second value in `walletAddress,bumpId`

### `processRewards`

Builds the `process_rewards` execute call with an empty parameter string. The detailed reward accounting logic remains on-chain and follows the governance-controlled contract rules.

## Utilities

The module also exports:

- `BOOTSTRAPPING_CONTRACT_NAME`
- `BOOTSTRAPPING_INSTANCE`
- `BOOTSTRAPPING_ELIGIBLE_FEE_RATE_BPS`
- `BOOTSTRAPPING_EMISSION_PERIODS`
- `BOOTSTRAPPING_LOCK_MULTIPLIERS`
- `BOOTSTRAPPING_ELIGIBLE_PAIRS`
- `createBootstrappingTransaction`

## Example

See [examples/bootstrapping-operations.ts](./examples/bootstrapping-operations.ts) for a runnable example.
