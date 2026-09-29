/**
 * Kalvora Staking Operations — End-to-End Example
 * 
 * Demonstrates a complete staking lifecycle including both liquid and instant staking.
 * 
 * @example
 * Run: npx tsx src/smart-contracts/use-cases/staking/examples/staking-operations.ts
 */

import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS } from '../../../../test-utils/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import {
  stake,
  updateWallet,
  releaseLiquidStake,
  instantStake,
  releaseInstant,
  updateInstantWallet
} from '../index.js';

// ============================================================================
// CONFIGURATION — Using Alice's test wallet for example purposes
// ============================================================================

const publicKey = ED25519_TEST_KEYS.alice.publicKey;
const privateKey = ED25519_TEST_KEYS.alice.privateKey;

const grpcConfig = PROTONET_GRPC_CONFIG;

const STAKING_OPTIONS = {
  grpcConfig,
  feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  gasFeeInUsd: 10.00
};

// Staking parameters
const WALLET_ADDRESS = ED25519_TEST_KEYS.alice.address; // who owns the stake / who is it updating too
const STAKE_AMOUNT = 10; // Amount in KALV (human-readable)
const TERM = '5_years'; // liquid, 6_months, 1_year, 2_years, 3_years, 4_years, 5_years

const STAKE_PARTS = STAKE_AMOUNT * 1e9; // Converted to parts (1 KALV = 1e9 parts)
const BUMP_ID = 1; // used for updating only, provided in emit when stake is created

/**
 * Available staking terms:
 * 
 *   'liquid'    — Liquid term
 *   '6_months'  — 6 month lock
 *   '1_year'    — 1 year lock
 *   '2_years'   — 2 year lock
 *   '3_years'   — 3 year lock
 *   '4_years'   — 4 year lock
 *   '5_years'   — 5 year lock
 */

// ============================================================================
// STEP 1: Liquid Stake — Lock tokens with a wallet address for liquid tokens.
//   Withdrawal can be triggered at any time with a short delay.
// ============================================================================

async function step1_stake(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Liquid Stake');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Amount:  ${STAKE_AMOUNT} KALV (${STAKE_PARTS} parts)`);
  console.log(`  Wallet:  ${WALLET_ADDRESS}`);
  console.log(`  Term:    ${TERM}`);
  console.log('  >> action: "stake"');
  console.log(`  >> params: "${STAKE_PARTS},${WALLET_ADDRESS},${TERM}"`);
  console.log('');

  const txn = await stake(
    { amount: STAKE_PARTS, walletAddress: WALLET_ADDRESS, term: TERM },
    publicKey,
    privateKey,
    STAKING_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Staked! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// STEP 2: Update Wallet — Change the wallet address for a liquid stake position.
// ============================================================================

async function step2_updateWallet(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Update Wallet');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Wallet:  ${WALLET_ADDRESS}`);
  console.log(`  Bump ID: ${BUMP_ID}`);
  console.log('  >> action: "update_wallet"');
  console.log(`  >> params: "${WALLET_ADDRESS},${BUMP_ID}"`);
  console.log('');

  const txn = await updateWallet(
    { walletAddress: WALLET_ADDRESS, bumpId: BUMP_ID },
    publicKey,
    privateKey,
    STAKING_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Wallet updated! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// STEP 3: Release Liquid Stake — Trigger withdrawal (short delay).
// ============================================================================

async function step3_releaseLiquidStake(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Release Liquid Stake');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  >> action: "release_liquid_stake"');
  console.log('  >> params: ""');
  console.log('');

  const txn = await releaseLiquidStake(
    publicKey,
    privateKey,
    STAKING_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Liquid stake released! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// STEP 4: Instant Stake — Lock tokens directly, no liquid token minted.
//   No wallet address required.
// ============================================================================

async function step4_instantStake(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 4: Instant Stake');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Amount:  ${STAKE_AMOUNT} KALV (${STAKE_PARTS} parts)`);
  console.log(`  Term:    ${TERM}`);
  console.log('  >> action: "instant_stake"');
  console.log(`  >> params: "${STAKE_PARTS},${TERM}"`);
  console.log('');

  const txn = await instantStake(
    { amount: STAKE_PARTS, term: TERM },
    publicKey,
    privateKey,
    STAKING_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Instant staked! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// STEP 5: Update Instant Wallet — Change the wallet for an instant stake position.
// ============================================================================

async function step5_updateInstantWallet(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 5: Update Instant Wallet');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Wallet:  ${WALLET_ADDRESS}`);
  console.log(`  Bump ID: ${BUMP_ID}`);
  console.log('  >> action: "update_instant_wallet"');
  console.log(`  >> params: "${WALLET_ADDRESS},${BUMP_ID}"`);
  console.log('');

  const txn = await updateInstantWallet(
    { walletAddress: WALLET_ADDRESS, bumpId: BUMP_ID },
    publicKey,
    privateKey,
    STAKING_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Instant wallet updated! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// STEP 6: Release Instant Stake
// ============================================================================

async function step6_releaseInstant(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 6: Release Instant Stake');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  >> action: "release_instant"');
  console.log('  >> params: ""');
  console.log('');

  const txn = await releaseInstant(
    publicKey,
    privateKey,
    STAKING_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Instant stake released! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// RUN — Comment out any step you don't want to execute
// ============================================================================

//await step1_stake();
//await step2_updateWallet();
//await step3_releaseLiquidStake();
//await step4_instantStake();
//await step5_updateInstantWallet();
//await step6_releaseInstant();
