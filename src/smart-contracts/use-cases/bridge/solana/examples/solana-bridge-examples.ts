/**
 * Solana Bridge Examples (Integration Tests)
 * 
 * This file demonstrates how to use the Solana bridge transaction builders.
 * Each example builds, signs, and sends transactions to the configured RPC endpoint.
 * 
 * @example
 * Run all: npx tsx src/smart-contracts/use-cases/bridge/solana/examples/solana-bridge-examples.ts
 * 
 * @example
 * Import and run individually:
 * ```typescript
 * import { lockSolExample } from './solana-bridge-examples';
 * await lockSolExample();
 * ```
 */

import { create } from '@bufbuild/protobuf';
import bs58 from 'bs58';

import { createClient } from '../../../../../grpc/client-factory.js';
import { PROTONET_GRPC_CONFIG } from '../../../../../shared/utils/testing-defaults/index.js';
import { SOLANA_TEST_KEYS, SOLANA_TEST_RPC, TEST_WALLET_ADDRESSES } from '../../../../../test-utils/index.js';
import { fetchSolanaVAA, GuardianService, PayloadRequestSchema, NETWORK_TYPE } from '../../guardian/index.js';
import type { SolanaPayload } from '../../guardian/index.js';
import type { GuardianSignature } from '../../solana/index.js';
import {
  buildLockSplTransaction,
  buildLockSolTransaction,
  buildReleaseSplTransaction,
  buildMintWrappedTransaction,
  buildBurnWrappedTransaction,
  buildRequestTokenRegistrationTransaction,
  buildRegisterTokenTransaction,
  deriveWrappedMintPDA,
  TOKEN_BRIDGE_PROGRAM_ID,
  PublicKey,
  Connection,
  Keypair
} from '../index.js';

// ============================================================================
// SHARED CONFIGURATION
// ============================================================================

/** Solana RPC endpoint — override for mainnet or custom RPC */
const SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const connection = new Connection(SOLANA_RPC_URL);

/** Test wallet from centralized test keys */
const wallet = Keypair.fromSecretKey(bs58.decode(SOLANA_TEST_KEYS.primary.privateKey));
const PAYER = wallet.publicKey;

/** Guardian configuration for fetching VAAs */
const GUARDIAN_CONFIG = {
  host: 'kal-protonet.visiondynamics.ch',
  protocol: 'https' as const,
  port: 443
};

/** Common test addresses */
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TEST_RECIPIENT = PAYER.toBase58();
const ZERA_RECIPIENT = TEST_WALLET_ADDRESSES.alice;

// ============================================================================
// HELPER: Sign and Send Transaction
// ============================================================================

/**
 * Signs and sends a transaction with proper confirmation
 */
async function signAndSend(transaction: any, signers: Keypair[], options?: { skipPreflight?: boolean }): Promise<string> {
  // Sign
  transaction.sign(...signers);
  
  // Send
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: options?.skipPreflight ?? false,
    preflightCommitment: 'confirmed'
  });
  
  console.log(`  Sent: ${signature}`);

  // Confirm
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight
  }, 'confirmed');
  
  if (confirmation.value.err) {
    console.log(confirmation.value.err);
  }

  return signature;
}

// ============================================================================
// EXAMPLE 1: Lock SPL Tokens
// ============================================================================

/**
 * Lock SPL tokens on Solana to bridge to Kalvora
 */
async function lockSplExample() {
  console.log('--- Lock SPL Tokens ---\n');

  const result = await buildLockSplTransaction(
    {
      amount: '1000000000', // 1 token (9 decimals)
      zeraAddress: ZERA_RECIPIENT,
      mint: USDC_MINT
    },
    PAYER,
    connection
  );

  console.log(`  Program ID: ${TOKEN_BRIDGE_PROGRAM_ID.toBase58()}`);
  console.log(`  User ATA: ${result.accounts.userAta.toBase58()}`);
  console.log(`  Vault ATA: ${result.accounts.vaultAta.toBase58()}`);

  const signature = await signAndSend(result.transaction, [wallet]);
  console.log(`✓ Confirmed: ${signature}\n`);

  return { ...result, signature };
}

// ============================================================================
// EXAMPLE 2: Lock Native SOL
// ============================================================================

/**
 * Lock native SOL on Solana to bridge to Kalvora
 */
async function lockSolExample() {
  console.log('--- Lock Native SOL ---\n');

  const result = await buildLockSolTransaction(
    {
      amount: '5000000000', // 5 SOL
      zeraAddress: ZERA_RECIPIENT
    },
    PAYER,
    connection
  );

  console.log(`  Program ID: ${TOKEN_BRIDGE_PROGRAM_ID.toBase58()}`);
  console.log(`  Vault ATA: ${result.accounts.vaultAta.toBase58()}`);

  const signature = await signAndSend(result.transaction, [wallet]);
  console.log(`✓ Confirmed: ${signature}\n`);

  return { ...result, signature };
}

// ============================================================================
// EXAMPLE 3: Release SPL Tokens
// ============================================================================

/**
 * Release SPL tokens on Solana after VAA verification (Kalvora → Solana)
 * Fetches the VAA from guardian and uses the real payload data.
 * @param txnHash - Kalvora transaction hash from the burn/lock operation
 */
async function releaseSplExample(txnHash: string) {
  console.log('--- Release SPL Tokens ---\n');

  // 1. Fetch VAA from guardian
  console.log(`Fetching VAA for: ${txnHash.slice(0, 20)}...`);
  const vaa = await fetchSolanaVAA(txnHash, GUARDIAN_CONFIG);
  
  if (vaa.payload.case !== 'releasePayload') {
    throw new Error(`Expected releasePayload, got: ${vaa.payload.case}`);
  }
  const release = vaa.payload.value;
  const signatures: GuardianSignature[] = vaa.signatures.map((sig, i) => ({
    signature: sig,
    publicKey: vaa.publicKeys[i] || ''
  }));
  const timestamp = vaa.timestamp
    ? Math.floor(Number(vaa.timestamp.seconds.toString()))
    : Math.floor(Date.now() / 1000);

  console.log(`  Amount: ${release.amount}`);
  console.log(`  Recipient: ${release.solanaWalletAddress}`);
  console.log(`  Mint: ${release.solanaMintAddress}`);
  console.log(`  USD: ${release.usdAmount}`);
  console.log('');

  // 2. Build transaction using real VAA data (returns separate verify + release transactions)
  const result = await buildReleaseSplTransaction(
    {
      amount: BigInt(release.amount.toString()),
      recipient: release.solanaWalletAddress,
      mint: release.solanaMintAddress,
      txnId: release.txnHash,
      timestamp,
      signatures,
      expectedHash: vaa.signedHash,
      usdPriceNano: BigInt(release.usdAmount.toString()),
      liquidityUsdNano: BigInt(release.liquidityUsd.toString()),
      tier: release.tier
    },
    PAYER,
    connection
  );

  console.log(`  Recipient ATA: ${result.accounts.recipientAta.toBase58()}`);

  // TX1: Ed25519 signature verification + core post_verified_transfer
  console.log('  TX1: Verifying signatures + core post_verified_transfer...');
  const sig1 = await signAndSend(result.verifyTransaction, [wallet], { skipPreflight: true });
  console.log(`  ✅ TX1 confirmed: ${sig1}`);

  // TX2: Token bridge release_spl (fresh blockhash)
  const { blockhash: bh2 } = await connection.getLatestBlockhash();
  result.releaseTransaction.recentBlockhash = bh2;

  console.log('  TX2: Releasing SPL tokens...');
  const sig2 = await signAndSend(result.releaseTransaction, [wallet], { skipPreflight: true });
  console.log(`✓ TX2 confirmed: ${sig2}\n`);

  return { ...result, signature: sig2 };
}

// ============================================================================
// NOTE: Release Native SOL has been removed.
// SOL is always released via the SPL path (release_spl) using the
// Wrapped SOL mint (So11111111111111111111111111111111111111112).
// Use releaseSplExample above for all release operations.
// ============================================================================

// ============================================================================
// EXAMPLE 5: Mint Wrapped Kalvora Tokens
// ============================================================================

/**
 * Mint wrapped Kalvora tokens on Solana (Kalvora → Solana wrapped)
 * Fetches the VAA from guardian and uses the real payload data.
 * @param txnHash - Kalvora transaction hash from the lock operation
 */
async function mintWrappedExample(txnHash: string) {
  console.log('--- Mint Wrapped Tokens ---\n');

  // 1. Fetch VAA from guardian
  console.log(`Fetching VAA for: ${txnHash.slice(0, 20)}...`);
  const vaa = await fetchSolanaVAA(txnHash, GUARDIAN_CONFIG);

  if (vaa.payload.case !== 'contractPayload') {
    throw new Error(`Expected contractPayload, got: ${vaa.payload.case}`);
  }
  const contract = vaa.payload.value;
  const signatures: GuardianSignature[] = vaa.signatures.map((sig, i) => ({
    signature: sig,
    publicKey: vaa.publicKeys[i] || ''
  }));
  const timestamp = vaa.timestamp
    ? Math.floor(Number(vaa.timestamp.seconds.toString()))
    : Math.floor(Date.now() / 1000);

  console.log(`  Amount: ${contract.amount}`);
  console.log(`  Recipient: ${contract.solanaWalletAddress}`);
  console.log(`  Contract: ${contract.zeraContractId}`);
  console.log(`  Name: ${contract.name} (${contract.symbol})`);
  console.log('');

  // 2. Build transaction using real VAA data
  const result = await buildMintWrappedTransaction(
    {
      amount: BigInt(contract.amount.toString()),
      recipient: contract.solanaWalletAddress,
      contractId: contract.zeraContractId,
      decimals: parseInt(contract.decimals, 10),
      name: contract.name,
      symbol: contract.symbol,
      uri: contract.uri,
      txnId: contract.txnHash,
      timestamp,
      signatures,
      expectedHash: vaa.signedHash,
      usdPriceNano: BigInt(contract.usdAmount.toString()),
      liquidityUsdNano: BigInt(contract.liquidityUsd.toString()),
      tier: contract.tier
    },
    PAYER,
    connection
  );

  console.log(`  Wrapped Mint: ${result.accounts.wrappedMint.toBase58()}`);
  console.log(`  Mint Authority: ${result.accounts.mintAuthority.toBase58()}`);

  const signature = await signAndSend(result.transaction, [wallet]);
  console.log(`✓ Confirmed: ${signature}\n`);

  return { ...result, signature };
}

// ============================================================================
// EXAMPLE 6: Burn Wrapped Tokens
// ============================================================================

/**
 * Burn wrapped Kalvora tokens on Solana to bridge back to Kalvora
 * 
 * Assumes the wrapped token already exists (previously minted via lock → submit flow).
 */
async function burnWrappedExample() {
  console.log('--- Burn Wrapped Tokens ---\n');

  // Known Solana mint address for wrapped Kalvora
  const WRAPPED_ZERA_MINT = '9zVugUbpn27zvSfBwkhYAG4yvnxdy58ZFS5Rt89zaP15';

  console.log(`  Wrapped Mint: ${WRAPPED_ZERA_MINT}`);
  console.log(`  Kalvora Recipient: ${ZERA_RECIPIENT}`);

  const result = await buildBurnWrappedTransaction(
    {
      amount: '10000000',
      wrappedMint: WRAPPED_ZERA_MINT,
      zeraRecipient: ZERA_RECIPIENT
    },
    PAYER,
    connection
  );

  console.log(`  User ATA: ${result.accounts.userAta.toBase58()}`);

  const signature = await signAndSend(result.transaction, [wallet]);
  console.log(`✓ Confirmed: ${signature}\n`);

  return { ...result, signature };
}

// ============================================================================
// EXAMPLE 7: Request Token Registration (Permissionless - Step 1)
// ============================================================================

/**
 * Request token registration (permissionless first step)
 * 
 * Anyone can call this to request a token be registered with the bridge.
 * After this, guardians will observe the pending registration and create a VAA.
 * Then registerToken (step 2) can be called with the guardian signatures.
 */
async function requestTokenRegistrationExample() {
  console.log('--- Request Token Registration (Step 1) ---\n');

  const result = await buildRequestTokenRegistrationTransaction(
    {
      mint: 'So11111111111111111111111111111111111111112'
    },
    PAYER,
    connection
  );

  console.log(`  Pending Registration PDA: ${result.accounts.pendingRegistration.toBase58()}`);

  const signature = await signAndSend(result.transaction, [wallet]);
  console.log(`✓ Confirmed: ${signature}`);
  console.log('  → Awaiting guardian approval via registerToken (step 2)\n');

  return { ...result, signature };
}

// ============================================================================
// EXAMPLE 8: Register Token (Guardian-Attested - Step 2)
// ============================================================================

/**
 * Complete token registration with guardian signatures (step 2)
 * 
 * Uses the Verify-then-Execute two-transaction split pattern:
 *   TX1: Ed25519 signature verification + core post_verified_transfer
 *   TX2: Token bridge register_token (fresh blockhash)
 * 
 * Fetches the VAA from guardian and uses the real payload data.
 * @param txnHash - Kalvora transaction hash from the registration request
 */
async function registerTokenExample(txnHash: string) {
  console.log('--- Register Token (Step 2 - After VAA) ---\n');

  // 1. Fetch VAA from guardian
  // The request_token_registration tx was sent to SOLANA, so we query guardian
  // with NETWORK_TYPE.SOLANA (not Kalvora). This is a Solana→Solana flow.
  console.log(`Fetching VAA for: ${txnHash.slice(0, 20)}...`);
  const guardianClient = createClient(GuardianService, GUARDIAN_CONFIG);
  const response = await guardianClient.getPayload(
    create(PayloadRequestSchema, { payloadId: txnHash, networkType: NETWORK_TYPE.SOLANA })
  );
  if (response.payload.case !== 'solanaPayload') {
    throw new Error(`Expected solanaPayload, got: ${response.payload.case}`);
  }
  const vaa: SolanaPayload = response.payload.value;

  // Extract guardian signatures
  const signatures: GuardianSignature[] = vaa.signatures.map((sig, i) => ({
    signature: sig,
    publicKey: vaa.publicKeys[i] || ''
  }));
  const timestamp = vaa.timestamp
    ? Math.floor(Number(vaa.timestamp.seconds.toString()))
    : Math.floor(Date.now() / 1000);

  // Extract payload data from the register_payload case
  // Guardian returns SolanaRegisterPayload with: solanaMintId, priceUsd, liquidityUsd, tier
  if (vaa.payload.case !== 'registerPayload') {
    throw new Error(`Expected registerPayload, got: ${vaa.payload.case}`);
  }

  const regPayload = vaa.payload.value;
  const mint = regPayload.solanaMintId;
  const usdPriceNano = BigInt(regPayload.priceUsd.toString());
  const liquidityUsdNano = BigInt(regPayload.liquidityUsd.toString());
  const tier = regPayload.tier;


  console.log(`  Mint: ${mint}`);
  console.log(`  USD Price (nano): ${usdPriceNano}`);
  console.log(`  Liquidity (nano): ${liquidityUsdNano}`);
  console.log(`  Tier: ${tier}`);
  console.log(`  Timestamp: ${timestamp}`);
  console.log(`  Expected hash: ${vaa.signedHash}`);
  console.log(`  Sigs: ${vaa.signatures.length}, PKs: ${vaa.publicKeys.length}`);
  console.log(`  TxSignature (hex): ${regPayload.txSignature} (${regPayload.txSignature.length} chars → ${regPayload.txSignature.length / 2} bytes, truncated to 32)`);
  console.log('');

  // 2. Build transaction (returns separate verify + register transactions)
  const result = await buildRegisterTokenTransaction(
    {
      mint,
      txnId: regPayload.txSignature,
      timestamp,
      signatures,
      expectedHash: vaa.signedHash,
      usdPriceNano,
      liquidityUsdNano,
      tier
    },
    PAYER,
    connection
  );

  console.log(`  Token Registration PDA: ${result.accounts.tokenRegistration.toBase58()}`);
  console.log(`  Used Marker: ${result.accounts.usedMarker.toBase58()}`);

  // TX1: Ed25519 signature verification + core post_verified_transfer
  console.log('  TX1: Verifying signatures + core post_verified_transfer...');
  const sig1 = await signAndSend(result.verifyTransaction, [wallet], { skipPreflight: true });
  console.log(`  ✅ TX1 confirmed: ${sig1}`);

  // TX2: Token bridge register_token (fresh blockhash)
  const { blockhash: bh2 } = await connection.getLatestBlockhash();
  result.registerTransaction.recentBlockhash = bh2;

  console.log('  TX2: Registering token...');
  const sig2 = await signAndSend(result.registerTransaction, [wallet], { skipPreflight: true });
  console.log(`✓ TX2 confirmed: ${sig2}\n`);

  return { ...result, signature: sig2 };
}


// ============================================================================
// RUN EXAMPLES
// ============================================================================
// Uncomment the example(s) you want to run:

// Individual examples:
// lockSplExample().catch(console.error);
// lockSolExample().catch(console.error); //? Success
// releaseSplExample("ZERA_TXN_HASH").catch(console.error);
// mintWrappedExample("ZERA_TXN_HASH").catch(console.error);
// burnWrappedExample().catch(console.error);
// requestTokenRegistrationExample().catch(console.error);  // Step 1: Request (permissionless) //? Success
registerTokenExample('hGAxUSQNFRcYg3jy8rXPAx2JoTvyKiRnUrnUA12ahT34tmaGQqVsinkCxsGfZPnMbfP44Td8cNg4tRm6QsjUUg7').catch(console.error);              // Step 2: Complete with VAA

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Individual example functions
  lockSplExample,
  lockSolExample,
  releaseSplExample,
  mintWrappedExample,
  burnWrappedExample,
  requestTokenRegistrationExample,
  registerTokenExample,
  
  // Helper
  signAndSend,
  
  // Shared configuration
  connection,
  wallet,
  PAYER,
  GUARDIAN_CONFIG,
  USDC_MINT,
  TEST_RECIPIENT,
  ZERA_RECIPIENT
};
