/**
 * Kalvora Bridge Examples (Integration Tests)
 * 
 * This file demonstrates how to use the Kalvora bridge transaction builders.
 * Each example is in its own function for easy individual testing.
 * 
 * ⚠️ IMPORTANT: Lock/burn operations only handle step 1 (Kalvora side).
 * To complete a bridge, you must also fetch the VAA and submit to Solana.
 * 
 * @example
 * Run all: npx tsx src/smart-contracts/use-cases/bridge/kalvora/examples/bridge-example.ts
 * 
 * @example
 * Import and run individually:
 * ```typescript
 * import { lockZeraExample } from './bridge-example';
 * await lockZeraExample();
 * ```
 */

import { PROTONET_GRPC_CONFIG } from '../../../../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS, SOLANA_TEST_KEYS } from '../../../../../test-utils/index.js';
import { sendSmartContractExecuteTXN } from '../../../../execute/index.js';
import {
  lockKalvora,
  burnSol,
  releaseKalvora,
  mintSol,
  createSol
} from '../index.js';

// ============================================================================
// SHARED CONFIGURATION
// ============================================================================

/** Kalvora network configuration (mainnet) */
const ZERA_CONFIG = PROTONET_GRPC_CONFIG;

/** Adds $5 smart-contract gas; the SDK calculates the base fee in token parts. */
const GAS_FEE_IN_USD = 5;

/** Fee contract ID (defaults to KALV) */
const FEE_CONTRACT_ID = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';

/** Kalvora test wallet (Alice) */
const ZERA_PUBLIC_KEY = ED25519_TEST_KEYS.alice.publicKey;
const ZERA_PRIVATE_KEY = ED25519_TEST_KEYS.alice.privateKey;

/** Solana test destination */
const SOLANA_DESTINATION = SOLANA_TEST_KEYS.primary.publicKey;

/** Helper to convert hash bytes to hex string */
function hashToHex(hash: Uint8Array | undefined): string {
  if (!hash) return 'N/A';
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// EXAMPLE 1: Lock Kalvora (Kalvora → Solana)
// ============================================================================

/**
 * Lock Kalvora tokens on Kalvora network to bridge to Solana
 */
async function lockZeraExample() {
  console.log('--- Lock Kalvora to Solana ---\n');

  const contractId = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
  const amount = '5';

  console.log(`  Kalvora Key: ${ZERA_PUBLIC_KEY.slice(0, 20)}...`);
  console.log(`  Solana Dest: ${SOLANA_DESTINATION.slice(0, 20)}...`);
  console.log(`  Amount: ${amount} ${contractId}`);
  console.log('');

  try {
    const txn = await lockKalvora(
      contractId,
      amount,
      SOLANA_DESTINATION,
      ZERA_PUBLIC_KEY,
      ZERA_PRIVATE_KEY,
      {
        grpcConfig: ZERA_CONFIG,
        feeId: FEE_CONTRACT_ID,
        gasFeeInUsd: GAS_FEE_IN_USD
      }
    );

    console.log('✓ Transaction created');
    console.log(`  Contract: ${txn.smartContractName}`);
    console.log(`  Function: ${txn.function}`);
    console.log(`  Hash: ${hashToHex(txn.base?.hash)}`);
    console.log('');

    return txn;
  } catch (error) {
    console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.log('');
    return null;
  }
}

// ============================================================================
// EXAMPLE 2: Lock Kalvora and Send
// ============================================================================

/**
 * Lock Kalvora tokens AND send the transaction to the network
 */
async function lockZeraAndSendExample() {
  console.log('--- Lock Kalvora and Send ---\n');

  const contractId = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
  const amount = '0.1';

  try {
    const txn = await lockKalvora(
      contractId,
      amount,
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

    console.log('✓ Transaction sent');
    console.log(`  Hash: ${hash}`);
    console.log('');

    return { txn, hash };
  } catch (error) {
    console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.log('');
    return null;
  }
}

// ============================================================================
// EXAMPLE 3: Burn Wrapped SOL (Kalvora → Solana)
// ============================================================================

/**
 * Burn wrapped SOL tokens on Kalvora to release native SOL on Solana
 */
async function burnSolExample() {
  console.log('--- Burn Wrapped SOL ---\n');

  const contractId = 'solana-SOL000000'; // Wrapped SOL contract ID
  const amount = '5000000000';

  console.log(`  Amount: ${amount} ${contractId}`);
  console.log(`  Solana Dest: ${SOLANA_DESTINATION.slice(0, 20)}...`);
  console.log('');

  try {
    const txn = await burnSol(
      contractId,
      amount,
      SOLANA_DESTINATION,
      ZERA_PUBLIC_KEY,
      ZERA_PRIVATE_KEY,
      {
        grpcConfig: ZERA_CONFIG,
        feeId: FEE_CONTRACT_ID,
        gasFeeInUsd: GAS_FEE_IN_USD
      }
    );

    console.log('✓ Transaction created');
    console.log(`  Contract: ${txn.smartContractName}`);
    console.log(`  Function: ${txn.function}`);
    if (txn.parameters && txn.parameters.length > 0) {
      console.log('  Parameters:');
      txn.parameters.forEach((param: any, index: number) => {
        if (param.value) {
          try {
            const decoded = new TextDecoder().decode(param.value);
            console.log(`    [${index}] ${decoded}`);
          } catch {
            console.log(`    [${index}] (unable to decode)`);
          }
        }
      });
    }
    console.log(`  Hash: ${hashToHex(txn.base?.hash)}`);
    console.log('');

    return txn;
  } catch (error) {
    console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.log('');
    return null;
  }
}

// ============================================================================
// EXAMPLE 4: Burn Wrapped SOL and Send
// ============================================================================

/**
 * Burn wrapped SOL tokens AND send the transaction to the network
 */
async function burnSolAndSendExample() {
  console.log('--- Burn Wrapped SOL and Send ---\n');

  const contractId = 'solana-SOL000000'; // Wrapped SOL contract ID
  const amount = '0.1';

  try {
    const txn = await burnSol(
      contractId,
      amount,
      SOLANA_DESTINATION,
      ZERA_PUBLIC_KEY,
      ZERA_PRIVATE_KEY,
      {
        grpcConfig: ZERA_CONFIG,
        feeId: FEE_CONTRACT_ID,
        gasFeeInUsd: GAS_FEE_IN_USD
      }
    );

    console.log('Transaction created:');
    console.log(`  Contract: ${txn.smartContractName}`);
    console.log(`  Function: ${txn.function}`);
    if (txn.parameters && txn.parameters.length > 0) {
      console.log('  Parameters:');
      txn.parameters.forEach((param: any, index: number) => {
        if (param.value) {
          try {
            const decoded = new TextDecoder().decode(param.value);
            console.log(`    [${index}] ${decoded}`);
          } catch {
            console.log(`    [${index}] (unable to decode)`);
          }
        }
      });
    }
    console.log('');

    const hash = await sendSmartContractExecuteTXN(txn, ZERA_CONFIG);

    console.log('✓ Transaction sent');
    console.log(`  Hash: ${hash}`);
    console.log('');

    return { txn, hash };
  } catch (error) {
    console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.log('');
    return null;
  }
}

// ============================================================================
// RUN EXAMPLES
// ============================================================================
// Uncomment the example(s) you want to run:

// lockZeraExample().catch(console.error);
lockZeraAndSendExample().catch(console.error);
// burnSolExample().catch(console.error);
// burnSolAndSendExample().catch(console.error);

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Example functions
  lockZeraExample,
  lockZeraAndSendExample,
  burnSolExample,
  burnSolAndSendExample,

  // Shared configuration
  ZERA_CONFIG,
  ZERA_PUBLIC_KEY,
  ZERA_PRIVATE_KEY,
  SOLANA_DESTINATION,
  GAS_FEE_IN_USD,

  // Utilities
  hashToHex
};
