/**
 * Real-World SDK Usage Examples
 * 
 * This file demonstrates how to use the Kalvora SDK in real scenarios,
 * showing how users would construct transactions by pulling wallet data
 * from their own data sources and building inputs/outputs manually.
 * 
 * Memo's optional. Base memo more typically used. Transfer memo for multi-output if required.
 */

import type { FeeConfig } from '../../shared/fee-calculators/universal-fee-calculator.js';
import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import {
  ED25519_TEST_KEYS,
  ED448_TEST_KEYS,
  TEST_WALLET_ADDRESSES
} from '../../test-utils/index.js';
import type { CoinTXNInput, CoinTXNOutput, GRPCConfig } from '../../types/index.js';
import { createCoinTXN, sendCoinTXN } from '../index.js';

/**
 * Example 1: Simple Transfer
 * Alice sends 1.5 KALV to Bob
 * 
 * This shows how users would construct a transaction by pulling wallet data
 * from their own data sources (database, config files, etc.)
 */
exampleSimpleTransfer();
export async function exampleSimpleTransfer(customFeeConfig?: FeeConfig, customGrpcConfig?: GRPCConfig): Promise<void> {
  console.log('💸 Example 1: Simple Transfer');
  
  // Start timer for end-to-end measurement
  const startTime = Date.now();
  
  // In a real application, you would pull this data from your storage
  const aliceWallet = ED25519_TEST_KEYS.alice;
  const bobAddress = TEST_WALLET_ADDRESSES.bob;
  
  console.log('📋 Wallet data pulled from data source:');
  console.log('  Alice private key:', `${aliceWallet.privateKey.substring(0, 20)}...`);
  console.log('  Alice public key:', aliceWallet.publicKey);
  console.log('  Bob address:', bobAddress);
  
  // Construct input manually (as users would do)
  const input: CoinTXNInput[] = [
    {
      privateKey: aliceWallet.privateKey,
      publicKey: aliceWallet.publicKey,
      amount: '1.5',
      feePercent: '100'
    }
  ];
  
  // Construct output manually (as users would do)
  const output: CoinTXNOutput[] = [
    {
      to: bobAddress,
      amount: '1.5',
      memo: 'Transfer to Bob'
    }
  ];
  
  // This can be left empty to default to Kalvora, shown for example
  const feeConfig: FeeConfig = customFeeConfig || {
    //baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
    //contractFeeId: 'TESTFEE0002',
    //contractFee: '0.05'
    
    //contractFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
    // overestimatePercent: 2.5 // default 5% if not specified
  };

  // Use custom gRPC config if provided, otherwise fall back to PROTONET_GRPC_CONFIG
  const grpcConfig = customGrpcConfig || PROTONET_GRPC_CONFIG;
  
  try {
    console.log('🔨 Creating transaction...');
    console.log(`  Using gRPC host: ${grpcConfig.host}`);
    const coinTxn = await createCoinTXN(input, output, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', feeConfig, '', grpcConfig);
    
    console.log('✅ Transaction created successfully!');
    console.log('  Transaction ID:', coinTxn.base?.hash ? 'Generated' : 'Not generated');
    console.log('  Input count:', input.length);
    console.log('  Output count:', output.length);
    
    // In a real application, you would send this to the network
    console.log('📡 Sending transaction to network...');
    const result = await sendCoinTXN(coinTxn, grpcConfig);
    
    console.log('🎉 Transaction sent successfully!');
    console.log('  Result:', result);
    
    // Calculate and display end-to-end time
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    console.log(`⏱️  End-to-end time: ${totalTime}ms`);

    console.log('Done Example');
    
  } catch (error) {
    // Calculate and display time even on failure
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    console.log(`⏱️  Time to failure: ${totalTime}ms`);
    
    console.error('❌ Transaction failed:', (error as Error).message);
    throw error;
  }
}

// ... rest of the file ...

// Add this at the bottom of the file:
// Run automatically if executed directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('real-world-usage.ts')) {
  exampleSimpleTransfer().catch(console.error);
}


/**
 * Example 2: Multi-Input Transfer
 * Alice and Bob both send money to Charlie
 * 
 * This demonstrates how to handle multiple inputs from different wallets
 */
//exampleMultiInputTransfer();
export async function exampleMultiInputTransfer(): Promise<void> {
  console.log('💸 Example 2: Multi-Input Transfer');
  
  // Pull wallet data from different sources
  //const aliceWallet = ED25519_TEST_KEYS.bob;
  const aliceWallet = ED448_TEST_KEYS.alice;
  const bobWallet = ED448_TEST_KEYS.bob;
  const charlieWallet = ED25519_TEST_KEYS.charlie;
  const charlieAddress = TEST_WALLET_ADDRESSES.charlie;
  
  console.log('📋 Multi-wallet data:');
  console.log('  Alice (ED448):', aliceWallet.address);
  console.log('  Bob (ED448):', bobWallet.address);
  console.log('  Charlie (ED25519):', charlieWallet.address);
  console.log('  Charlie (recipient):', charlieAddress);
  
  // Multiple inputs from different wallets
  const inputs: CoinTXNInput[] = [
    {
      privateKey: charlieWallet.privateKey,
      publicKey: charlieWallet.publicKey,
      amount: '1.5',
      feePercent: '60' // Alice pays 60% of fees
    },
    {
      privateKey: bobWallet.privateKey,
      publicKey: bobWallet.publicKey,
      amount: '2.5',
      feePercent: '40' // Bob pays 40% of fees
    },
    {
      privateKey: charlieWallet.privateKey,
      publicKey: charlieWallet.publicKey,
      amount: '1.5',
      feePercent: '0'
    }
  ];
  
  // Single output to Charlie
  const outputs: CoinTXNOutput[] = [
    {
      to: charlieAddress,
      amount: '5.5', // Total amount
      memo: 'Joint transfer from Alice and Bob'
    }
  ];
  
  // This can be left empty to default to Kalvora, shown for example
  const feeConfig: FeeConfig = {
    baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
    
  };
  
  try {
    console.log('🔨 Creating multi-input transaction...');
    // Use testing gRPC configuration inline

    const coinTxn = await createCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', feeConfig, '', PROTONET_GRPC_CONFIG);
    
    console.log('✅ Multi-input transaction created!');
    console.log('  Inputs:', inputs.length);
    console.log('  Outputs:', outputs.length);
    console.log('  Total amount:', '3.5 KALV');
    
    const result = await sendCoinTXN(coinTxn);
    console.log('🎉 Multi-input transaction sent!');
    console.log('  Result:', result);
        
  } catch (error) {
    console.error('❌ Multi-input transaction failed:', (error as Error).message);
    throw error;
  }
}

/**
 * Example 3: Multi-Output Transfer
 * Alice sends money to multiple recipients
 * 
 * This shows how to handle multiple outputs (splitting transfers)
 */
export async function exampleMultiOutputTransfer(): Promise<void> {
  console.log('💸 Example 3: Multi-Output Transfer');
  
  const aliceWallet = ED25519_TEST_KEYS.alice;
  const bobAddress = TEST_WALLET_ADDRESSES.bob;
  const charlieAddress = TEST_WALLET_ADDRESSES.charlie;
  const jesseAddress = TEST_WALLET_ADDRESSES.jesse;
  
  console.log('📋 Transfer splitting:');
  console.log('  From Alice to Bob, Charlie, and Jesse');
  
  // Single input from Alice
  const inputs: CoinTXNInput[] = [
    {
      privateKey: aliceWallet.privateKey,
      publicKey: aliceWallet.publicKey,
      amount: '5.0', // Alice sends 5 KALV total
      feePercent: '100'
    }
  ];
  
  // Multiple outputs to different recipients
  const outputs: CoinTXNOutput[] = [
    {
      to: bobAddress,
      amount: '2.0',
      memo: 'Transfer to Bob'
    },
    {
      to: charlieAddress,
      amount: '1.5',
      memo: 'Transfer to Charlie'
    },
    {
      to: jesseAddress,
      amount: '1.5',
      memo: 'Transfer to Jesse'
    }
  ];
  
  // This can be left empty to default to Kalvora, shown for example
  const feeConfig: FeeConfig = {
    baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
    
  };
  
  try {
    console.log('🔨 Creating multi-output transaction...');
    const coinTxn = await createCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', feeConfig, '', PROTONET_GRPC_CONFIG);
    
    console.log('✅ Multi-output transaction created!');
    console.log('  Recipients:', outputs.length);
    console.log('  Total distributed:', '5.0 KALV');
    
    const result = await sendCoinTXN(coinTxn);
    console.log('🎉 Multi-output transaction sent!');
    console.log('  Result:', result);
    
  } catch (error) {
    console.error('❌ Multi-output transaction failed:', (error as Error).message);
    throw error;
  }
}

/**
 * Example 4: Complex Multi-Input/Multi-Output Transfer
 * Alice and Bob send money to Charlie and Jesse
 * 
 * This demonstrates the most complex scenario with multiple inputs and outputs
 */
export async function exampleComplexTransfer(): Promise<void> {
  console.log('💸 Example 4: Complex Multi-Input/Multi-Output Transfer');
  
  const aliceWallet = ED25519_TEST_KEYS.alice;
  const bobWallet = ED448_TEST_KEYS.bob;
  const charlieAddress = TEST_WALLET_ADDRESSES.charlie;
  const jesseAddress = TEST_WALLET_ADDRESSES.jesse;
  
  console.log('📋 Complex transfer scenario:');
  console.log('  Alice + Bob → Charlie + Jesse');
  
  // Multiple inputs
  const inputs: CoinTXNInput[] = [
    {
      privateKey: aliceWallet.privateKey,
      publicKey: aliceWallet.publicKey,
      amount: '3.0',
      feePercent: '70' // Alice pays 70% of fees
    },
    {
      privateKey: bobWallet.privateKey,
      publicKey: bobWallet.publicKey,
      amount: '2.0',
      feePercent: '30' // Bob pays 30% of fees
    }
  ];
  
  // Multiple outputs
  const outputs: CoinTXNOutput[] = [
    {
      to: charlieAddress,
      amount: '3.5',
      memo: 'Transfer to Charlie'
    },
    {
      to: jesseAddress,
      amount: '1.5',
      memo: 'Transfer to Jesse'
    }
  ];
  
  // This can be left empty to default to Kalvora, shown for example
  const feeConfig: FeeConfig = {
    baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    baseFee: '1.234',
    contractFeeId: 'HELLO0000',
    contractFee: '123456789'
  };
  
  try {
    console.log('🔨 Creating complex transaction...');
    const coinTxn = await createCoinTXN(inputs, outputs, 'HELLO0000', feeConfig, '', PROTONET_GRPC_CONFIG);
    
    console.log('✅ Complex transaction created!');
    console.log('  Inputs:', inputs.length);
    console.log('  Outputs:', outputs.length);
    console.log('  Total sent:', '5.0 KALV');
    console.log('  Total received:', '5.0 KALV');
    
    const result = await sendCoinTXN(coinTxn);
    console.log('🎉 Complex transaction sent!');
    console.log('  Result:', result);
    
  } catch (error) {
    console.error('❌ Complex transaction failed:', (error as Error).message);
    throw error;
  }
}

/**
 * Example 5: Custom Fee Configuration
 * Using different fee settings for specific use cases
 */
export async function exampleCustomFees(): Promise<void> {
  console.log('💸 Example 5: Custom Fee Configuration');
  
  const aliceWallet = ED25519_TEST_KEYS.alice;
  const bobAddress = TEST_WALLET_ADDRESSES.bob;
  
  const input: CoinTXNInput[] = [
    {
      privateKey: aliceWallet.privateKey,
      publicKey: aliceWallet.publicKey,
      amount: '1.0',
      feePercent: '100'
    }
  ];
  
  const output: CoinTXNOutput[] = [
    {
      to: bobAddress,
      amount: '1.0',
      memo: 'Custom fee transfer'
    }
  ];
  
  // Custom fee configuration for high-priority transaction
  const customFeeConfig: FeeConfig = {
    baseFeeId: 'TESTFEES0000',
    baseFee: '1.234',
    contractFeeId: 'TESTFEES0000',
    contractFee: '0.005'
  };
  
  try {
    console.log('🔨 Creating transaction with custom fees...');
    console.log('  Base fee:', customFeeConfig.baseFee);
    console.log('  Contract fee:', customFeeConfig.contractFee);
    
    const coinTxn = await createCoinTXN(input, output, 'TESTFEES0000', customFeeConfig, '', PROTONET_GRPC_CONFIG);
    
    console.log('✅ Custom fee transaction created!');
    
    const result = await sendCoinTXN(coinTxn);
    console.log('🎉 Custom fee transaction sent!');
    console.log('  Result:', result);
    
  } catch (error) {
    console.error('❌ Custom fee transaction failed:', (error as Error).message);
    throw error;
  }
}

/**
 * Example 5: Allowance Transfer
 * Demonstrating allowance authorization transfers
 * 
 * For allowance transactions to work, the authorizer authorizes someone else 
 * to spend funds on their behalf.
 */

export async function exampleAllowanceTransfer(): Promise<void> {
  console.log('💸 Example 5: Allowance Transfer');
  
  const aliceWallet = ED25519_TEST_KEYS.alice; // Authorizer (signs the transaction)
  const charlieAddress = TEST_WALLET_ADDRESSES.charlie; // Allowance holder (wants to spend Alice's funds)
  const bobAddress = TEST_WALLET_ADDRESSES.bob; // Recipient
  
  const inputs: CoinTXNInput[] = [
    // The caller (your wallet) is always index [0]
    {
      privateKey: aliceWallet.privateKey,
      publicKey: aliceWallet.publicKey,
      feePercent: '100' // [0] MUST always pay 100% of fee in allowance transaction
    },
    // [1], [2], ..., can be different addresses that have provided an allowance to [0]
    {
      // Allowance input - Alice spending Charlie's funds
      allowanceAddress: charlieAddress,
      amount: '2.0'
    }
  ];
  
  const outputs: CoinTXNOutput[] = [
    {
      to: bobAddress,
      amount: '2.0',
      memo: 'Allowance transfer triggered by Alice to Bob with Charlies funds'
    }
  ];
  
  try {    
    console.log('🔨 Creating allowance transfer...');
    
    const coinTxn = await createCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', { baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' }, 'Allowance authorization', PROTONET_GRPC_CONFIG);
    
    console.log('✅ Allowance transaction created!');
    
    const result = await sendCoinTXN(coinTxn);
    console.log('🎉 Allowance transaction sent!');
    console.log('  Result:', result);
    
  } catch (error) {
    console.error('❌ Allowance transaction failed:', (error as Error).message);
    throw error;
  }
}

/**
 * Example 6: Manual Nonce Specification
 * Demonstrating how to manually specify nonces to skip network fetch
 *
 * Use this when you already know the nonce (e.g., from a previous query)
 * or when building offline transactions.
 *
 * WARNING: Manually specified nonces are not validated. Incorrect nonces
 * will cause transaction failure.
 */
export async function exampleManualNonce(): Promise<void> {
  console.log('💸 Example 6: Manual Nonce Specification');

  const aliceWallet = ED25519_TEST_KEYS.alice;
  const bobAddress = TEST_WALLET_ADDRESSES.bob;

  console.log('📋 Using manual nonce to skip network fetch:');

  // Input with manual nonce - this skips the network call to fetch nonce
  const inputs: CoinTXNInput[] = [
    {
      privateKey: aliceWallet.privateKey,
      publicKey: aliceWallet.publicKey,
      amount: '1.0',
      feePercent: '100',
      nonce: '5' // Manual nonce - WARNING: not validated!
    }
  ];

  const outputs: CoinTXNOutput[] = [
    {
      to: bobAddress,
      amount: '1.0',
      memo: 'Transfer with manual nonce'
    }
  ];

  // You can also manually specify fees to skip fee calculation network calls
  // Note: Manual fees are used exactly as provided (no overestimation applied)
  const feeConfig: FeeConfig = {
    baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    baseFee: '100000000' // Manual fee in smallest units - used exactly, not validated!
  };

  try {
    console.log('🔨 Creating transaction with manual nonce...');
    console.log('  Note: Network nonce fetch will be skipped');
    console.log('  Note: Fee calculation will be skipped (manual fee provided)');

    const coinTxn = await createCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', feeConfig, '', PROTONET_GRPC_CONFIG);

    console.log('✅ Transaction created with manual nonce!');
    console.log('  Manual nonce used: 5');
    console.log('  Manual fee used: 100000000');

    // Note: This will fail if the nonce is incorrect or fee invalid
    // const result = await sendCoinTXN(coinTxn);
    // console.log('🎉 Transaction sent!', result);

  } catch (error) {
    console.error('❌ Transaction failed:', (error as Error).message);
    throw error;
  }
}

/**
 * Example 7: Error Handling
 * Demonstrating proper error handling in real applications
 */
export async function exampleErrorHandling(): Promise<void> {
  console.log('💸 Example 7: Error Handling');
  
  try {
    // This will fail because we're using invalid data
    const invalidInput: CoinTXNInput[] = [
      {
        privateKey: 'invalid-key',
        publicKey: 'invalid-public-key',
        amount: '0', // Invalid amount
        feePercent: '100'
      }
    ];
    
    const invalidOutput: CoinTXNOutput[] = [
      {
        to: 'invalid-address',
        amount: '0',
        memo: 'This will fail'
      }
    ];
    
    // This can be left empty to default to Kalvora, shown for example
    const feeConfig: FeeConfig = {

      baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      baseFee: '0.001',
      contractFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      contractFee: '0.0005'
    };
    
    console.log('🔨 Attempting transaction with invalid data...');
    await createCoinTXN(invalidInput, invalidOutput, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', feeConfig, '', PROTONET_GRPC_CONFIG);
    
    console.log('❌ This should not have succeeded!');
    
  } catch (error) {
    console.log('✅ Error caught successfully!');
    console.log('  Error type:', (error as Error).constructor.name);
    console.log('  Error message:', (error as Error).message);
  }
}