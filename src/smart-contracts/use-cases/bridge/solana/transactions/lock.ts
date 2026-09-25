/**
 * Lock Transaction Builders
 * 
 * Builds transactions for locking tokens on Solana to bridge to Kalvora.
 */

import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import {
  Connection,
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram
} from '@solana/web3.js';

import {
  concatBytes,
  encodeU64LE
} from '../../../../../shared/utils/byte-utils.js';
import type { LockToken2022Options, LockSplOptions, LockSolOptions } from '../types.js';
import {
  CORE_PROGRAM_ID,
  TOKEN_BRIDGE_PROGRAM_ID,
  generateDiscriminator,
  deriveRouterSignerPDA,
  deriveRouterSigner2022PDA,
  deriveRouterConfigPDA,
  deriveRateLimitStatePDA,
  deriveTokenRegistrationPDA,
  getATA,
  getATAWithProgramId,
  deriveExtensionWhitelist2022PDA,
  assertToken2022Mint,
  encodeBorshString
} from '../utils.js';

// ============================================================================
// LOCK SPL TOKENS (Bridge to Kalvora)
// ============================================================================

export interface LockSplResult {
  instruction: TransactionInstruction;
  transaction: Transaction;
  accounts: {
    userAta: PublicKey;
    vaultAta: PublicKey;
    routerSigner: PublicKey;
    routerConfig: PublicKey;
    rateLimitState: PublicKey;
    tokenRegistration: PublicKey;
  };
}

/**
 * Build a Lock SPL transaction
 * 
 * Locks SPL tokens in the vault to bridge to Kalvora chain.
 */
export async function buildLockSplTransaction(
  options: LockSplOptions,
  payer: PublicKey,
  connection?: Connection
): Promise<LockSplResult> {
  const { amount, zeraAddress, mint } = options;

  const mintPubkey = new PublicKey(mint);
  const [routerSigner] = deriveRouterSignerPDA();
  const [rateLimitState] = deriveRateLimitStatePDA();
  const [tokenRegistration] = deriveTokenRegistrationPDA(mintPubkey);

  // Additional PDAs required by the on-chain program
  const [routerConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('router_cfg')],
    CORE_PROGRAM_ID
  );

  const userAta = getATA(payer, mintPubkey);
  const vaultAta = getATA(routerSigner, mintPubkey);

  const amountBigInt = BigInt(amount);

  const data = concatBytes(
    generateDiscriminator('global:lock_spl'),
    encodeU64LE(amountBigInt),
    encodeBorshString(zeraAddress)
  );

  // Account order must match Rust reference exactly:
  // 1. core_program (readonly)
  // 2. router_cfg (readonly)
  // 3. payer (signer, writable)
  // 4. from_ata (writable)
  // 5. mint (readonly)
  // 6. router_signer (readonly)
  // 7. vault_ata (writable)
  // 8. rate_limit_state (writable)
  // 9. token_registration (writable)
  // 10. token_program (readonly)
  // 11. associated_token_program (readonly)
  // 12. system_program (readonly)
  const instruction = new TransactionInstruction({
    programId: TOKEN_BRIDGE_PROGRAM_ID,
    keys: [
      { pubkey: CORE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: routerConfig, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: mintPubkey, isSigner: false, isWritable: false },
      { pubkey: routerSigner, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: rateLimitState, isSigner: false, isWritable: true },
      { pubkey: tokenRegistration, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = payer;

  if (connection) {
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
  }

  return {
    instruction,
    transaction,
    accounts: { userAta, vaultAta, routerSigner, routerConfig, rateLimitState, tokenRegistration }
  };
}

// ============================================================================
// LOCK TOKEN-2022 TOKENS (Bridge to Kalvora)
// ============================================================================

export interface LockToken2022Result {
  createUserAtaInstruction: TransactionInstruction;
  createVaultAtaInstruction: TransactionInstruction;
  instruction: TransactionInstruction;
  transaction: Transaction;
  accounts: {
    userAta: PublicKey;
    vaultAta: PublicKey;
    routerSigner2022: PublicKey;
    routerConfig: PublicKey;
    rateLimitState: PublicKey;
    tokenRegistration: PublicKey;
    extensionWhitelist: PublicKey;
  };
}

/**
 * Build a Lock Token-2022 transaction
 *
 * Locks Token-2022 tokens in the Token-2022 vault to bridge to Kalvora chain.
 * SPL and native SOL use their existing builders; this path uses the
 * Token-2022 program for ATA derivation and token CPI.
 *
 * Rust reference: stx_proxy_execute_lock_2022
 */
export async function buildLockToken2022Transaction(
  options: LockToken2022Options,
  payer: PublicKey,
  connection?: Connection
): Promise<LockToken2022Result> {
  const { amount, zeraAddress, mint } = options;

  const mintPubkey = new PublicKey(mint);
  await assertToken2022Mint(connection, mintPubkey);

  const [routerSigner2022] = deriveRouterSigner2022PDA();
  const [routerConfig] = deriveRouterConfigPDA();
  const [rateLimitState] = deriveRateLimitStatePDA();
  const [tokenRegistration] = deriveTokenRegistrationPDA(mintPubkey);
  const [extensionWhitelist] = deriveExtensionWhitelist2022PDA();

  const userAta = getATAWithProgramId(payer, mintPubkey, TOKEN_2022_PROGRAM_ID);
  const vaultAta = getATAWithProgramId(routerSigner2022, mintPubkey, TOKEN_2022_PROGRAM_ID);

  const createUserAtaInstruction = createAssociatedTokenAccountIdempotentInstruction(
    payer,
    userAta,
    payer,
    mintPubkey,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const createVaultAtaInstruction = createAssociatedTokenAccountIdempotentInstruction(
    payer,
    vaultAta,
    routerSigner2022,
    mintPubkey,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const amountBigInt = BigInt(amount);

  const data = concatBytes(
    generateDiscriminator('global:lock_2022'),
    encodeU64LE(amountBigInt),
    encodeBorshString(zeraAddress)
  );

  // Account order must match Rust reference exactly:
  // 1.  core_program (readonly)
  // 2.  router_cfg (readonly)
  // 3.  payer (signer, writable)
  // 4.  from_ata (writable)
  // 5.  mint (readonly)
  // 6.  router_signer_2022 (readonly)
  // 7.  vault_ata (writable)
  // 8.  rate_limit_state (writable)
  // 9.  token_registration (writable)
  // 10. extension_whitelist (readonly)
  // 11. token_program (Token-2022, readonly)
  // 12. associated_token_program (readonly)
  // 13. system_program (readonly)
  const instruction = new TransactionInstruction({
    programId: TOKEN_BRIDGE_PROGRAM_ID,
    keys: [
      { pubkey: CORE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: routerConfig, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: mintPubkey, isSigner: false, isWritable: false },
      { pubkey: routerSigner2022, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: rateLimitState, isSigner: false, isWritable: true },
      { pubkey: tokenRegistration, isSigner: false, isWritable: true },
      { pubkey: extensionWhitelist, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });

  const transaction = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    createUserAtaInstruction,
    createVaultAtaInstruction,
    instruction
  );
  transaction.feePayer = payer;

  if (connection) {
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
  }

  return {
    createUserAtaInstruction,
    createVaultAtaInstruction,
    instruction,
    transaction,
    accounts: {
      userAta,
      vaultAta,
      routerSigner2022,
      routerConfig,
      rateLimitState,
      tokenRegistration,
      extensionWhitelist
    }
  };
}

// ============================================================================
// LOCK SOL (Native, Bridge to Kalvora)
// ============================================================================

export interface LockSolResult {
  instruction: TransactionInstruction;
  transaction: Transaction;
  accounts: {
    payerWsolAta: PublicKey;
    vaultAta: PublicKey;
    routerSigner: PublicKey;
    routerConfig: PublicKey;
    rateLimitState: PublicKey;
    tokenPriceRegistry: PublicKey;
  };
}

/** wSOL mint address */
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

/**
 * Build a Lock SOL transaction
 * 
 * Locks native SOL by wrapping to wSOL and depositing to the vault ATA.
 * Uses the same ATA-based pattern as lock_spl, with the wSOL mint hardcoded.
 */
export async function buildLockSolTransaction(
  options: LockSolOptions,
  payer: PublicKey,
  connection?: Connection
): Promise<LockSolResult> {
  const { amount, zeraAddress } = options;

  const [routerSigner] = deriveRouterSignerPDA();
  const [rateLimitState] = deriveRateLimitStatePDA();
  
  // Additional PDAs required by the on-chain program
  const [routerConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('router_cfg')],
    CORE_PROGRAM_ID
  );
  const [tokenPriceRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_price_registry')],
    TOKEN_BRIDGE_PROGRAM_ID
  );

  // wSOL ATAs
  const payerWsolAta = getATA(payer, WSOL_MINT);
  const vaultAta = getATA(routerSigner, WSOL_MINT);

  const amountBigInt = BigInt(amount);

  const data = concatBytes(
    generateDiscriminator('global:lock_sol'),
    encodeU64LE(amountBigInt),
    encodeBorshString(zeraAddress)
  );

  // Account order must match Rust reference exactly:
  // 1.  core_program (readonly)
  // 2.  router_cfg (readonly)
  // 3.  payer (signer, writable)
  // 4.  payer_wsol_ata (writable)
  // 5.  vault_ata (writable)
  // 6.  router_signer (readonly)
  // 7.  wsol_mint (readonly)
  // 8.  rate_limit_state (writable)
  // 9.  token_price_registry (readonly)
  // 10. token_program (readonly)
  // 11. associated_token_program (readonly)
  // 12. system_program (readonly)
  const instruction = new TransactionInstruction({
    programId: TOKEN_BRIDGE_PROGRAM_ID,
    keys: [
      { pubkey: CORE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: routerConfig, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: payerWsolAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: routerSigner, isSigner: false, isWritable: false },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: rateLimitState, isSigner: false, isWritable: true },
      { pubkey: tokenPriceRegistry, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = payer;

  if (connection) {
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
  }

  return {
    instruction,
    transaction,
    accounts: { payerWsolAta, vaultAta, routerSigner, routerConfig, rateLimitState, tokenPriceRegistry }
  };
}
