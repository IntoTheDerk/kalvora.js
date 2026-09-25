/**
 * Validator Nonce Service Examples
 * 
 * This provides examples for the validator nonce service.
 */

import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { TEST_WALLET_ADDRESSES } from '../../../../test-utils/index.js';
import { getNonce, getNonces } from '../service.js';

/**
 * Example 1: Basic Usage
 */
basicUsageExample();
async function basicUsageExample(): Promise<void> {
  console.log('Getting nonce for Alice\'s address...');
  
  const address = TEST_WALLET_ADDRESSES.alice;
  const nonce = await getNonce(address);
  
  console.log(`Address: ${address}`);
  console.log(`Nonce: ${nonce.toString()}`);
  console.log(`Nonce type: ${typeof nonce}`);
  
  if (!nonce || nonce.lt(0)) {
    throw new Error('Invalid nonce returned');
  }
}

/**
 * Example 2: Additional Features
 */
async function advancedFeaturesExample(): Promise<void> {
  console.log('Getting nonces for multiple test addresses with custom config...');
  
  const addresses = [
    TEST_WALLET_ADDRESSES.alice,
    TEST_WALLET_ADDRESSES.bob,
    TEST_WALLET_ADDRESSES.charlie
  ];
  
  const config = { ...PROTONET_GRPC_CONFIG, timeout: 5000 };
  
  const nonces = await getNonces(addresses, config);
  
  console.log(`Addresses: ${addresses.length}`);
  console.log(`Nonces: ${nonces.length}`);
  
  for (let i = 0; i < addresses.length; i++) {
    console.log(`  ${addresses[i]} → ${nonces[i]?.toString() || 'undefined'}`);
  }
  
  if (nonces.length !== addresses.length) {
    throw new Error('Nonce count mismatch');
  }
}

/**
 * Example 3: Error Handling
 */
async function errorHandlingExample(): Promise<void> {
  console.log('Testing error handling with invalid inputs...');
  
  try {
    // Test invalid address
    await getNonce('invalid-address');
    throw new Error('Should have thrown error for invalid address');
  } catch (error) {
    console.log(`✅ Caught expected error: ${(error as Error).message}`);
  }
  
  try {
    // Test empty address array
    await getNonces([]);
    throw new Error('Should have thrown error for empty array');
  } catch (error) {
    console.log(`✅ Caught expected error: ${(error as Error).message}`);
  }
  
  try {
    // Test invalid config
    await getNonce(TEST_WALLET_ADDRESSES.alice, { port: 99999 });
    console.log('⚠️ Invalid config test - may have connected to wrong port');
  } catch (error) {
    console.log(`✅ Caught expected error: ${(error as Error).message}`);
  }
}
