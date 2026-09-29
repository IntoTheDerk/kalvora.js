/**
 * Kalvora Bootstrapping Operations — Independent Examples
 *
 * Demonstrates the currently exposed bootstrapping helpers as independent calls.
 *
 * @example
 * Run: npx tsx src/smart-contracts/use-cases/bootstrapping/examples/bootstrapping-operations.ts
 */

import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS } from '../../../../test-utils/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import {
  processRewards,
  stake,
  updateWallet
} from '../index.js';

// ============================================================================
// CONFIGURATION — Using Alice's test wallet for example purposes
// ============================================================================

const publicKey = ED25519_TEST_KEYS.alice.publicKey;
const privateKey = ED25519_TEST_KEYS.alice.privateKey;

const grpcConfig = PROTONET_GRPC_CONFIG;

const BOOTSTRAPPING_OPTIONS = {
  grpcConfig,
  feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  gasFeeInUsd: 0.10
};

// Example LP position metadata
const WALLET_ADDRESS = ED25519_TEST_KEYS.alice.address;
const BUMP_ID = 5;
const STAKE_AMOUNT = '1.234';
const STAKE_TERM = '7_years';
const STAKE_LP_TOKEN_ID = 'dex-ZRA25sol-USDC0000000000';
// To switch this example to the Solana bridged pool token, replace the
// three fields above with:
//   STAKE_AMOUNT = '15000'
//   STAKE_TERM = '6_years'
//   STAKE_LP_TOKEN_ID = 'solana-8miyE000000'

// ============================================================================
// INDEPENDENT OPERATION: Stake into a bootstrapping position
// ============================================================================

async function runStakePosition(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('BOOTSTRAPPING: Stake Position');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Amount:    ${STAKE_AMOUNT} tokens`);
  console.log(`  Term:      ${STAKE_TERM}`);
  console.log(`  LP Token:  ${STAKE_LP_TOKEN_ID}`);
  console.log('  >> action: "stake"');
  console.log('');

  const txn = await stake(
    { amount: STAKE_AMOUNT, term: STAKE_TERM, lpTokenId: STAKE_LP_TOKEN_ID },
    publicKey,
    privateKey,
    BOOTSTRAPPING_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Staked! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// INDEPENDENT OPERATION: Update wallet
// ============================================================================

async function runUpdateWallet(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('BOOTSTRAPPING: Update Wallet');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Wallet:  ${WALLET_ADDRESS}`);
  console.log(`  Bump ID: ${BUMP_ID}`);
  console.log('  >> action: "update_wallet"');
  console.log(`  >> params: "${WALLET_ADDRESS},${BUMP_ID}"`);
  console.log('');

  const NEW_WALLET_ADDRESS = ED25519_TEST_KEYS.bob.address;

  const txn = await updateWallet(
    { walletAddress: NEW_WALLET_ADDRESS, bumpId: BUMP_ID },
    publicKey,
    privateKey,
    BOOTSTRAPPING_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Wallet updated! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// INDEPENDENT OPERATION: Process rewards
// ============================================================================

async function runProcessRewards(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('BOOTSTRAPPING: Process Rewards');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  >> action: "process_rewards"');
  console.log('  >> params: ""');
  console.log('');

  const txn = await processRewards(
    publicKey,
    privateKey,
    BOOTSTRAPPING_OPTIONS
  );

  const hash = await sendSmartContractExecuteTXN(txn, grpcConfig);
  console.log(`  ✅ Rewards processed! Hash: ${hash}`);
  console.log('');
  return hash;
}

// ============================================================================
// RUN — Comment in any independent operation you want to execute
// ============================================================================

// await runStakePosition();
// await runUpdateWallet();
// await runProcessRewards();
