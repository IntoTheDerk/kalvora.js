/**
 * End-to-End SPL Bridge Roundtrip (Solana SPL ↔ Kalvora)
 * 
 * Demonstrates a complete SPL token bridge lifecycle:
 * 
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ STEP 1: Lock SPL on Solana        (Solana ATA → vault ATA)    │
 *   │ STEP 2: Submit VAA to Kalvora        (Guardian → Kalvora mint/create)│
 *   │ STEP 3: Burn wrapped SPL on Kalvora  (Kalvora → burn)               │
 *   │ STEP 4: Submit VAA to Solana      (Guardian → Solana release)  │
 *   └─────────────────────────────────────────────────────────────────┘
 * 
 * Prerequisites:
 *   - The SPL token must already be registered on the bridge
 *     (see e2e-token-registration.ts)
 *   - The payer's ATA for the token must be funded
 * 
 * Each step feeds its output hash into the next step.
 * VAA fetches use exponential backoff (1s → 120s) because guardians
 * may not have the payload ready immediately after the on-chain tx.
 * 
 * @example
 * Run: npx tsx src/smart-contracts/use-cases/bridge/examples/e2e-spl-roundtrip.ts
 */

import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// --- Solana bridge builders ---
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { SOLANA_TEST_KEYS, SOLANA_TEST_RPC, ED25519_TEST_KEYS, TEST_WALLET_ADDRESSES } from '../../../../test-utils/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import {
  submitVAAToSolana,
  submitVAAToKalvora
} from '../guardian/index.js';
import { burnSol } from '../kalvora/index.js';
import {
  buildLockSplTransaction
} from '../solana/transactions/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Guardian service endpoint */
const GUARDIAN_CONFIG = {
  host: 'kal-protonet.visiondynamics.ch',
  protocol: 'https' as const,
  port: 443
};

/** Solana RPC connection */
/** Solana RPC endpoint — override for mainnet or custom RPC */
const SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const connection = new Connection(SOLANA_RPC_URL);

/** Solana wallet (signs lock + release transactions) */
const solanaWallet = Keypair.fromSecretKey(bs58.decode(SOLANA_TEST_KEYS.primary.privateKey));
const PAYER = solanaWallet.publicKey;

/** Kalvora wallet (signs burn transaction) */
const ZERA_PUBLIC_KEY = ED25519_TEST_KEYS.alice.publicKey;
const ZERA_PRIVATE_KEY = ED25519_TEST_KEYS.alice.privateKey;

/** Kalvora network config */
const ZERA_CONFIG = PROTONET_GRPC_CONFIG;

/** Adds $5 smart-contract gas; the SDK calculates the base fee in token parts. */
const GAS_FEE_IN_USD = 5;
const FEE_CONTRACT_ID = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';

/** Kalvora recipient address (Alice's wallet — receives wrapped SPL on Kalvora) */
const ZERA_RECIPIENT = TEST_WALLET_ADDRESSES.alice;

/** Solana destination address (receives released SPL tokens back) */
const SOLANA_DESTINATION = SOLANA_TEST_KEYS.primary.publicKey;

/**
 * SPL token mint address — Wrapped SOL (wSOL).
 * Already registered on the bridge as a native Solana asset.
 */
const SPL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Wrapped SOL contract ID on Kalvora.
 */
const WRAPPED_SPL_CONTRACT = 'solana-SOL000000';

/** Amount to bridge: 0.01 SOL (in lamports for Solana, decimal for Kalvora) */
const SPL_AMOUNT_ATOMIC = '10000000'; // 0.01 SOL = 10_000_000 lamports
const SPL_AMOUNT_DECIMAL = '0.01';

// ============================================================================
// HELPER: Sign and send a Solana transaction
// ============================================================================

async function signAndSend(
  transaction: import('@solana/web3.js').Transaction,
  signers: Keypair[]
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = PAYER;

  transaction.sign(...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true
  });

  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight
  }, 'confirmed');

  return signature;
}

// ============================================================================
// STEP 1: Lock SPL tokens on Solana → vault
// ============================================================================

/**
 * Lock SPL tokens into the bridge vault on Solana.
 * Transfers tokens from the user's ATA to the vault ATA.
 * Returns the Solana transaction signature, which STEP 2 uses to fetch the VAA.
 */
async function step1_lockSpl(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Lock SPL token on Solana');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Mint:     ${SPL_MINT}`);
  console.log(`  Amount:   ${SPL_AMOUNT_ATOMIC} atomic (${SPL_AMOUNT_DECIMAL} tokens)`);
  console.log(`  Kalvora Dst: ${ZERA_RECIPIENT.slice(0, 30)}...`);
  console.log('');

  const result = await buildLockSplTransaction(
    {
      amount: SPL_AMOUNT_ATOMIC,
      zeraAddress: ZERA_RECIPIENT,
      mint: SPL_MINT
    },
    PAYER,
    connection
  );

  console.log(`  User ATA:  ${result.accounts.userAta.toBase58()}`);
  console.log(`  Vault ATA: ${result.accounts.vaultAta.toBase58()}`);

  const signature = await signAndSend(result.transaction, [solanaWallet]);
  console.log(`  ✅ Locked! Solana sig: ${signature}`);
  console.log('');

  return signature;
}

// ============================================================================
// STEP 2: Submit VAA to Kalvora (mints/creates wrapped SPL on Kalvora)
// ============================================================================

/**
 * Fetch the VAA for the Solana lock transaction and submit it to Kalvora.
 * This mints (or creates) the wrapped SPL token on the Kalvora network.
 * Returns the Kalvora transaction hash, which STEP 3 uses.
 */
async function step2_submitToZera(solanaSig: string): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Submit VAA to Kalvora (mint wrapped SPL)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Solana sig: ${solanaSig.slice(0, 30)}...`);
  console.log('  Fetching VAA with exp backoff (1s → 120s)...');
  console.log('');

  const result = await submitVAAToKalvora({
    txSignature: solanaSig,
    guardianConfig: GUARDIAN_CONFIG,
    kalvoraConfig: ZERA_CONFIG,
    publicKeyBase58: ZERA_PUBLIC_KEY,
    privateKeyBase58: ZERA_PRIVATE_KEY,
    gasFeeInUsd: GAS_FEE_IN_USD,
    feeId: FEE_CONTRACT_ID,
    retryOptions: { retry: true }
  });

  console.log(`  ✅ Minted on Kalvora! Hash: ${result.txnHash}`);
  console.log(`  Operation: ${result.operationType}`);
  console.log('');

  return result.txnHash;
}

// ============================================================================
// STEP 3: Burn wrapped SPL on Kalvora (initiates release back to Solana)
// ============================================================================

/**
 * Burn the wrapped SPL token on Kalvora to initiate a release back to Solana.
 * Returns the Kalvora transaction hash, which STEP 4 uses to fetch the VAA.
 */
async function step3_burnWrappedSpl(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Burn wrapped SPL on Kalvora');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Contract:   ${WRAPPED_SPL_CONTRACT}`);
  console.log(`  Amount:     ${SPL_AMOUNT_DECIMAL} tokens`);
  console.log(`  Solana Dst: ${SOLANA_DESTINATION.slice(0, 30)}...`);
  console.log('');

  const txn = await burnSol(
    WRAPPED_SPL_CONTRACT,
    SPL_AMOUNT_DECIMAL,
    SOLANA_DESTINATION,
    ZERA_PUBLIC_KEY,
    ZERA_PRIVATE_KEY,
    {
      grpcConfig: ZERA_CONFIG,
      feeId: FEE_CONTRACT_ID,
      gasFeeInUsd: GAS_FEE_IN_USD
    }
  );

  const hash = await sendSmartContractExecuteTXN(txn, ZERA_CONFIG);

  console.log(`  ✅ Burned! Kalvora hash: ${hash}`);
  console.log('');

  return hash;
}

// ============================================================================
// STEP 4: Submit VAA to Solana (releases SPL from vault)
// ============================================================================

/**
 * Fetch the VAA for the Kalvora burn transaction and submit it to Solana.
 * This releases the original SPL tokens from the bridge vault back to the user.
 * Uses the two-transaction split: TX1 (verify + core), TX2 (release_spl).
 */
async function step4_submitToSolana(zeraHash: string): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 4: Submit VAA to Solana (release SPL from vault)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Kalvora hash: ${zeraHash.slice(0, 30)}...`);
  console.log('  Fetching VAA with exp backoff (1s → 120s)...');
  console.log('');

  const result = await submitVAAToSolana({
    txnHash: zeraHash,
    guardianConfig: GUARDIAN_CONFIG,
    connection,
    payer: solanaWallet,
    skipPreflight: true,
    retryOptions: { retry: true }
  });

  console.log(`  ✅ Released! Solana sig: ${result.signature}`);
  console.log(`  Operation: ${result.operationType}`);
  console.log('');

  return result.signature;
}

// ============================================================================
// MAIN: Full roundtrip orchestrator
// ============================================================================

/**
 * Execute the full SPL bridge roundtrip:
 *   Solana (lock SPL) → Kalvora (mint wrapped) → Kalvora (burn wrapped) → Solana (release SPL)
 * 
 * Each step's output hash feeds directly into the next step.
 */
async function runFullRoundtrip() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║      SPL Bridge Roundtrip: Solana → Kalvora → Solana          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Solana wallet: ${PAYER.toBase58().slice(0, 38)}...  ║`);
  console.log(`║  Kalvora wallet:   ${ZERA_PUBLIC_KEY.slice(0, 38)}...  ║`);
  console.log(`║  SPL Mint:      ${SPL_MINT.slice(0, 38)}...  ║`);
  console.log(`║  Amount:        ${SPL_AMOUNT_DECIMAL} token(s)${' '.repeat(31)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const startTime = Date.now();

  try {
    // STEP 1: Lock SPL on Solana
    const solanaSig = await step1_lockSpl();

    // STEP 2: Submit VAA → Kalvora (mints wrapped SPL)
    const zeraHash1 = await step2_submitToZera(solanaSig);

    // // If new token (first across bridge wait for a few seconds to ensure val API can pull wrapped token info). If token has exists on the network already you can skip this wait.
    // console.log('Waiting a bit for wrapped token info to propagate (only do this if created within last few seconds)...');
    // await new Promise((resolve) => setTimeout(resolve, 12000));

    // STEP 3: Burn wrapped SPL on Kalvora
    const zeraHash2 = await step3_burnWrappedSpl();

    // STEP 4: Submit VAA → Solana (releases SPL from vault)
    const finalSig = await step4_submitToSolana(zeraHash2);

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                   ✅ ROUNDTRIP COMPLETE                     ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Total time: ${elapsed}s${' '.repeat(Math.max(0, 44 - elapsed.length))}║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  1. Lock SPL:      ${solanaSig.slice(0, 38)}...  ║`);
    console.log(`║  2. Mint on Kalvora:  ${zeraHash1.slice(0, 38)}...  ║`);
    console.log(`║  3. Burn on Kalvora:  ${zeraHash2.slice(0, 38)}...  ║`);
    console.log(`║  4. Release SPL:   ${finalSig.slice(0, 38)}...  ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error('');
    console.error(`❌ Roundtrip failed after ${elapsed}s`);
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
    console.error('');
    process.exit(1);
  }
}

// ============================================================================
// RUN
// ============================================================================

runFullRoundtrip().catch(console.error);
