/**
 * End-to-End Kalvora Bridge Roundtrip (Kalvora ↔ Solana)
 * 
 * Demonstrates a complete Kalvora bridge lifecycle:
 * 
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ STEP 1: Lock Kalvora on Kalvora chain    (Kalvora → lock)              │
 *   │ STEP 2: Submit VAA to Solana       (Guardian → Solana mint)   │
 *   │ STEP 3: Burn wrapped Kalvora on Sol   (Solana → burn)            │
 *   │ STEP 4: Submit VAA to Kalvora         (Guardian → Kalvora release)  │
 *   └─────────────────────────────────────────────────────────────────┘
 * 
 * Each step feeds its output hash into the next step.
 * VAA fetches use exponential backoff (1s → 120s) because guardians
 * may not have the payload ready immediately after the on-chain tx.
 * 
 * @example
 * Run: npx tsx src/smart-contracts/use-cases/bridge/examples/e2e-kalvora-roundtrip.ts
 */

import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// --- Kalvora bridge builders ---
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { SOLANA_TEST_KEYS, SOLANA_TEST_RPC, ED25519_TEST_KEYS, TEST_WALLET_ADDRESSES } from '../../../../test-utils/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import {
  submitVAAToSolana,
  submitVAAToKalvora
} from '../guardian/index.js';
import { lockKalvora } from '../kalvora/index.js';
import { buildBurnWrappedTransaction } from '../solana/transactions/index.js';
import { deriveWrappedMintPDA } from '../solana/utils.js';

// --- Solana bridge builders ---

// --- Guardian VAA submission ---

// --- Shared test config ---

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

/** Solana wallet (signs mint + burn transactions on Solana) */
const solanaWallet = Keypair.fromSecretKey(bs58.decode(SOLANA_TEST_KEYS.primary.privateKey));
const PAYER = solanaWallet.publicKey;

/** Kalvora wallet (signs lock + release transactions on Kalvora) */
const ZERA_PUBLIC_KEY = ED25519_TEST_KEYS.alice.publicKey;
const ZERA_PRIVATE_KEY = ED25519_TEST_KEYS.alice.privateKey;

/** Kalvora network config */
const ZERA_CONFIG = PROTONET_GRPC_CONFIG;

/** Adds $5 smart-contract gas; the SDK calculates the base fee in token parts. */
const GAS_FEE_IN_USD = 5;
const FEE_CONTRACT_ID = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';

/** Kalvora contract ID for KALV */
const ZERA_CONTRACT_ID = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';

/** Known Solana mint address for wrapped Kalvora */
const WRAPPED_ZERA_MINT = '9zVugUbpn27zvSfBwkhYAG4yvnxdy58ZFS5Rt89zaP15';

/** Solana destination address (receives wrapped Kalvora on Solana) */
const SOLANA_DESTINATION = SOLANA_TEST_KEYS.primary.publicKey;

/** Kalvora recipient address (receives released Kalvora tokens back) */
const ZERA_RECIPIENT = TEST_WALLET_ADDRESSES.alice;

/** Amount of Kalvora to bridge */
const ZERA_AMOUNT_DECIMAL = '0.1';           // For Kalvora chain (lock)
const ZERA_AMOUNT_ATOMIC = '10000000';       // For Solana (burn) — 0.1 Kalvora in atomic units

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
// STEP 1: Lock Kalvora on Kalvora chain
// ============================================================================

/**
 * Lock Kalvora tokens on the Kalvora chain with the Solana destination address.
 * Returns the Kalvora transaction hash, which STEP 2 uses to fetch the VAA.
 */
async function step1_lockZera(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Lock Kalvora on Kalvora chain');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Contract:   ${ZERA_CONTRACT_ID}`);
  console.log(`  Amount:     ${ZERA_AMOUNT_DECIMAL} Kalvora`);
  console.log(`  Solana Dst: ${SOLANA_DESTINATION.slice(0, 30)}...`);
  console.log('');

  const txn = await lockKalvora(
    ZERA_CONTRACT_ID,
    ZERA_AMOUNT_DECIMAL,
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

  console.log(`  ✅ Locked! Kalvora hash: ${hash}`);
  console.log('');

  return hash;
}

// ============================================================================
// STEP 2: Submit VAA to Solana (mints wrapped Kalvora on Solana)
// ============================================================================

/**
 * Fetch the VAA for the Kalvora lock transaction and submit it to Solana.
 * This mints wrapped Kalvora tokens on Solana.
 * Uses the two-transaction split: TX1 (verify + core), TX2 (mint_wrapped).
 * Returns the Solana transaction signature, which STEP 3 uses.
 */
async function step2_submitToSolana(zeraHash: string): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Submit VAA to Solana (mint wrapped Kalvora)');
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

  console.log(`  ✅ Minted on Solana! Sig: ${result.signature}`);
  console.log(`  Operation: ${result.operationType}`);
  console.log('');

  return result.signature;
}

// ============================================================================
// STEP 3: Burn wrapped Kalvora on Solana (initiates release back to Kalvora)
// ============================================================================

/**
 * Burn wrapped Kalvora tokens on Solana to initiate a release back to Kalvora.
 * Returns the Solana transaction signature, which STEP 4 uses to fetch the VAA.
 */
async function step3_burnWrapped(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Burn wrapped Kalvora on Solana');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Wrapped Mint: ${WRAPPED_ZERA_MINT}`);
  console.log(`  Amount:       ${ZERA_AMOUNT_ATOMIC} atomic (${ZERA_AMOUNT_DECIMAL} Kalvora)`);
  console.log(`  Kalvora Dst:     ${ZERA_RECIPIENT.slice(0, 30)}...`);
  console.log('');

  const result = await buildBurnWrappedTransaction(
    {
      amount: ZERA_AMOUNT_ATOMIC,
      wrappedMint: WRAPPED_ZERA_MINT,
      zeraRecipient: ZERA_RECIPIENT
    },
    PAYER,
    connection
  );

  console.log(`  User ATA: ${result.accounts.userAta.toBase58()}`);

  const signature = await signAndSend(result.transaction, [solanaWallet]);
  console.log(`  ✅ Burned! Solana sig: ${signature}`);
  console.log('');

  return signature;
}

// ============================================================================
// STEP 4: Submit VAA to Kalvora (releases locked Kalvora tokens)
// ============================================================================

/**
 * Fetch the VAA for the Solana burn transaction and submit it to Kalvora.
 * This releases the locked Kalvora tokens back to the user's Kalvora wallet.
 * Returns the Kalvora transaction hash.
 */
async function step4_submitToZera(solanaSig: string): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 4: Submit VAA to Kalvora (release locked Kalvora)');
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

  console.log(`  ✅ Released on Kalvora! Hash: ${result.txnHash}`);
  console.log(`  Operation: ${result.operationType}`);
  console.log('');

  return result.txnHash;
}

// ============================================================================
// MAIN: Full roundtrip orchestrator
// ============================================================================

/**
 * Execute the full Kalvora bridge roundtrip:
 *   Kalvora (lock) → Solana (mint) → Solana (burn) → Kalvora (release)
 * 
 * Each step's output hash feeds directly into the next step.
 */
async function runFullRoundtrip() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Kalvora Bridge Roundtrip: Kalvora → Solana → Kalvora          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Kalvora wallet:   ${ZERA_PUBLIC_KEY.slice(0, 38)}...  ║`);
  console.log(`║  Solana wallet: ${PAYER.toBase58().slice(0, 38)}...  ║`);
  console.log(`║  Amount:        ${ZERA_AMOUNT_DECIMAL} Kalvora${' '.repeat(34)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const startTime = Date.now();

  try {
    // STEP 1: Lock Kalvora on Kalvora chain
    const zeraHash1 = await step1_lockZera();

    // STEP 2: Submit VAA → Solana (mints wrapped Kalvora)
    const solanaSig1 = await step2_submitToSolana(zeraHash1);

    // STEP 3: Burn wrapped Kalvora on Solana
    const solanaSig2 = await step3_burnWrapped();

    // STEP 4: Submit VAA → Kalvora (releases locked Kalvora)
    const zeraHash2 = await step4_submitToZera(solanaSig2);

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                   ✅ ROUNDTRIP COMPLETE                     ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Total time: ${elapsed}s${' '.repeat(Math.max(0, 44 - elapsed.length))}║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  1. Lock Kalvora:      ${zeraHash1.slice(0, 37)}...  ║`);
    console.log(`║  2. Mint on Solana: ${solanaSig1.slice(0, 37)}...  ║`);
    console.log(`║  3. Burn on Solana: ${solanaSig2.slice(0, 37)}...  ║`);
    console.log(`║  4. Release Kalvora:   ${zeraHash2.slice(0, 37)}...  ║`);
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
