/**
 * Release Transaction Builders
 * 
 * Builds transactions for releasing locked tokens from Solana vaults.
 * Used when bridging from Kalvora → Solana.
 */

import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY
} from '@solana/web3.js';

import {
  hexToBytes,
  concatBytes,
  encodeU64LE,
  encodeU64BE,
  encodeU32LE
} from '../../../../../shared/utils/byte-utils.js';
import type { ReleaseToken2022Options, ReleaseSplOptions, ReleaseSolOptions } from '../types.js';
import {
  CORE_PROGRAM_ID,
  TOKEN_BRIDGE_PROGRAM_ID,
  generateDiscriminator,
  deriveRouterSignerPDA,
  deriveRouterSigner2022PDA,
  deriveRouterConfigPDA,
  deriveVerifiedTransferPDA,
  deriveReleasedTransferPDA,
  deriveVaultPDA,
  deriveRateLimitStatePDA,
  deriveTokenRegistrationPDA,
  getATA,
  getATAWithProgramId,
  assertToken2022Mint
} from '../utils.js';

import {
  DEFAULT_VAA_VERSION,
  DEFAULT_VAA_EXPIRY,
  DEFAULT_EVENT_INDEX,
  ACTION_RELEASE_SOL,
  ACTION_RELEASE_SPL,
  ACTION_RELEASE_2022,
  createEd25519VerifyInstruction,
  parseSignatures
} from './helpers.js';

// ============================================================================
// RELEASE SPL TOKENS
// ============================================================================

export interface ReleaseSplResult {
  /** Core program verification instruction */
  coreInstruction: TransactionInstruction;
  /** Token program release instruction */
  tokenInstruction: TransactionInstruction;
  /** Ed25519 signature verification instructions */
  signatureInstructions: TransactionInstruction[];
  /** Combined transaction (backward compatibility) */
  transaction: Transaction;
  /** TX1: compute budget + ed25519 verify + core post_verified_transfer */
  verifyTransaction: Transaction;
  /** TX2: release_spl only */
  releaseTransaction: Transaction;
  /** Accounts that will be created/modified */
  accounts: {
    recipientAta: PublicKey;
    vaultAta: PublicKey;
    usedMarker: PublicKey;
    redeemedMarker: PublicKey;
  };
}

/**
 * Build a complete Release SPL transaction
 * 
 * Releases locked SPL tokens from the vault to the recipient.
 * This is called after a Kalvora → Solana bridge transfer is verified.
 * 
 * @param options - Release options including amount, recipient, signatures
 * @param payer - The payer keypair (signs and pays for transaction)
 * @param connection - Solana connection (for blockhash)
 * @returns Complete transaction ready to sign and send
 */
export async function buildReleaseSplTransaction(
  options: ReleaseSplOptions,
  payer: PublicKey,
  connection?: Connection
): Promise<ReleaseSplResult> {
  const {
    amount,
    recipient,
    mint,
    txnId,
    timestamp,
    signatures,
    expectedHash,
    usdPriceNano,
    liquidityUsdNano,
    tier
  } = options;

  const version = DEFAULT_VAA_VERSION;
  const expiry = DEFAULT_VAA_EXPIRY;
  const eventIndex = DEFAULT_EVENT_INDEX;

  // Parse addresses
  const recipientPubkey = new PublicKey(recipient);
  const mintPubkey = new PublicKey(mint);
  const txnHash = hexToBytes(txnId);
  const expectedHashBytes = hexToBytes(expectedHash);

  // Derive PDAs
  const [routerSigner] = deriveRouterSignerPDA();
  const [routerCfg] = deriveRouterConfigPDA();
  const [usedMarker] = deriveVerifiedTransferPDA(expectedHashBytes);
  const [redeemedMarker] = deriveReleasedTransferPDA(expectedHashBytes);
  const [rateLimitState] = deriveRateLimitStatePDA();
  const [tokenRegistration] = deriveTokenRegistrationPDA(mintPubkey);

  // ATAs
  const recipientAta = getATA(recipientPubkey, mintPubkey);
  const vaultAta = getATA(routerSigner, mintPubkey);

  // Parse amounts
  const amountBigInt = BigInt(amount);
  const usdPriceNanoBigInt = BigInt(usdPriceNano);
  const liquidityUsdNanoBigInt = BigInt(liquidityUsdNano);

  // Parse signatures
  const { sigs, pks } = parseSignatures(signatures);

  // Create Ed25519 verification instructions
  const signatureInstructions: TransactionInstruction[] = [];
  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i];
    const pk = pks[i];
    if (sig && pk) {
      signatureInstructions.push(
        createEd25519VerifyInstruction(expectedHashBytes, sig, pk)
      );
    }
  }

  // Build core post_verified_transfer instruction
  const payload = concatBytes(
    encodeU64BE(amountBigInt),
    recipientPubkey.toBytes(),
    mintPubkey.toBytes(),
    encodeU64BE(usdPriceNanoBigInt),
    encodeU64BE(liquidityUsdNanoBigInt),
    new Uint8Array([tier])
  );

  const coreData = concatBytes(
    generateDiscriminator('global:post_verified_transfer'),
    new Uint8Array([version]),
    new Uint8Array([ACTION_RELEASE_SPL]),
    encodeU64LE(BigInt(timestamp)),
    encodeU64LE(BigInt(expiry)),
    txnHash,
    encodeU32LE(eventIndex),
    encodeU32LE(payload.length),
    payload,
    new Uint8Array([(payload.length >> 0) & 0xff, (payload.length >> 8) & 0xff])
  );

  const coreInstruction = new TransactionInstruction({
    programId: CORE_PROGRAM_ID,
    keys: [
      { pubkey: routerCfg, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: usedMarker, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_BRIDGE_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(coreData)
  });

  // Build token program release_spl instruction
  const tokenData = concatBytes(
    generateDiscriminator('global:release_spl'),
    new Uint8Array([version]),
    encodeU64LE(BigInt(timestamp)),
    encodeU64LE(BigInt(expiry)),
    txnHash,
    encodeU32LE(eventIndex),
    encodeU64LE(amountBigInt),
    encodeU64LE(usdPriceNanoBigInt),
    encodeU64LE(liquidityUsdNanoBigInt),
    new Uint8Array([tier])
  );

  const tokenInstruction = new TransactionInstruction({
    programId: TOKEN_BRIDGE_PROGRAM_ID,
    keys: [
      { pubkey: CORE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: routerCfg, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: mintPubkey, isSigner: false, isWritable: false },
      { pubkey: routerSigner, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: recipientPubkey, isSigner: false, isWritable: false },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: usedMarker, isSigner: false, isWritable: false },
      { pubkey: redeemedMarker, isSigner: false, isWritable: true },
      { pubkey: rateLimitState, isSigner: false, isWritable: true },
      { pubkey: tokenRegistration, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_BRIDGE_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(tokenData)
  });

  // Build complete transaction (backward compatibility - single TX)
  const transaction = new Transaction();
  if (signatureInstructions.length > 0) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
    );
  }
  // Add signature verification instructions first
  for (const ix of signatureInstructions) {
    transaction.add(ix);
  }
  // Add core and token instructions
  transaction.add(coreInstruction);
  transaction.add(tokenInstruction);

  // TX1: compute budget + ed25519 verify + core post_verified_transfer
  const verifyTransaction = new Transaction();
  if (signatureInstructions.length > 0) {
    verifyTransaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
    );
  }
  for (const ix of signatureInstructions) {
    verifyTransaction.add(ix);
  }
  verifyTransaction.add(coreInstruction);
  verifyTransaction.feePayer = payer;

  // TX2: release_spl only
  const releaseTransaction = new Transaction();
  releaseTransaction.add(tokenInstruction);
  releaseTransaction.feePayer = payer;

  // Set feePayer
  transaction.feePayer = payer;

  // Get recent blockhash if connection provided
  if (connection) {
    const { blockhash } = await connection.getLatestBlockhash();
    verifyTransaction.recentBlockhash = blockhash;
    releaseTransaction.recentBlockhash = blockhash;
    transaction.recentBlockhash = blockhash;
  }

  return {
    coreInstruction,
    tokenInstruction,
    signatureInstructions,
    transaction,
    verifyTransaction,
    releaseTransaction,
    accounts: {
      recipientAta,
      vaultAta,
      usedMarker,
      redeemedMarker
    }
  };
}

// ============================================================================
// RELEASE TOKEN-2022 TOKENS
// ============================================================================

export interface ReleaseToken2022Result {
  /** Core program verification instruction */
  coreInstruction: TransactionInstruction;
  /** Token bridge release_2022 instruction */
  tokenInstruction: TransactionInstruction;
  /** Ed25519 signature verification instructions */
  signatureInstructions: TransactionInstruction[];
  /** Combined transaction (backward compatibility) */
  transaction: Transaction;
  /** TX1: compute budget + ed25519 verify + core post_verified_transfer */
  verifyTransaction: Transaction;
  /** TX2: compute budget + release_2022 */
  releaseTransaction: Transaction;
  /** Accounts that will be created/modified */
  accounts: {
    recipientAta: PublicKey;
    vaultAta: PublicKey;
    routerSigner2022: PublicKey;
    usedMarker: PublicKey;
    redeemedMarker: PublicKey;
  };
}

/**
 * Build a complete Release Token-2022 transaction
 *
 * Releases locked Token-2022 tokens from the Token-2022 vault to the recipient.
 * This follows the same verify-then-execute split as the SPL release path, but
 * uses the Token-2022 program, Token-2022 ATAs, and the release_2022 action.
 *
 * Rust reference: stx_proxy_execute_release_2022
 */
export async function buildReleaseToken2022Transaction(
  options: ReleaseToken2022Options,
  payer: PublicKey,
  connection?: Connection
): Promise<ReleaseToken2022Result> {
  const {
    amount,
    recipient,
    mint,
    txnId,
    timestamp,
    signatures,
    expectedHash,
    usdPriceNano,
    liquidityUsdNano,
    tier
  } = options;

  const version = DEFAULT_VAA_VERSION;
  const expiry = DEFAULT_VAA_EXPIRY;
  const eventIndex = DEFAULT_EVENT_INDEX;

  const recipientPubkey = new PublicKey(recipient);
  const mintPubkey = new PublicKey(mint);
  await assertToken2022Mint(connection, mintPubkey);

  const txnHash = hexToBytes(txnId).slice(0, 32);
  const expectedHashBytes = hexToBytes(expectedHash);

  // Derive PDAs
  const [routerSigner2022] = deriveRouterSigner2022PDA();
  const [routerCfg] = deriveRouterConfigPDA();
  const [usedMarker] = deriveVerifiedTransferPDA(expectedHashBytes);
  const [redeemedMarker] = deriveReleasedTransferPDA(expectedHashBytes);
  const [rateLimitState] = deriveRateLimitStatePDA();
  const [tokenRegistration] = deriveTokenRegistrationPDA(mintPubkey);

  // Token-2022 ATAs
  const recipientAta = getATAWithProgramId(recipientPubkey, mintPubkey, TOKEN_2022_PROGRAM_ID);
  const vaultAta = getATAWithProgramId(routerSigner2022, mintPubkey, TOKEN_2022_PROGRAM_ID);

  const amountBigInt = BigInt(amount);
  const usdPriceNanoBigInt = BigInt(usdPriceNano);
  const liquidityUsdNanoBigInt = BigInt(liquidityUsdNano);

  const { sigs, pks } = parseSignatures(signatures);

  const signatureInstructions: TransactionInstruction[] = [];
  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i];
    const pk = pks[i];
    if (sig && pk) {
      signatureInstructions.push(
        createEd25519VerifyInstruction(expectedHashBytes, sig, pk)
      );
    }
  }

  const payload = concatBytes(
    encodeU64BE(amountBigInt),
    recipientPubkey.toBytes(),
    mintPubkey.toBytes(),
    encodeU64BE(usdPriceNanoBigInt),
    encodeU64BE(liquidityUsdNanoBigInt),
    new Uint8Array([tier])
  );

  const coreData = concatBytes(
    generateDiscriminator('global:post_verified_transfer'),
    new Uint8Array([version]),
    new Uint8Array([ACTION_RELEASE_2022]),
    encodeU64LE(BigInt(timestamp)),
    encodeU64LE(BigInt(expiry)),
    txnHash,
    encodeU32LE(eventIndex),
    encodeU32LE(payload.length),
    payload,
    new Uint8Array([(payload.length >> 0) & 0xff, (payload.length >> 8) & 0xff])
  );

  const coreInstruction = new TransactionInstruction({
    programId: CORE_PROGRAM_ID,
    keys: [
      { pubkey: routerCfg, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: usedMarker, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_BRIDGE_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(coreData)
  });

  const tokenData = concatBytes(
    generateDiscriminator('global:release_2022'),
    new Uint8Array([version]),
    encodeU64LE(BigInt(timestamp)),
    encodeU64LE(BigInt(expiry)),
    txnHash,
    encodeU32LE(eventIndex),
    encodeU64LE(amountBigInt),
    encodeU64LE(usdPriceNanoBigInt),
    encodeU64LE(liquidityUsdNanoBigInt),
    new Uint8Array([tier])
  );

  // Account order must match Rust reference exactly:
  // 1.  core_program (readonly)
  // 2.  router_cfg (readonly)
  // 3.  payer (signer, writable)
  // 4.  mint (readonly)
  // 5.  router_signer_2022 (readonly)
  // 6.  vault_ata (writable)
  // 7.  recipient (readonly)
  // 8.  recipient_ata (writable)
  // 9.  associated_token_program (readonly)
  // 10. used_marker (readonly)
  // 11. redeemed_marker (writable)
  // 12. rate_limit_state (writable)
  // 13. token_registration (writable)
  // 14. token_program (Token-2022, readonly)
  // 15. system_program (readonly)
  // 16. target_program (readonly)
  const tokenInstruction = new TransactionInstruction({
    programId: TOKEN_BRIDGE_PROGRAM_ID,
    keys: [
      { pubkey: CORE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: routerCfg, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: mintPubkey, isSigner: false, isWritable: false },
      { pubkey: routerSigner2022, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: recipientPubkey, isSigner: false, isWritable: false },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: usedMarker, isSigner: false, isWritable: false },
      { pubkey: redeemedMarker, isSigner: false, isWritable: true },
      { pubkey: rateLimitState, isSigner: false, isWritable: true },
      { pubkey: tokenRegistration, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_BRIDGE_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(tokenData)
  });

  const verifyTransaction = new Transaction();
  if (signatureInstructions.length > 0) {
    verifyTransaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
    );
  }
  for (const ix of signatureInstructions) {
    verifyTransaction.add(ix);
  }
  verifyTransaction.add(coreInstruction);
  verifyTransaction.feePayer = payer;

  const releaseTransaction = new Transaction();
  releaseTransaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    tokenInstruction
  );
  releaseTransaction.feePayer = payer;

  const transaction = new Transaction();
  if (signatureInstructions.length > 0) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
    );
  }
  for (const ix of signatureInstructions) {
    transaction.add(ix);
  }
  transaction.add(coreInstruction, tokenInstruction);
  transaction.feePayer = payer;

  if (connection) {
    const { blockhash } = await connection.getLatestBlockhash();
    verifyTransaction.recentBlockhash = blockhash;
    releaseTransaction.recentBlockhash = blockhash;
    transaction.recentBlockhash = blockhash;
  }

  return {
    coreInstruction,
    tokenInstruction,
    signatureInstructions,
    transaction,
    verifyTransaction,
    releaseTransaction,
    accounts: {
      recipientAta,
      vaultAta,
      routerSigner2022,
      usedMarker,
      redeemedMarker
    }
  };
}

// ============================================================================
// RELEASE SOL (NATIVE)
// ============================================================================

export interface ReleaseSolResult {
  coreInstruction: TransactionInstruction;
  tokenInstruction: TransactionInstruction;
  signatureInstructions: TransactionInstruction[];
  /** Combined transaction (all instructions) - for backward compatibility */
  transaction: Transaction;
  /** TX1: compute budget + ed25519 verify + core post_verified_transfer */
  verifyTransaction: Transaction;
  /** TX2: release_sol only */
  releaseTransaction: Transaction;
  accounts: {
    vault: PublicKey;
    usedMarker: PublicKey;
    redeemedMarker: PublicKey;
  };
}

/**
 * Build a complete Release SOL transaction
 * 
 * Releases locked native SOL from the vault to the recipient.
 */
export async function buildReleaseSolTransaction(
  options: ReleaseSolOptions,
  payer: PublicKey,
  connection?: Connection
): Promise<ReleaseSolResult> {
  const {
    amount,
    recipient,
    txnId,
    timestamp,
    signatures,
    expectedHash,
    usdAmount
  } = options;

  const version = DEFAULT_VAA_VERSION;
  const expiry = DEFAULT_VAA_EXPIRY;
  const eventIndex = DEFAULT_EVENT_INDEX;

  const recipientPubkey = new PublicKey(recipient);
  const txnHash = hexToBytes(txnId);
  const expectedHashBytes = hexToBytes(expectedHash);

  // Derive PDAs
  const [vault] = deriveVaultPDA();
  const [routerCfg] = deriveRouterConfigPDA();
  const [usedMarker] = deriveVerifiedTransferPDA(expectedHashBytes);
  const [redeemedMarker] = deriveReleasedTransferPDA(expectedHashBytes);
  const [rateLimitState] = deriveRateLimitStatePDA();

  const amountBigInt = BigInt(amount);
  const usdAmountBigInt = BigInt(usdAmount);

  const { sigs, pks } = parseSignatures(signatures);

  // Signature verification instructions
  const signatureInstructions: TransactionInstruction[] = [];
  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i];
    const pk = pks[i];
    if (sig && pk) {
      signatureInstructions.push(
        createEd25519VerifyInstruction(expectedHashBytes, sig, pk)
      );
    }
  }

  // Payload for core instruction
  const payload = concatBytes(
    encodeU64BE(amountBigInt),
    recipientPubkey.toBytes(),
    encodeU64BE(usdAmountBigInt)
  );

  // Core post_verified_transfer
  const coreData = concatBytes(
    generateDiscriminator('global:post_verified_transfer'),
    new Uint8Array([version]),
    new Uint8Array([ACTION_RELEASE_SOL]),
    encodeU64LE(BigInt(timestamp)),
    encodeU64LE(BigInt(expiry)),
    txnHash,
    encodeU32LE(eventIndex),
    encodeU32LE(payload.length),
    payload,
    new Uint8Array([(payload.length >> 0) & 0xff, (payload.length >> 8) & 0xff])
  );

  const coreInstruction = new TransactionInstruction({
    programId: CORE_PROGRAM_ID,
    keys: [
      { pubkey: routerCfg, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: usedMarker, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_BRIDGE_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(coreData)
  });

  // Token program release_sol
  const tokenData = concatBytes(
    generateDiscriminator('global:release_sol'),
    new Uint8Array([version]),
    encodeU64LE(BigInt(timestamp)),
    encodeU64LE(BigInt(expiry)),
    txnHash,
    encodeU32LE(eventIndex),
    encodeU64LE(amountBigInt),
    recipientPubkey.toBytes(),
    encodeU64LE(usdAmountBigInt)
  );

  // Derive token_price_registry PDA
  const [tokenPriceRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_price_registry')],
    TOKEN_BRIDGE_PROGRAM_ID
  );

  // Account order must match Rust reference exactly:
  // 1. core_program (readonly)
  // 2. router_cfg (readonly)
  // 3. payer (signer, writable)
  // 4. vault (writable)
  // 5. used_marker (readonly)
  // 6. redeemed_marker (writable)
  // 7. recipient (writable)
  // 8. rate_limit_state (writable)
  // 9. token_price_registry (writable)
  // 10. system_program (readonly)
  // 11. target_program (readonly)
  const tokenInstruction = new TransactionInstruction({
    programId: TOKEN_BRIDGE_PROGRAM_ID,
    keys: [
      { pubkey: CORE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: routerCfg, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: usedMarker, isSigner: false, isWritable: false },
      { pubkey: redeemedMarker, isSigner: false, isWritable: true },
      { pubkey: recipientPubkey, isSigner: false, isWritable: true },
      { pubkey: rateLimitState, isSigner: false, isWritable: true },
      { pubkey: tokenPriceRegistry, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_BRIDGE_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(tokenData)
  });

  // TX1: compute budget + ed25519 verify + core post_verified_transfer
  const verifyTransaction = new Transaction();
  if (signatureInstructions.length > 0) {
    verifyTransaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
    );
  }
  for (const ix of signatureInstructions) {
    verifyTransaction.add(ix);
  }
  verifyTransaction.add(coreInstruction);
  verifyTransaction.feePayer = payer;

  // TX2: release_sol only
  const releaseTransaction = new Transaction();
  releaseTransaction.add(tokenInstruction);
  releaseTransaction.feePayer = payer;

  // Combined transaction (backward compatibility)
  const transaction = new Transaction();
  if (signatureInstructions.length > 0) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
    );
  }
  for (const ix of signatureInstructions) {
    transaction.add(ix);
  }
  transaction.add(coreInstruction);
  transaction.add(tokenInstruction);
  transaction.feePayer = payer;

  if (connection) {
    const { blockhash } = await connection.getLatestBlockhash();
    verifyTransaction.recentBlockhash = blockhash;
    releaseTransaction.recentBlockhash = blockhash;
    transaction.recentBlockhash = blockhash;
  }

  return {
    coreInstruction,
    tokenInstruction,
    signatureInstructions,
    transaction,
    verifyTransaction,
    releaseTransaction,
    accounts: { vault, usedMarker, redeemedMarker }
  };
}
