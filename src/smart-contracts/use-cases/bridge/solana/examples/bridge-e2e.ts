/**
 * Kalvora ↔ Solana Bridge - End-to-End Example
 * 
 * This example demonstrates the complete bridge flow for transferring tokens
 * between Kalvora and Solana networks, including:
 * 
 * 1. Solana → Kalvora (Lock SPL tokens on Solana)
 * 2. Kalvora → Solana (Release tokens using guardian signatures)
 * 3. Kalvora → Solana wrapped tokens (Mint wrapped Kalvora tokens on Solana)
 * 4. Guardian service integration
 */

import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { solanaBridge as solana, guardianBridge as guardian } from 'kalvora.js';

import { SOLANA_TEST_KEYS, SOLANA_TEST_RPC, TEST_WALLET_ADDRESSES } from '../../../../../test-utils/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Solana RPC endpoint (use custom test RPC)
/** Solana RPC endpoint — override for mainnet or custom RPC */
const SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const SOLANA_RPC = SOLANA_RPC_URL;

// Test wallet from centralized test keys
const testWallet = Keypair.fromSecretKey(bs58.decode(SOLANA_TEST_KEYS.primary.privateKey));

// Example addresses
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ZERA_ADDRESS = TEST_WALLET_ADDRESSES.alice; // Use Alice's Kalvora address for testing

// ============================================================================
// EXAMPLE 1: Lock SPL Tokens (Solana → Kalvora)
// ============================================================================

/**
 * Lock SPL tokens on Solana to bridge to Kalvora
 * 
 * User calls this when they want to move tokens FROM Solana TO Kalvora.
 * The tokens are locked in a vault on Solana, and the guardians
 * will mint equivalent tokens on the Kalvora chain.
 */
async function lockSplTokensExample() {
  const connection = new Connection(SOLANA_RPC);
  
  // Use test wallet from centralized test keys
  const wallet = testWallet;
  
  // Build the lock transaction
  const { transaction, accounts } = await solana.buildLockSplTransaction(
    {
      amount: BigInt(1_000_000),     // 1 USDC (6 decimals)
      mint: USDC_MINT,
      zeraAddress: ZERA_ADDRESS      // Your Kalvora address to receive tokens
    },
    wallet.publicKey,
    connection
  );
  
  console.log('Lock transaction accounts:');
  console.log('  User ATA:', accounts.userAta.toString());
  console.log('  Vault ATA:', accounts.vaultAta.toString());
  
  // Sign and send
  transaction.sign(wallet);
  const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
  
  console.log('✅ Tokens locked! Signature:', signature);
  console.log('   Guardians will now attest this transaction on Kalvora chain');
  
  return signature;
}

// ============================================================================
// EXAMPLE 2: Lock Native SOL (Solana → Kalvora)
// ============================================================================

/**
 * Lock native SOL to bridge to Kalvora
 */
async function lockSolExample() {
  const connection = new Connection(SOLANA_RPC);
  const wallet = testWallet;
  
  const { transaction } = await solana.buildLockSolTransaction(
    {
      amount: BigInt(1_000_000_000), // 1 SOL (lamports)
      zeraAddress: ZERA_ADDRESS
    },
    wallet.publicKey,
    connection
  );
  
  transaction.sign(wallet);
  const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
  
  console.log('✅ SOL locked! Signature:', signature);
  return signature;
}

// ============================================================================
// EXAMPLE 3: Release SPL Tokens (Kalvora → Solana) - Guardian Operation
// ============================================================================

/**
 * Release SPL tokens on Solana after a Kalvora → Solana transfer
 * 
 * This is typically executed by the guardian service after
 * observing a bridge transaction on the Kalvora chain.
 * 
 * Flow:
 * 1. User initiates bridge on Kalvora chain
 * 2. Guardians observe the Kalvora transaction
 * 3. Guardians sign the payload (VAA)
 * 4. Guardian calls this function to release tokens on Solana
 */
async function releaseSplTokensExample() {
  const connection = new Connection(SOLANA_RPC);
  const wallet = testWallet; // In production, this would be a guardian wallet
  
  // These values come from the guardian service after observing a Kalvora bridge tx
  const guardianSignatures: solana.GuardianSignature[] = [
    {
      signature: 'base58-encoded-signature-from-guardian-1',
      publicKey: 'base58-encoded-pubkey-of-guardian-1'
    },
    {
      signature: 'base58-encoded-signature-from-guardian-2',
      publicKey: 'base58-encoded-pubkey-of-guardian-2'
    }
    // ... more guardian signatures (need threshold, e.g., 2/3)
  ];
  
  const { transaction, accounts } = await solana.buildReleaseSplTransaction(
    {
      amount: BigInt(1_000_000),              // Amount in smallest units
      recipient: 'recipient-solana-address',  // Solana address to receive
      mint: USDC_MINT,                        // Token mint
      txnId: 'zera-transaction-hash',         // Kalvora chain tx ID
      timestamp: Date.now(),                  // Timestamp
      signatures: guardianSignatures,         // Guardian signatures
      expectedHash: 'expected-vaa-hash',      // Hash for verification
      usdPriceNano: BigInt(1_000_000_000),    // Price info (1 USD)
      liquidityUsdNano: BigInt(10_000_000_000_000), // Liquidity
      tier: 1                                // Tier level
    },
    wallet.publicKey,
    connection
  );
  
  console.log('Release accounts:');
  console.log('  Recipient ATA:', accounts.recipientAta.toString());
  console.log('  Vault ATA:', accounts.vaultAta.toString());
  console.log('  Used Marker:', accounts.usedMarker.toString());
  
  transaction.sign(wallet);
  const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
  
  console.log('✅ Tokens released! Signature:', signature);
  return signature;
}

// ============================================================================
// EXAMPLE 4: Using the Guardian Client
// ============================================================================

/**
 * Query the guardian service to find pending/completed attestations
 * 
 * The guardian service observes bridge transactions and creates VAAs
 * (Verified Action Approvals) that can be used to complete transfers.
 */
async function guardianClientExample() {
  // Note: Direct gRPC client usage requires importing createClient from the grpc module
  // This example demonstrates the pattern - actual usage depends on SDK export structure
  
  // Use these VAA helper functions instead for most use cases:
  // - guardian.fetchSolanaVAA() - fetch VAA for Kalvora→Solana
  // - guardian.fetchKalvoraVAA() - fetch VAA for Solana→Kalvora  
  // - guardian.submitVAAToSolana() - complete Kalvora→Solana transfer
  // - guardian.submitVAAToKalvora() - complete Solana→Kalvora transfer
  
  console.log('See the VAA helper functions for common operations');
}

// ============================================================================
// EXAMPLE 5: Complete Bridge Flow (Multi-Chain)
// ============================================================================

/**
 * Complete end-to-end bridge flow from Solana to Kalvora
 * 
 * This shows the typical user journey:
 * 1. User locks tokens on Solana
 * 2. Wait for guardian attestation
 * 3. Tokens appear on Kalvora chain
 */
async function completeBridgeFlowExample() {
  console.log('=== Kalvora ↔ Solana Bridge Example ===\n');
  
  // Step 1: User locks SPL tokens on Solana
  console.log('Step 1: Locking SPL tokens on Solana...');
  const lockSignature = await lockSplTokensExample();
  console.log(`   Transaction: ${lockSignature}\n`);
  
  // Step 2: Wait for guardian attestation
  console.log('Step 2: Waiting for guardian attestation...');
  console.log('   Guardians observe the lock transaction');
  console.log('   Guardians sign a VAA (Verified Action Approval)');
  console.log('   Guardians submit attestation to Kalvora chain');
  console.log('   (This typically takes 1-5 minutes)\n');
  
  // Step 3: Tokens are minted on Kalvora chain
  console.log('Step 3: Tokens minted on Kalvora chain');
  console.log('   User can now use their tokens on Kalvora!\n');
  
  console.log('=== Bridge Complete ===');
}

// ============================================================================
// EXAMPLE 6: Burn Wrapped Tokens (Solana → Kalvora, returning)
// ============================================================================

/**
 * Burn wrapped Kalvora tokens on Solana to get them back on Kalvora chain
 * 
 * This is for tokens that originated on Kalvora and were wrapped on Solana.
 * Burning them removes them from Solana and unlocks them on Kalvora.
 */
async function burnWrappedTokensExample() {
  const connection = new Connection(SOLANA_RPC);
  const wallet = testWallet;
  
  // Derive the wrapped mint address for a Kalvora contract
  const [wrappedMint] = solana.deriveWrappedMintPDA('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
  
  const { transaction } = await solana.buildBurnWrappedTransaction(
    {
      amount: BigInt(1_000_000_000),  // 1 token (9 decimals typically)
      wrappedMint: wrappedMint.toString(),
      zeraRecipient: ZERA_ADDRESS    // Kalvora address to receive unlocked tokens
    },
    wallet.publicKey,
    connection
  );
  
  transaction.sign(wallet);
  const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
  
  console.log('✅ Wrapped tokens burned! Signature:', signature);
  console.log('   Guardians will unlock tokens on Kalvora chain');
  
  return signature;
}

// ============================================================================
// UTILITY: PDA Derivation Examples
// ============================================================================

/**
 * Examples of deriving various PDAs (Program Derived Addresses)
 * 
 * These are deterministic addresses used by the bridge programs
 * to store state and hold assets.
 */
function pdaExamples() {
  const mint = new PublicKey(USDC_MINT);
  
  // Router PDAs
  const [routerSigner] = solana.deriveRouterSignerPDA();
  const [routerConfig] = solana.deriveRouterConfigPDA();
  const [vault] = solana.deriveVaultPDA();
  
  console.log('Router PDAs:');
  console.log('  Signer:', routerSigner.toString());
  console.log('  Config:', routerConfig.toString());
  console.log('  Vault:', vault.toString());
  
  // Token-specific PDAs
  const [tokenRegistration] = solana.deriveTokenRegistrationPDA(mint);
  console.log('  Token Registration:', tokenRegistration.toString());
  
  // Wrapped token PDAs (for Kalvora tokens on Solana)
  const [wrappedMint] = solana.deriveWrappedMintPDA('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
  const [mintAuthority] = solana.deriveWrappedMintAuthorityPDA(wrappedMint);
  const [metadata] = solana.deriveMetadataPDA(wrappedMint);
  
  console.log('\nWrapped Token PDAs:');
  console.log('  Wrapped Mint:', wrappedMint.toString());
  console.log('  Mint Authority:', mintAuthority.toString());
  console.log('  Metadata:', metadata.toString());
  
  // Associated Token Account
  const owner = new PublicKey('owner-public-key');
  const ata = solana.getATA(owner, mint);
  console.log('\nATA for owner:', ata.toString());
}

// ============================================================================
// RUN EXAMPLES
// ============================================================================

// Uncomment to run examples:
// completeBridgeFlowExample().catch(console.error);
// pdaExamples();
// guardianClientExample().catch(console.error);

export {
  lockSplTokensExample,
  lockSolExample,
  releaseSplTokensExample,
  guardianClientExample,
  completeBridgeFlowExample,
  burnWrappedTokensExample,
  pdaExamples
};
