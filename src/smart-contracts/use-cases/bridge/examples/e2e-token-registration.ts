/**
 * End-to-End Token Registration (Solana Bridge)
 * 
 * Demonstrates the complete token registration lifecycle:
 * 
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ STEP 1: Request token registration    (permissionless on-chain)│
 *   │ STEP 2: Fetch VAA from guardian       (exp backoff 1s → 120s) │
 *   │ STEP 3: Register token with VAA       (verify + register txs) │
 *   └─────────────────────────────────────────────────────────────────┘
 * 
 * Step 1 is permissionless — anyone can request a token be registered.
 * After step 1 confirms, guardians observe the pending registration,
 * look up the token's price/liquidity, and create a signed VAA.
 * Step 2 fetches that VAA, and step 3 submits it on-chain to complete
 * the registration via the Verify-then-Execute two-transaction split.
 * 
 * @example
 * Run: npx tsx src/smart-contracts/use-cases/bridge/examples/e2e-token-registration.ts
 */

import { create } from '@bufbuild/protobuf';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// --- Solana bridge builders ---
import { createClient } from '../../../../grpc/client-factory.js';
import { SOLANA_TEST_KEYS } from '../../../../test-utils/index.js';
import {
  GuardianService,
  PayloadRequestSchema,
  NETWORK_TYPE
} from '../guardian/index.js';
import type { SolanaPayload } from '../guardian/index.js';
import {
  buildRequestTokenRegistrationTransaction,
  buildRegisterTokenTransaction
} from '../solana/transactions/index.js';
import type { GuardianSignature } from '../solana/types.js';

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

/** Solana wallet */
const solanaWallet = Keypair.fromSecretKey(bs58.decode(SOLANA_TEST_KEYS.primary.privateKey));
const PAYER = solanaWallet.publicKey;

/** Token mint to register (Wrapped SOL used here as an example) */
const MINT = '2SboKX1rFhY2uD3ttXHrKt4mQxdt7nEmphkaAakKmfTt';

// ============================================================================
// HELPER: Sign and send a Solana transaction
// ============================================================================

async function signAndSend(
  transaction: import('@solana/web3.js').Transaction,
  signers: Keypair[],
  opts?: { skipPreflight?: boolean }
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = PAYER;

  transaction.sign(...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: opts?.skipPreflight ?? false
  });

  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight
  }, 'confirmed');

  return signature;
}

// ============================================================================
// HELPER: Fetch VAA with exponential backoff
// ============================================================================

/**
 * Poll the guardian service for the register_payload VAA.
 * Guardians may not have the payload ready immediately after the on-chain tx,
 * so we retry with exponential backoff (1s → 2s → 4s → ... up to 120s total).
 */
async function fetchRegisterVAA(
  txSignature: string,
  maxElapsedMs = 120_000,
  initialDelayMs = 1_000
): Promise<SolanaPayload> {
  const startTime = Date.now();
  let delay = initialDelayMs;
  let attempt = 1;

  while (true) {
    try {
      const client = createClient(GuardianService, GUARDIAN_CONFIG);
      const response = await client.getPayload(
        create(PayloadRequestSchema, { payloadId: txSignature, networkType: NETWORK_TYPE.SOLANA })
      );

      if (response.payload.case !== 'solanaPayload') {
        throw new Error(`Expected solanaPayload, got: ${response.payload.case}`);
      }

      console.log(`  ✅ VAA received on attempt ${attempt} (${Date.now() - startTime}ms elapsed)`);
      return response.payload.value;
    } catch (error) {
      const elapsed = Date.now() - startTime;

      if (elapsed + delay > maxElapsedMs) {
        console.log(`  ❌ VAA fetch timeout after ${elapsed}ms (${attempt} attempts). Giving up.`);
        throw error;
      }

      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  ⏳ Attempt ${attempt} (${elapsed}ms): ${msg}. Retrying in ${delay}ms...`);

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxElapsedMs - (Date.now() - startTime));
      attempt++;
    }
  }
}

// ============================================================================
// STEP 1: Request token registration (permissionless)
// ============================================================================

/**
 * Submit a request_token_registration instruction on Solana.
 * This creates a PendingRegistration account that guardians monitor.
 * Returns the Solana transaction signature for VAA lookup.
 */
async function step1_requestRegistration(): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Request Token Registration (permissionless)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Mint: ${MINT}`);
  console.log('');

  const result = await buildRequestTokenRegistrationTransaction(
    { mint: MINT },
    PAYER,
    connection
  );

  console.log(`  Pending Registration PDA: ${result.accounts.pendingRegistration.toBase58()}`);

  const signature = await signAndSend(result.transaction, [solanaWallet]);
  console.log(`  ✅ Confirmed: ${signature}`);
  console.log('');

  return signature;
}

// ============================================================================
// STEP 2: Fetch VAA from guardian
// ============================================================================

/**
 * Fetch the guardian-signed VAA for the pending registration.
 * Uses exponential backoff since guardians need time to observe
 * the on-chain transaction and look up price/liquidity data.
 */
async function step2_fetchVAA(solanaSig: string): Promise<SolanaPayload> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Fetch VAA from Guardian');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Solana sig: ${solanaSig.slice(0, 30)}...`);
  console.log('  Polling with exp backoff (1s → 120s)...');
  console.log('');

  const vaa = await fetchRegisterVAA(solanaSig);

  // Validate payload type
  if (vaa.payload.case !== 'registerPayload') {
    throw new Error(`Expected registerPayload, got: ${vaa.payload.case}`);
  }

  const reg = vaa.payload.value;
  console.log(`  Mint:           ${reg.solanaMintId}`);
  console.log(`  USD Price:      ${reg.priceUsd} (nano)`);
  console.log(`  Liquidity:      ${reg.liquidityUsd} (nano)`);
  console.log(`  Tier:           ${reg.tier}`);
  console.log(`  Signatures:     ${vaa.signatures.length}`);
  console.log(`  Expected hash:  ${vaa.signedHash.slice(0, 20)}...`);
  console.log('');

  return vaa;
}

// ============================================================================
// STEP 3: Register token with VAA (two-transaction split)
// ============================================================================

/**
 * Submit the register_token transactions using the guardian VAA.
 * Uses the Verify-then-Execute two-transaction split:
 *   TX1: Ed25519 signature verification + core post_verified_transfer
 *   TX2: Token bridge register_token (fresh blockhash)
 */
async function step3_registerToken(vaa: SolanaPayload): Promise<string> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Register Token (Verify-then-Execute)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Extract guardian signatures
  const signatures: GuardianSignature[] = vaa.signatures.map((sig, i) => ({
    signature: sig,
    publicKey: vaa.publicKeys[i] || ''
  }));
  const timestamp = vaa.timestamp
    ? Math.floor(Number(vaa.timestamp.seconds.toString()))
    : Math.floor(Date.now() / 1000);

  const regPayload = vaa.payload.value as import('../guardian/index.js').SolanaRegisterPayload;

  // Build the two transactions
  const result = await buildRegisterTokenTransaction(
    {
      mint: regPayload.solanaMintId,
      txnId: regPayload.txSignature,
      timestamp,
      signatures,
      expectedHash: vaa.signedHash,
      usdPriceNano: BigInt(regPayload.priceUsd.toString()),
      liquidityUsdNano: BigInt(regPayload.liquidityUsd.toString()),
      tier: regPayload.tier
    },
    PAYER,
    connection
  );

  console.log(`  Token Registration PDA: ${result.accounts.tokenRegistration.toBase58()}`);
  console.log(`  Used Marker:            ${result.accounts.usedMarker.toBase58()}`);
  console.log('');

  // TX1: Ed25519 verify + core post_verified_transfer
  console.log('  TX1: Verifying guardian signatures...');
  const sig1 = await signAndSend(result.verifyTransaction, [solanaWallet], { skipPreflight: true });
  console.log(`  ✅ TX1 confirmed: ${sig1}`);

  // TX2: Token bridge register_token (needs fresh blockhash)
  const { blockhash } = await connection.getLatestBlockhash();
  result.registerTransaction.recentBlockhash = blockhash;

  console.log('  TX2: Registering token...');
  const sig2 = await signAndSend(result.registerTransaction, [solanaWallet], { skipPreflight: true });
  console.log(`  ✅ TX2 confirmed: ${sig2}`);
  console.log('');

  return sig2;
}

// ============================================================================
// MAIN: Full token registration orchestrator
// ============================================================================

/**
 * Execute the full token registration flow:
 *   Request registration → Fetch VAA → Register token
 */
async function runTokenRegistration() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          Token Registration: End-to-End Flow               ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Wallet: ${PAYER.toBase58().slice(0, 44)}...  ║`);
  console.log(`║  Mint:   ${MINT.slice(0, 44)}  ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const startTime = Date.now();

  try {
    // STEP 1: Request token registration (permissionless)
    const solanaSig = await step1_requestRegistration();

    // STEP 2: Fetch VAA from guardian (with retry)
    const vaa = await step2_fetchVAA(solanaSig);

    // STEP 3: Register token with VAA (two-transaction split)
    const finalSig = await step3_registerToken(vaa);

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║              ✅ TOKEN REGISTRATION COMPLETE                 ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Total time: ${elapsed}s${' '.repeat(Math.max(0, 44 - elapsed.length))}║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  1. Request:  ${solanaSig.slice(0, 40)}...  ║`);
    console.log(`║  2. Register: ${finalSig.slice(0, 40)}...  ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error('');
    console.error(`❌ Token registration failed after ${elapsed}s`);
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
    console.error('');
    process.exit(1);
  }
}

// ============================================================================
// RUN
// ============================================================================

runTokenRegistration().catch(console.error);
