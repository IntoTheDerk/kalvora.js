/**
 * End-to-End Token-2022 Bridge Roundtrip (Solana Token-2022 ↔ Kalvora)
 *
 * Demonstrates a complete Token-2022 bridge lifecycle:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ STEP 1: Lock Token-2022 on Solana (Token-2022 ATA → vault ATA) │
 *   │ STEP 2: Submit VAA to Kalvora        (Guardian → Kalvora mint/create)│
 *   │ STEP 3: Burn wrapped token on Kalvora (Kalvora → burn)               │
 *   │ STEP 4: Submit VAA to Solana      (Guardian → release_2022)    │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Prerequisites:
 *   - The Token-2022 mint must already be registered on the bridge
 *     (see e2e-token-registration.ts and solana-token2022-bridge-examples.ts)
 *   - The payer's Token-2022 ATA for the token must be funded
 *   - TOKEN_2022_MINT must be a real Token-2022 mint on the selected cluster
 *   - WRAPPED_TOKEN_2022_CONTRACT must be the wrapped Kalvora contract id
 *
 * Each step feeds its output hash into the next step.
 * VAA fetches use exponential backoff (1s → 120s) because guardians
 * may not have the payload ready immediately after the on-chain tx.
 *
 * @example
 * Run: npx tsx src/smart-contracts/use-cases/bridge/examples/e2e-token2022-roundtrip.ts
 */

import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// --- Solana bridge builders ---
import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { SOLANA_TEST_KEYS, ED25519_TEST_KEYS, TEST_WALLET_ADDRESSES } from '../../../../test-utils/index.js';
import { sendSmartContractExecuteTXN } from '../../../execute/index.js';
import {
  submitVAAToSolana,
  submitVAAToKalvora
} from '../guardian/index.js';
import { burnSol } from '../kalvora/index.js';
import {
  buildLockToken2022Transaction
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

/** Public Solana devnet RPC endpoint */
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const connection = new Connection(SOLANA_RPC_URL);

/** Solana wallet (signs lock + release transactions) */
const solanaWallet = Keypair.fromSecretKey(bs58.decode(SOLANA_TEST_KEYS.primary.privateKey));
const PAYER = solanaWallet.publicKey;

/** Kalvora wallet (signs burn transaction) */
const ZERA_PUBLIC_KEY = ED25519_TEST_KEYS.alice.publicKey;
const ZERA_PRIVATE_KEY = ED25519_TEST_KEYS.alice.privateKey;

/** Kalvora testnet network config */
const ZERA_CONFIG = PROTONET_GRPC_CONFIG;

/** Adds $5 smart-contract gas; the SDK calculates the base fee in token parts. */
const GAS_FEE_IN_USD = 5;
const FEE_CONTRACT_ID = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';

/** Kalvora recipient address (Alice's wallet - receives wrapped Token-2022 on Kalvora) */
const ZERA_RECIPIENT = TEST_WALLET_ADDRESSES.alice;

/** Solana destination address (receives released Token-2022 tokens back) */
const SOLANA_DESTINATION = SOLANA_TEST_KEYS.primary.publicKey;

/**
 * Token-2022 mint address on Solana.
 * Already registered on the bridge.
 */
const TOKEN_2022_MINT = 'DX9pi4ye5Xm6Kv1Fgq69Ad3cqX1xP5a7skSpBMPZJhoe';

/**
 * Wrapped Token-2022 contract ID on Kalvora.
 * Fill this in after the wrapped token exists on Kalvora.
 */
const WRAPPED_TOKEN_2022_CONTRACT = 'solana-TST000000';

/** Convert a base-unit token amount into the decimal amount expected by Kalvora. */
function formatTokenAmount(amountAtomic: string, decimals: number): string {
  const amount = BigInt(amountAtomic);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fractional = amount % scale;

  if (fractional === 0n) return whole.toString();

  const fractionalText = fractional.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fractionalText}`;
}

/** Amount to bridge. The Kalvora burn amount is derived from this same value. */
const TOKEN_2022_DECIMALS = 9;
const TOKEN_2022_AMOUNT_ATOMIC = '1000000';
const TOKEN_2022_AMOUNT_DECIMAL = formatTokenAmount(TOKEN_2022_AMOUNT_ATOMIC, TOKEN_2022_DECIMALS);

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
// STEP 1: Lock Token-2022 tokens on Solana → vault
// ============================================================================

/**
 * Lock Token-2022 tokens into the bridge vault on Solana.
 * Transfers tokens from the user's Token-2022 ATA to the vault Token-2022 ATA.
 * Returns the Solana transaction signature, which STEP 2 uses to fetch the VAA.
 */
async function step1_lockToken2022(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Lock Token-2022 on Solana');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Mint:     ${TOKEN_2022_MINT}`);
  console.log(`  Amount:   ${TOKEN_2022_AMOUNT_ATOMIC} atomic (${TOKEN_2022_AMOUNT_DECIMAL} tokens)`);
  console.log(`  Kalvora Dst: ${ZERA_RECIPIENT.slice(0, 30)}...`);
  console.log('');

  const result = await buildLockToken2022Transaction(
    {
      amount: TOKEN_2022_AMOUNT_ATOMIC,
      zeraAddress: ZERA_RECIPIENT,
      mint: TOKEN_2022_MINT
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
// STEP 2: Submit VAA to Kalvora (mints/creates wrapped Token-2022 on Kalvora)
// ============================================================================

/**
 * Fetch the VAA for the Solana lock transaction and submit it to Kalvora.
 * This mints (or creates) the wrapped Token-2022 token on the Kalvora network.
 * Returns the Kalvora transaction hash, which STEP 3 uses.
 */
async function step2_submitToZera(solanaSig: string): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Submit VAA to Kalvora (mint wrapped Token-2022)');
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
// STEP 3: Burn wrapped Token-2022 on Kalvora (initiates release back to Solana)
// ============================================================================

/**
 * Burn the wrapped Token-2022 token on Kalvora to initiate a release back to Solana.
 * Returns the Kalvora transaction hash, which STEP 4 uses to fetch the VAA.
 */
async function step3_burnWrappedToken2022(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Burn wrapped Token-2022 on Kalvora');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Contract:   ${WRAPPED_TOKEN_2022_CONTRACT}`);
  console.log(`  Amount:     ${TOKEN_2022_AMOUNT_DECIMAL} tokens`);
  console.log(`  Solana Dst: ${SOLANA_DESTINATION.slice(0, 30)}...`);
  console.log('');

  if (!WRAPPED_TOKEN_2022_CONTRACT) {
    throw new Error('Set WRAPPED_TOKEN_2022_CONTRACT in the configuration block before STEP 3.');
  }

  const txn = await burnSol(
    WRAPPED_TOKEN_2022_CONTRACT,
    TOKEN_2022_AMOUNT_DECIMAL,
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
// STEP 4: Submit VAA to Solana (releases Token-2022 from vault)
// ============================================================================

/**
 * Fetch the VAA for the Kalvora burn transaction and submit it to Solana.
 * This releases the original Token-2022 tokens from the bridge vault back to the user.
 * Uses the two-transaction split: TX1 (verify + core), TX2 (release_2022).
 */
async function step4_submitToSolana(zeraHash: string): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 4: Submit VAA to Solana (release Token-2022 from vault)');
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
 * Execute the full Token-2022 bridge roundtrip:
 *   Solana (lock Token-2022) → Kalvora (mint wrapped) → Kalvora (burn wrapped) → Solana (release_2022)
 *
 * Each step's output hash feeds directly into the next step.
 */
async function runFullRoundtrip() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Token-2022 Bridge Roundtrip: Solana → Kalvora → Solana      ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Solana wallet: ${PAYER.toBase58().slice(0, 38)}...  ║`);
  console.log(`║  Kalvora wallet:   ${ZERA_PUBLIC_KEY.slice(0, 38)}...  ║`);
  console.log(`║  Token-2022:    ${TOKEN_2022_MINT.slice(0, 38)}...  ║`);
  console.log(`║  Amount:        ${TOKEN_2022_AMOUNT_DECIMAL} token(s)${' '.repeat(31)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const startTime = Date.now();

  try {
    // STEP 1: Lock Token-2022 on Solana
    const solanaSig = await step1_lockToken2022();

    // STEP 2: Submit VAA → Kalvora (mints wrapped Token-2022)
    const zeraHash1 = await step2_submitToZera(solanaSig);

    // STEP 3: Burn wrapped Token-2022 on Kalvora
    const zeraHash2 = await step3_burnWrappedToken2022();

    // STEP 4: Submit VAA → Solana (releases Token-2022 from vault)
    const finalSig = await step4_submitToSolana(zeraHash2);

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                   ✅ ROUNDTRIP COMPLETE                     ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Total time: ${elapsed}s${' '.repeat(Math.max(0, 44 - elapsed.length))}║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  1. Lock 2022:    ${solanaSig.slice(0, 38)}...  ║`);
    console.log(`║  2. Mint on Kalvora: ${zeraHash1.slice(0, 38)}...  ║`);
    console.log(`║  3. Burn on Kalvora: ${zeraHash2.slice(0, 38)}...  ║`);
    console.log(`║  4. Release 2022: ${finalSig.slice(0, 38)}...  ║`);
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
