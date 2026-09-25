# Kalvora DEX SDK

Complete SDK for interacting with the Kalvora decentralized exchange via the `zera_dex_proxy` smart contract.

**All amounts are specified in user-friendly units** (e.g., `'100'` for 100 tokens, `'5.5'` for 5.5 tokens). The SDK automatically converts to smallest units using the token denomination from the network.

## Quick Start

### Create a Liquidity Pool

```typescript
import { dex } from "kalvora.js";

const hash = await dex.createLiquidityPoolAndSend(
  {
    tokenA: "KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao",
    tokenB: "solana-USDC000000",
    amountA: "100", // 100 KALV (auto-converted by SDK)
    amountB: "12", // 12 USDC (auto-converted by SDK)
    feeRate: 25, // 0.25% fee tier
  },
  publicKey,
  privateKey,
  { grpcConfig },
);
```

### Swap Tokens

```typescript
const hash = await dex.swapAndSend(
  {
    tokenIn: "solana-SOL000000",
    tokenOut: "KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao",
    amountIn: "5.5", // 5.5 SOL (decimals supported!)
    feeRate: 25,
    slippage: 100, // 1% slippage tolerance
    recipient: "EW9iaR8...", // optional
  },
  publicKey,
  privateKey,
  { grpcConfig },
);
```

## API Reference

### Pool Management

| Function              | Description                                      |
| --------------------- | ------------------------------------------------ |
| `createLiquidityPool` | Create a new trading pool with initial liquidity |
| `addLiquidity`        | Add tokens to an existing pool                   |
| `unlockLiquidity`     | Unlock LP tokens after lock period expires       |
| `removeLiquidity`     | Remove liquidity by redeeming LP tokens          |

### Trading

| Function | Description                         |
| -------- | ----------------------------------- |
| `swap`   | Execute a token swap through a pool |

> **Tip:** Every function has an `AndSend` variant (e.g., `swapAndSend`) that builds and submits the transaction in one call.

### Utilities

| Function        | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `resolveAmount` | Convert user-friendly amount to smallest units for any token |

## Amount Handling

Most amounts accept user-friendly values — you specify `'100'` and the SDK fetches the token's denomination and converts for you. The only exception is LP tokens in `removeLiquidity`, which are always in raw units (they have no denomination).

| Field                           | User-Friendly | Raw Parts |
| ------------------------------- | :-----------: | :-------: |
| `createLiquidityPool.amountA/B` |      ✅       |           |
| `addLiquidity.amountA/B`        |      ✅       |           |
| `swap.amountIn`                 |      ✅       |           |
| `removeLiquidity.lpAmount`      |               |    ✅     |

## Parameter Reference

### Fee Rate

The `feeRate` parameter is in **basis points** and identifies which pool to interact with:

| Value | Percentage |
| ----- | ---------- |
| 25    | 0.25%      |
| 100   | 1.00%      |
| 200   | 2.00%      |

### Lock Duration

When creating a pool or adding liquidity, LP tokens are locked for a duration (default: 60 seconds). Use `lockDuration` to customize:

```typescript
await dex.createLiquidityPool(
  { ..., lockDuration: 3600 },  // Lock for 1 hour
  publicKey, privateKey
);
```

### Slippage (Swap)

Slippage tolerance for swaps, in **basis points**:

| Value | Percentage                 |
| ----- | -------------------------- |
| 0     | 0% (exact output required) |
| 100   | 1%                         |
| 500   | 5%                         |

## Lifecycle Example

```
1. createLiquidityPool   →  Create pool with initial liquidity
2. addLiquidity          →  Add more liquidity over time
3. swap                  →  Trade tokens through the pool
4. unlockLiquidity       →  Unlock LP tokens after lock expires
5. removeLiquidity       →  Redeem LP tokens for underlying assets
```

## Examples

See [examples/dex-operations.ts](./examples/dex-operations.ts) for a complete end-to-end example.
