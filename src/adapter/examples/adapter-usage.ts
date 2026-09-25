/**
 * Adapter Usage Examples — CoinTXN
 *
 * See also:
 *   - vote-adapter-usage.ts      (GovernanceVote)
 *   - contract-adapter-usage.ts  (Contract create/update)
 *   - smart-contract-adapter-usage.ts (Smart contract execute)
 * Demonstrates the complete adapter workflow:
 * 1. Building unsigned transactions
 * 2. Serializing for transport
 * 3. Signing with various signer implementations
 * 4. Finalizing and submitting
 *
 * @example Run with: npx tsx src/adapter/examples/adapter-usage.ts
 */

import { sendCoinTXN } from '../../coin-txn/transaction.js';
import {
  buildCoinTXN,
  signCoinTXN,
  signAndFinalize,
  KeyPairSigner,
  serializeTransaction,
  deserializeTransaction,
  type KalvoraSigner,
  type CoinTXNBuildInput
} from '../index.js';

// ============================================================================
// Example 1: Basic — Build, Sign, Send (with KeyPairSigner)
// ============================================================================

/**
 * The simplest workflow: build an unsigned transaction, sign it locally,
 * and submit it. This replaces the all-in-one `createCoinTXN()` flow.
 */
async function exampleBasicFlow(): Promise<void> {
  console.log('=== Example 1: Basic Build → Sign → Send ===\n');

  // These would come from your wallet / key management
  const publicKey = 'ed25519:YOUR_PUBLIC_KEY';
  const privateKey = 'YOUR_PRIVATE_KEY_BASE58';

  // Step 1: Build the unsigned transaction (no private key needed!)
  const inputs: CoinTXNBuildInput[] = [{
    publicKey,
    amount: '10.5',
    feePercent: '100'
  }];

  const outputs = [{
    to: 'RECIPIENT_ADDRESS',
    amount: '10.0'
  }];

  const unsigned = await buildCoinTXN(
    inputs,
    outputs,
    'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
  );

  console.log('✅ Built unsigned transaction');

  // Step 2: Sign with a KeyPairSigner
  const signer = new KeyPairSigner(publicKey, privateKey);
  const signed = await signCoinTXN(unsigned, [signer]);

  console.log('✅ Transaction signed');

  // Step 3: Send
  const hash = await sendCoinTXN(signed);
  console.log(`✅ Transaction sent! Hash: ${hash}`);
}

// ============================================================================
// Example 2: Serialize for Transport (dApp ↔ Wallet)
// ============================================================================

/**
 * When a dApp builds the transaction on one side and a wallet signs it
 * on another (e.g., via browser extension, QR code, or deep link),
 * you need to serialize the unsigned transaction for transport.
 */
async function exampleSerializationFlow(): Promise<void> {
  console.log('\n=== Example 2: Serialize → Transport → Sign ===\n');

  // ---- dApp side ----

  const inputs: CoinTXNBuildInput[] = [{
    publicKey: 'ed25519:DAPP_USER_PUBLIC_KEY',
    amount: '5.0',
    feePercent: '100'
  }];

  const outputs = [{
    to: 'RECIPIENT_ADDRESS',
    amount: '4.5'
  }];

  const unsigned = await buildCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');

  // Serialize to a portable string
  const envelope = serializeTransaction(unsigned);
  const payload = JSON.stringify(envelope);

  console.log('✅ dApp serialized transaction');
  console.log(`   Type: ${envelope.type}`);
  console.log(`   Size: ${payload.length} bytes`);

  // ---- Transport (HTTP, WebSocket, QR code, etc.) ----
  // ... payload is sent to the wallet ...

  // ---- Wallet side ----

  // Deserialize
  const { CoinTXN } = await import('../../../proto/generated/txn_pb.js');
  const received = deserializeTransaction(payload) as InstanceType<typeof CoinTXN>;

  console.log('✅ Wallet deserialized transaction');

  // Sign with wallet's private key
  const walletSigner = new KeyPairSigner(
    'ed25519:DAPP_USER_PUBLIC_KEY',
    'WALLET_PRIVATE_KEY'
  );
  const signed = await signCoinTXN(received, [walletSigner]);

  console.log('✅ Wallet signed transaction');

  // Send (wallet or dApp can do this)
  const hash = await sendCoinTXN(signed);
  console.log(`✅ Transaction sent! Hash: ${hash}`);
}

// ============================================================================
// Example 3: Custom KalvoraSigner (Browser Wallet Extension)
// ============================================================================

/**
 * Demonstrates how a wallet extension would implement the KalvoraSigner
 * interface to integrate with the Kalvora SDK.
 */
async function exampleCustomSigner(): Promise<void> {
  console.log('\n=== Example 3: Custom KalvoraSigner ===\n');

  // A browser wallet extension would implement KalvoraSigner like this:
  const browserWalletSigner: KalvoraSigner = {
    publicKey: 'ed25519:BROWSER_WALLET_PUBLIC_KEY',

    async sign(data: Uint8Array): Promise<Uint8Array> {
      // In a real implementation, this would:
      // 1. Show a confirmation dialog to the user
      // 2. Use the wallet's internal key management to sign
      // 3. Return the signature bytes

      console.log(`   🔐 Wallet prompted user to sign ${data.length} bytes`);

      // Simulated signature (in reality, the wallet signs internally)
      return new Uint8Array(64); // Ed25519 signatures are 64 bytes
    }
  };

  const inputs: CoinTXNBuildInput[] = [{
    publicKey: browserWalletSigner.publicKey,
    amount: '1.0',
    feePercent: '100'
  }];

  const outputs = [{
    to: 'RECIPIENT_ADDRESS',
    amount: '0.5'
  }];

  const unsigned = await buildCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
  const signed = await signCoinTXN(unsigned, [browserWalletSigner]);

  console.log('✅ Transaction signed by browser wallet');
}

// ============================================================================
// Example 4: Multi-Signer Transaction
// ============================================================================

/**
 * When a transaction has multiple inputs from different wallets,
 * each input needs its own signer.
 */
async function exampleMultiSigner(): Promise<void> {
  console.log('\n=== Example 4: Multi-Signer ===\n');

  const inputs: CoinTXNBuildInput[] = [
    {
      publicKey: 'ed25519:ALICE_PUBLIC_KEY',
      amount: '5.0',
      feePercent: '50'
    },
    {
      publicKey: 'ed25519:BOB_PUBLIC_KEY',
      amount: '5.0',
      feePercent: '50'
    }
  ];

  const outputs = [{
    to: 'CHARLIE_ADDRESS',
    amount: '10.0'
  }];

  const unsigned = await buildCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');

  // Each signer signs independently
  const aliceSigner = new KeyPairSigner('ed25519:ALICE_PUBLIC_KEY', 'ALICE_PRIVATE_KEY');
  const bobSigner = new KeyPairSigner('ed25519:BOB_PUBLIC_KEY', 'BOB_PRIVATE_KEY');

  const signed = await signCoinTXN(unsigned, [aliceSigner, bobSigner]);

  console.log('✅ Transaction signed by both Alice and Bob');
}

// ============================================================================
// Run all examples
// ============================================================================

export {
  exampleBasicFlow,
  exampleSerializationFlow,
  exampleCustomSigner,
  exampleMultiSigner
};
