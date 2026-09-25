/**
 * Guardian Bridge Examples
 * 
 * This file demonstrates how to use the guardian VAA (Verified Action Approval) functions
 * for completing cross-chain bridge transfers.
 * 
 * Each example is in its own function for easy individual testing.
 * 
 * @example
 * Run all: npx tsx src/smart-contracts/use-cases/bridge/guardian/examples/guardian-examples.ts
 * 
 * @example
 * Import and run individually:
 * ```typescript
 * import { fetchSolanaVAAExample, submitToSolanaExample } from './guardian-examples';
 * await fetchSolanaVAAExample();
 * ```
 */

import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

import { PROTONET_GRPC_CONFIG } from '../../../../../shared/utils/testing-defaults/index.js';
import { SOLANA_TEST_KEYS, SOLANA_TEST_RPC, ED25519_TEST_KEYS } from '../../../../../test-utils/index.js';
import {
  fetchSolanaVAA,
  fetchKalvoraVAA,
  submitVAAToSolana,
  submitVAAToKalvora,
  NETWORK_TYPE
} from '../index.js';

// ============================================================================
// SHARED CONFIGURATION
// ============================================================================

/** Guardian service configuration */
const GUARDIAN_CONFIG = {
  host: 'kal-protonet.visiondynamics.ch',
  protocol: 'https' as const,
  port: 443
};

/** Solana test wallet */
const solanaWallet = Keypair.fromSecretKey(bs58.decode(SOLANA_TEST_KEYS.primary.privateKey));

/** Solana RPC endpoint — override for mainnet or custom RPC */
const SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const connection = new Connection(SOLANA_RPC_URL);

/** Kalvora network configuration (mainnet) */
const ZERA_CONFIG = PROTONET_GRPC_CONFIG;

/** Adds $5 smart-contract gas; the SDK calculates the base fee in token parts. */
const GAS_FEE_IN_USD = 5;

/** Fee contract ID (defaults to KALV) */
const FEE_CONTRACT_ID = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';

/** Sample transaction hashes for examples */
const SAMPLE_ZERA_TXN_HASH = '0'.repeat(64);
const SAMPLE_SOLANA_SIGNATURE = 'sample_solana_signature';

// ============================================================================
// EXAMPLE 1: Fetch Solana-bound VAA
// ============================================================================

/**
 * Fetch a VAA for a Kalvora → Solana transfer
 * 
 * Use this when a Kalvora transaction needs to trigger a Solana release/mint.
 * 
 * @param zeraTxnHash - The Kalvora transaction hash to fetch VAA for
 */
async function fetchSolanaVAAExample(zeraTxnHash?: string) {
  console.log('--- Fetch Solana VAA ---\n');

  const txnHash = zeraTxnHash || SAMPLE_ZERA_TXN_HASH;
  
  console.log(`Fetching VAA for Kalvora transaction: ${txnHash.slice(0, 20)}...`);
  console.log(`Guardian endpoint: ${GUARDIAN_CONFIG.host}`);
  console.log('');

  try {
    const payload = await fetchSolanaVAA(txnHash, GUARDIAN_CONFIG);
    
    console.log('VAA Payload received:');
    console.log(`  Type: ${payload.payload.case}`);
    console.log('');
    
    return payload;
  } catch (error) {
    console.log('Note: This example requires a valid Kalvora transaction hash.');
    console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.log('');
    return null;
  }
}

// ============================================================================
// EXAMPLE 2: Fetch Kalvora-bound VAA
// ============================================================================

/**
 * Fetch a VAA for a Solana → Kalvora transfer
 * 
 * Use this when a Solana transaction needs to trigger a Kalvora release/mint.
 * 
 * @param solanaTxnSignature - The Solana transaction signature to fetch VAA for
 */
async function fetchZeraVAAExample(solanaTxnSignature?: string) {
  console.log('--- Fetch Kalvora VAA ---\n');

  const txnSignature = solanaTxnSignature || SAMPLE_SOLANA_SIGNATURE;
  
  console.log(`Fetching VAA for Solana transaction: ${txnSignature.slice(0, 20)}...`);
  console.log(`Guardian endpoint: ${GUARDIAN_CONFIG.host}`);
  console.log('');

  try {
    const payload = await fetchKalvoraVAA(txnSignature, GUARDIAN_CONFIG);
    
    console.log('VAA Payload received:');
    console.log(`  Type: ${payload.payload.case}`);
    console.log('');
    
    return payload;
  } catch (error) {
    console.log('Note: This example requires a valid Solana transaction signature.');
    console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.log('');
    return null;
  }
}

// ============================================================================
// EXAMPLE 3: Submit VAA to Solana
// ============================================================================

/**
 * Submit a VAA to Solana to complete a Kalvora → Solana bridge transfer
 * 
 * This fetches the VAA, builds the transaction, and submits it to Solana.
 * 
 * @param zeraTxnHash - The Kalvora transaction hash that initiated the bridge
 */
async function submitToSolanaExample(zeraTxnHash?: string) {
  console.log('--- Submit VAA to Solana ---\n');

  const txnHash = zeraTxnHash || SAMPLE_ZERA_TXN_HASH;
  
  console.log(`Processing Kalvora transaction: ${txnHash.slice(0, 20)}...`);
  console.log(`Solana payer: ${solanaWallet.publicKey.toBase58()}`);
  console.log(`RPC endpoint: ${SOLANA_RPC_URL}`);
  console.log('');

  try {
    const result = await submitVAAToSolana({
      txnHash,
      guardianConfig: GUARDIAN_CONFIG,
      connection,
      payer: solanaWallet,
      skipPreflight: true
    });
    
    console.log('VAA submitted to Solana successfully!');
    console.log(`  Signature: ${result.signature}`);
    console.log(`  Payload type: ${result.payload.payload.case}`);
    console.log('');
    
    return result;
  } catch (error) {
    console.log('Note: This example requires a valid Kalvora transaction hash.');
    console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.log('');
    return null;
  }
}

// ============================================================================
// EXAMPLE 4: Submit VAA to Kalvora
// ============================================================================

/**
 * Submit a VAA to Kalvora to complete a Solana → Kalvora bridge transfer
 * 
 * This fetches the VAA and submits it to the Kalvora network.
 * 
 * @param solanaTxnSignature - The Solana transaction signature that initiated the bridge
 */
async function submitToZeraExample(solanaTxnSignature?: string) {
  console.log('--- Submit VAA to Kalvora ---\n');

  const txSignature = solanaTxnSignature || SAMPLE_SOLANA_SIGNATURE;
  
  console.log(`Processing Solana transaction: ${txSignature.slice(0, 20)}...`);
  console.log(`Kalvora public key: ${ED25519_TEST_KEYS.alice.publicKey.slice(0, 20)}...`);
  console.log('');

  try {
    const result = await submitVAAToKalvora({
      txSignature,
      guardianConfig: GUARDIAN_CONFIG,
      kalvoraConfig: ZERA_CONFIG,
      publicKeyBase58: ED25519_TEST_KEYS.alice.publicKey,
      privateKeyBase58: ED25519_TEST_KEYS.alice.privateKey,
      gasFeeInUsd: GAS_FEE_IN_USD,
      feeId: FEE_CONTRACT_ID
    });
    
    console.log('VAA submitted to Kalvora successfully!');
    console.log(`  Transaction hash: ${result.txnHash}`);
    console.log(`  Payload type: ${result.payload.payload.case}`);
    console.log('');
    
    return result;
  } catch (error) {
    console.log('Note: This example requires a valid Solana transaction signature.');
    console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.log('');
    return null;
  }
}


// ============================================================================
// RUN EXAMPLES
// ============================================================================
// Uncomment the example(s) you want to run:

// Individual examples:
// fetchSolanaVAAExample("41dc92a1fd86ed1aa1b8134abf0a68d8791c38270caad472b9d8efcee947cd73").catch(console.error);
// fetchZeraVAAExample("3j8EWWhQeGETD4gpURWsReDhqsHiRB4HqN2zhvEqJH7ejnJuLSqRKxHxPdjTYC4i8higbPXDrH8Ef54U5CS644wu").catch(console.error);
// submitToSolanaExample("8a04240a4131615670790c52e879255e2c7246de86b43269ef3d800d8c6cc419").catch(console.error);
// submitToZeraExample("4sJCPw15e7d3NTQbvxt4qaDgSpjTEFscVXtX3m9FuhkHeD2QnNuxhqbTaRRrXn7vF4ky1sTyv29bjYFZLvkvXJqc").catch(console.error); //? success

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Individual example functions
  fetchSolanaVAAExample,
  fetchZeraVAAExample,
  submitToSolanaExample,
  submitToZeraExample,
  
  // Shared configuration (useful for custom tests)
  GUARDIAN_CONFIG,
  connection,
  solanaWallet,
  SAMPLE_ZERA_TXN_HASH,
  SAMPLE_SOLANA_SIGNATURE
};
