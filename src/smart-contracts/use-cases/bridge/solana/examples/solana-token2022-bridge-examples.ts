/**
 * Solana Token-2022 Bridge Examples
 *
 * Demonstrates the Token-2022-specific paths. Classic SPL and native SOL keep
 * using their existing builders.
 *
 * Run manually:
 *   SOLANA_PRIVATE_KEY=<base58-secret> TOKEN_2022_MINT=<mint> \
 *     npx tsx src/smart-contracts/use-cases/bridge/solana/examples/solana-token2022-bridge-examples.ts
 */

import { Connection, Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { TEST_WALLET_ADDRESSES } from '../../../../../test-utils/index.js';
import {
  buildLockToken2022Transaction,
  buildReleaseToken2022Transaction,
  buildRequestTokenRegistrationTransaction,
  buildRegisterTokenTransaction,
  TOKEN_2022_PROGRAM_ID
} from '../index.js';
import type { GuardianSignature } from '../types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

/** Set TOKEN_2022_MINT to a real Token-2022 mint on the selected cluster. */
const TOKEN_2022_MINT = process.env.TOKEN_2022_MINT;
const ZERA_RECIPIENT = TEST_WALLET_ADDRESSES.alice;

// ============================================================================
// HELPERS
// ============================================================================

function loadWallet(): Keypair {
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('Set SOLANA_PRIVATE_KEY to a base58-encoded Solana private key.');
  }

  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

async function signAndSend(transaction: Transaction, wallet: Keypair): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;
  transaction.sign(wallet);

  const signature = await connection.sendRawTransaction(transaction.serialize());

  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight
  }, 'confirmed');

  return signature;
}

function resolveToken2022Mint(mint = TOKEN_2022_MINT): string {
  if (!mint) {
    throw new Error('Set TOKEN_2022_MINT or pass a Token-2022 mint address.');
  }

  return mint;
}

// ============================================================================
// REQUEST TOKEN-2022 REGISTRATION
// ============================================================================

export async function requestToken2022RegistrationExample(mint = TOKEN_2022_MINT) {
  const wallet = loadWallet();
  const tokenMint = resolveToken2022Mint(mint);
  const result = await buildRequestTokenRegistrationTransaction(
    {
      mint: tokenMint,
      tokenProgramId: TOKEN_2022_PROGRAM_ID.toBase58()
    },
    wallet.publicKey,
    connection
  );

  console.log(`Pending registration: ${result.accounts.pendingRegistration.toBase58()}`);
  console.log(`Extension whitelist: ${result.accounts.extensionWhitelist?.toBase58()}`);

  const signature = await signAndSend(result.transaction, wallet);
  console.log(`Request confirmed: ${signature}`);
  return signature;
}

// ============================================================================
// REGISTER TOKEN-2022 WITH GUARDIAN VAA
// ============================================================================

export async function registerToken2022Example(input: {
  mint: string;
  txnId: string;
  timestamp: number;
  signatures: GuardianSignature[];
  expectedHash: string;
  usdPriceNano: bigint | string;
  liquidityUsdNano: bigint | string;
  tier: number;
}) {
  const wallet = loadWallet();
  const result = await buildRegisterTokenTransaction(
    {
      ...input,
      tokenProgramId: TOKEN_2022_PROGRAM_ID.toBase58()
    },
    wallet.publicKey,
    connection
  );

  console.log(`Token registration: ${result.accounts.tokenRegistration.toBase58()}`);
  console.log(`Extension whitelist: ${result.accounts.extensionWhitelist?.toBase58()}`);

  const verifySig = await signAndSend(result.verifyTransaction, wallet);
  console.log(`Verify confirmed: ${verifySig}`);

  const registerSig = await signAndSend(result.registerTransaction, wallet);
  console.log(`Register confirmed: ${registerSig}`);
  return registerSig;
}

// ============================================================================
// LOCK TOKEN-2022 TO Kalvora
// ============================================================================

export async function lockToken2022Example(mint = TOKEN_2022_MINT) {
  const wallet = loadWallet();
  const tokenMint = resolveToken2022Mint(mint);
  const result = await buildLockToken2022Transaction(
    {
      amount: '1000000',
      zeraAddress: ZERA_RECIPIENT,
      mint: tokenMint
    },
    wallet.publicKey,
    connection
  );

  console.log(`User Token-2022 ATA: ${result.accounts.userAta.toBase58()}`);
  console.log(`Vault Token-2022 ATA: ${result.accounts.vaultAta.toBase58()}`);
  console.log(`Router signer 2022: ${result.accounts.routerSigner2022.toBase58()}`);

  const signature = await signAndSend(result.transaction, wallet);
  console.log(`Lock confirmed: ${signature}`);
  return signature;
}

// ============================================================================
// RELEASE TOKEN-2022 WITH GUARDIAN VAA
// ============================================================================

export async function releaseToken2022Example(input: {
  amount: bigint | string;
  recipient: string;
  mint: string;
  txnId: string;
  timestamp: number;
  signatures: GuardianSignature[];
  expectedHash: string;
  usdPriceNano: bigint | string;
  liquidityUsdNano: bigint | string;
  tier: number;
}) {
  const wallet = loadWallet();
  const result = await buildReleaseToken2022Transaction(input, wallet.publicKey, connection);

  console.log(`Recipient Token-2022 ATA: ${result.accounts.recipientAta.toBase58()}`);
  console.log(`Vault Token-2022 ATA: ${result.accounts.vaultAta.toBase58()}`);

  const verifySig = await signAndSend(result.verifyTransaction, wallet);
  console.log(`Verify confirmed: ${verifySig}`);

  const releaseSig = await signAndSend(result.releaseTransaction, wallet);
  console.log(`Release confirmed: ${releaseSig}`);
  return releaseSig;
}

