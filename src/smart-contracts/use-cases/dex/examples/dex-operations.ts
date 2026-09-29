/**
 * Kalvora DEX Operations — End-to-End Example
 * 
 * Demonstrates a complete DEX lifecycle using user-friendly amounts.
 * All token pairs, amounts, and fee rates are driven by the CONFIGURATION
 * section — change TOKEN_A / TOKEN_B and everything adapts automatically.
 * 
 * @example
 * Run: npx tsx src/smart-contracts/use-cases/dex/examples/dex-operations.ts
 */

import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS } from '../../../../test-utils/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import {
  createLiquidityPool,
  addLiquidity,
  swap,
  unlockLiquidity,
  removeLiquidity
} from '../index.js';

// ============================================================================
// CONFIGURATION — Change these values to use different tokens / amounts
// ============================================================================

const publicKey = ED25519_TEST_KEYS.alice.publicKey;
const privateKey = ED25519_TEST_KEYS.alice.privateKey;

const grpcConfig = PROTONET_GRPC_CONFIG;

const DEX_OPTIONS = {
  grpcConfig,
  feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  gasFeeInUsd: 10.00 // doesnt actually need to be this much
};

// Token pair
const TOKEN_A = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
const TOKEN_B = 'LEET1337';

/** Fee rate in BPS (basis points). 1 BPS = 0.01%, so 25 BPS = 0.25% -- valid pool percentages are 10, 25 (ACE), 50, 100, 200, 400, 800 BPS other options will fail   */
const FEE_RATE_BPS = 25;

// Amounts for each step (user-friendly — SDK converts automatically)
const CREATE_POOL_AMOUNT_A = '2000';
const CREATE_POOL_AMOUNT_B = '50';

// Add at same ratio, if not, will go to lowest denomination
const ADD_LIQ_AMOUNT_A = '1000';
const ADD_LIQ_AMOUNT_B = '25';
const SWAP_AMOUNT_IN = '5.5';
const PLATFORM_FEE_BPS = 100;  // 1% platform fee example (max 500 BPS (5%))
const PLATFORM_FEE_ADDRESS = ED25519_TEST_KEYS.bob.address; // Bob receives the platform fee
const REMOVE_LP_AMOUNT = '197.64235376'; // LP tokens always have 9 decimals

// ============================================================================
// HELPER
// ============================================================================

function feeRatePercent(): string {
  return `${(FEE_RATE_BPS / 100).toFixed(2)}%`;
}

function platformFeePercent(): string {
  return `${(PLATFORM_FEE_BPS / 100).toFixed(0)}%`;
}

// ============================================================================
// STEP 1: Create Liquidity Pool
// ============================================================================

async function step1_createPool(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Create Liquidity Pool');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Token A:  ${TOKEN_A}`);
  console.log(`  Token B:  ${TOKEN_B}`);
  console.log(`  Amount A: ${CREATE_POOL_AMOUNT_A} (${TOKEN_A})`);
  console.log(`  Amount B: ${CREATE_POOL_AMOUNT_B} (${TOKEN_B})`);
  console.log(`  Fee Rate: ${FEE_RATE_BPS} bps (${feeRatePercent()})`);
  console.log('');

  const txn = await createLiquidityPool(
    {
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      amountA: CREATE_POOL_AMOUNT_A,
      amountB: CREATE_POOL_AMOUNT_B,
      feeRate: FEE_RATE_BPS,
      lockDuration: 60
    },
    publicKey,
    privateKey,
    DEX_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Pool created! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// STEP 2: Add Liquidity
// ============================================================================

async function step2_addLiquidity(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Add Liquidity');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Pool:     ${TOKEN_A} / ${TOKEN_B}`);
  console.log(`  Amount A: ${ADD_LIQ_AMOUNT_A} (${TOKEN_A})`);
  console.log(`  Amount B: ${ADD_LIQ_AMOUNT_B} (${TOKEN_B})`);
  console.log('');

  const txn = await addLiquidity(
    {
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      amountA: ADD_LIQ_AMOUNT_A,
      amountB: ADD_LIQ_AMOUNT_B,
      feeRate: FEE_RATE_BPS,
      lockDuration: 60
    },
    publicKey,
    privateKey,
    DEX_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Liquidity added! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// STEP 3: Swap Tokens
// ============================================================================

async function step3_swap(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Swap Tokens');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Selling:  ${SWAP_AMOUNT_IN} ${TOKEN_B}`);
  console.log(`  Buying:   ${TOKEN_A}`);
  console.log(`  Platform Fee: ${PLATFORM_FEE_BPS} bps (${platformFeePercent()})`);
  console.log(`  Fee Address:  ${PLATFORM_FEE_ADDRESS}`);
  console.log('');

  const txn = await swap(
    {
      tokenIn: TOKEN_B,
      tokenOut: TOKEN_A,
      amountIn: SWAP_AMOUNT_IN,
      feeRate: FEE_RATE_BPS,
      platformFeeBps: PLATFORM_FEE_BPS,
      platformFeeAddress: PLATFORM_FEE_ADDRESS
    },
    publicKey,
    privateKey,
    DEX_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Swap executed! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// STEP 4: Unlock Liquidity
// ============================================================================

async function step4_unlockLiquidity(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 4: Unlock LP Tokens');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Pool: ${TOKEN_A} / ${TOKEN_B}`);
  console.log('');

  const txn = await unlockLiquidity(
    {
      tokenA: TOKEN_B,
      tokenB: TOKEN_A,
      feeRate: FEE_RATE_BPS
    },
    publicKey,
    privateKey,
    DEX_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ LP tokens unlocked! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// STEP 5: Remove Liquidity
// ============================================================================

async function step5_removeLiquidity(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 5: Remove Liquidity');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Pool:      ${TOKEN_A} / ${TOKEN_B}`);
  console.log(`  LP Amount: ${REMOVE_LP_AMOUNT} (raw units)`);
  console.log('');

  const txn = await removeLiquidity(
    {
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      lpAmount: REMOVE_LP_AMOUNT,
      feeRate: FEE_RATE_BPS
    },
    publicKey,
    privateKey,
    DEX_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Liquidity removed! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// MAIN
// ============================================================================

async function runDexOperations() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Kalvora DEX Operations Example                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Token A:  ${TOKEN_A}`);
  console.log(`║  Token B:  ${TOKEN_B}`);
  console.log(`║  Fee Tier: ${FEE_RATE_BPS} bps (${feeRatePercent()})`);
  console.log('║  Amounts:  user-friendly (auto-converted by SDK)');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const startTime = Date.now();

  try {
    const hash1 = await step1_createPool();
    const hash2 = await step2_addLiquidity();
    const hash3 = await step3_swap();
    const hash4 = await step4_unlockLiquidity();
    const hash5 = await step5_removeLiquidity();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                ✅ ALL OPERATIONS COMPLETE                   ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Total time: ${elapsed}s`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  1. Create pool:     ${hash1}`);
    console.log(`║  2. Add liquidity:   ${hash2}`);
    console.log(`║  3. Swap:            ${hash3}`);
    console.log(`║  4. Unlock LP:       ${hash4}`);
    console.log(`║  5. Remove liq:      ${hash5}`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error('');
    console.error(`❌ DEX operations failed after ${elapsed}s`);
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
    console.error('');
    process.exit(1);
  }
}

// ============================================================================
// RUN
// ============================================================================

runDexOperations().catch(console.error);
