/**
 * Mint Transaction Builders
 * 
 * Builds transactions for minting wrapped Kalvora tokens on Solana.
 */

import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  ComputeBudgetProgram
} from '@solana/web3.js';

import {
  hexToBytes,
  concatBytes,
  encodeU64LE,
  encodeU64BE,
  encodeU32LE,
  encodeU16BE
} from '../../../../../shared/utils/byte-utils.js';
import type { MintWrappedOptions, MintWrappedExistingOptions } from '../types.js';
import {
  CORE_PROGRAM_ID,
  TOKEN_BRIDGE_PROGRAM_ID,
  METADATA_PROGRAM_ID,
  generateDiscriminator,
  deriveRouterConfigPDA,
  deriveVerifiedTransferPDA,
  deriveReleasedTransferPDA,
  deriveRateLimitStatePDA,
  deriveTokenRegistrationPDA,
  deriveWrappedMintPDA,
  deriveWrappedMintAuthorityPDA,
  deriveMetadataPDA,
  getATA
} from '../utils.js';

import {
  DEFAULT_VAA_VERSION,
  DEFAULT_VAA_EXPIRY,
  DEFAULT_EVENT_INDEX,
  ACTION_MINT_WRAPPED,
  ACTION_MINT_WRAPPED_EXISTING,
  createEd25519VerifyInstruction,
  parseSignatures
} from './helpers.js';

// ============================================================================
// MINT WRAPPED TOKENS (First-time initialization)
// ============================================================================

export interface MintWrappedResult {
  coreInstruction: TransactionInstruction;
  tokenInstruction: TransactionInstruction;
  signatureInstructions: TransactionInstruction[];
  /** Combined transaction (all instructions) - for backward compatibility */
  transaction: Transaction;
  /** TX1: compute budget + ed25519 verify + core post_verified_transfer */
  verifyTransaction: Transaction;
  /** TX2: compute budget + token bridge mint_wrapped */
  mintTransaction: Transaction;
  accounts: {
    wrappedMint: PublicKey;
    mintAuthority: PublicKey;
    recipientAta: PublicKey;
    metadata: PublicKey;
    bridgeInfo: PublicKey;
    usedMarker: PublicKey;
    redeemedMarker: PublicKey;
  };
}

/**
 * Build a Mint Wrapped transaction (first-time initialization)
 * 
 * Mints wrapped Kalvora tokens on Solana, creating the mint and metadata.
 * This is used when a Kalvora token is bridged to Solana for the first time.
 */
export async function buildMintWrappedTransaction(
  options: MintWrappedOptions,
  payer: PublicKey,
  connection?: Connection
): Promise<MintWrappedResult> {
  const {
    amount,
    recipient,
    contractId,
    decimals,
    name,
    symbol,
    uri,
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
  const txnHash = hexToBytes(txnId);
  const expectedHashBytes = hexToBytes(expectedHash);
  const contractIdBytes = new TextEncoder().encode(contractId);
  const nameBytes = new TextEncoder().encode(name);
  const symbolBytes = new TextEncoder().encode(symbol);
  const uriBytes = new TextEncoder().encode(uri);

  // Derive PDAs
  const [routerCfg] = deriveRouterConfigPDA();
  const [usedMarker] = deriveVerifiedTransferPDA(expectedHashBytes);
  const [redeemedMarker] = deriveReleasedTransferPDA(expectedHashBytes);
  const [wrappedMint] = deriveWrappedMintPDA(contractId);
  const [mintAuthority] = deriveWrappedMintAuthorityPDA(wrappedMint);
  const [metadata] = deriveMetadataPDA(wrappedMint);
  const [rateLimitState] = deriveRateLimitStatePDA();
  const [tokenRegistration] = deriveTokenRegistrationPDA(wrappedMint);

  // Bridge info PDA
  const [bridgeInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from('bridge_info'), wrappedMint.toBuffer()],
    TOKEN_BRIDGE_PROGRAM_ID
  );

  // Recipient ATA
  const recipientAta = getATA(recipientPubkey, wrappedMint);

  const amountBigInt = BigInt(amount);
  const usdPriceNanoBigInt = BigInt(usdPriceNano);
  const liquidityUsdNanoBigInt = BigInt(liquidityUsdNano);

  const { sigs, pks } = parseSignatures(signatures);

  // Ed25519 verification instructions
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

  // Build payload for core instruction
  const payload = concatBytes(
    encodeU64BE(amountBigInt),
    recipientPubkey.toBytes(),
    encodeU16BE(contractIdBytes.length),
    contractIdBytes,
    new Uint8Array([decimals]),
    new Uint8Array([nameBytes.length]),
    nameBytes,
    new Uint8Array([symbolBytes.length]),
    symbolBytes,
    encodeU16BE(uriBytes.length),
    uriBytes,
    encodeU64BE(usdPriceNanoBigInt),
    encodeU64BE(liquidityUsdNanoBigInt),
    new Uint8Array([tier])
  );

  const action = ACTION_MINT_WRAPPED;

  // Core post_verified_transfer instruction
  const coreData = concatBytes(
    generateDiscriminator('global:post_verified_transfer'),
    new Uint8Array([version]),
    new Uint8Array([action]),
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

  // Token program mint_wrapped instruction
  const tokenData = concatBytes(
    generateDiscriminator('global:mint_wrapped'),
    new Uint8Array([version]),
    encodeU64LE(BigInt(timestamp)),
    encodeU64LE(BigInt(expiry)),
    txnHash,
    encodeU32LE(eventIndex),
    encodeU64LE(amountBigInt),
    encodeU32LE(contractIdBytes.length),
    contractIdBytes,
    new Uint8Array([1, decimals]),
    new Uint8Array([1]),
    encodeU32LE(nameBytes.length),
    nameBytes,
    new Uint8Array([1]),
    encodeU32LE(symbolBytes.length),
    symbolBytes,
    new Uint8Array([1]),
    encodeU32LE(uriBytes.length),
    uriBytes,
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
      { pubkey: wrappedMint, isSigner: false, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: bridgeInfo, isSigner: false, isWritable: true },
      { pubkey: recipientPubkey, isSigner: false, isWritable: false },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: usedMarker, isSigner: false, isWritable: false },
      { pubkey: redeemedMarker, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: rateLimitState, isSigner: false, isWritable: true },
      { pubkey: tokenRegistration, isSigner: false, isWritable: true },
      { pubkey: TOKEN_BRIDGE_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(tokenData)
  });

  // TX1: compute budget + ed25519 verify + core post_verified_transfer
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

  // TX2: compute budget + token bridge mint_wrapped
  const mintTransaction = new Transaction();
  mintTransaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
  );
  mintTransaction.add(tokenInstruction);
  mintTransaction.feePayer = payer;

  // Combined transaction (backward compatibility)
  const transaction = new Transaction();
  if (signatureInstructions.length > 0) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
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
    mintTransaction.recentBlockhash = blockhash;
    transaction.recentBlockhash = blockhash;
  }

  return {
    coreInstruction,
    tokenInstruction,
    signatureInstructions,
    transaction,
    verifyTransaction,
    mintTransaction,
    accounts: {
      wrappedMint,
      mintAuthority,
      recipientAta,
      metadata,
      bridgeInfo,
      usedMarker,
      redeemedMarker
    }
  };
}

// ============================================================================
// MINT WRAPPED TOKENS (Existing token - no metadata)
// ============================================================================

export interface MintWrappedExistingResult {
  coreInstruction: TransactionInstruction;
  tokenInstruction: TransactionInstruction;
  signatureInstructions: TransactionInstruction[];
  /** Combined transaction (all instructions) - for backward compatibility */
  transaction: Transaction;
  /** TX1: compute budget + ed25519 verify + core post_verified_transfer */
  verifyTransaction: Transaction;
  /** TX2: compute budget + token bridge mint_wrapped */
  mintTransaction: Transaction;
  accounts: {
    wrappedMint: PublicKey;
    mintAuthority: PublicKey;
    recipientAta: PublicKey;
    usedMarker: PublicKey;
    redeemedMarker: PublicKey;
  };
}

/**
 * Build a Mint Wrapped Existing transaction
 * 
 * Mints wrapped Kalvora tokens on Solana for an already existing wrapped token.
 * No metadata is created since the mint already exists.
 */
export async function buildMintWrappedExistingTransaction(
  options: MintWrappedExistingOptions,
  payer: PublicKey,
  connection?: Connection
): Promise<MintWrappedExistingResult> {
  const {
    amount,
    recipient,
    contractId,
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
  const txnHash = hexToBytes(txnId);
  const expectedHashBytes = hexToBytes(expectedHash);
  const contractIdBytes = new TextEncoder().encode(contractId);

  // Derive PDAs
  const [routerCfg] = deriveRouterConfigPDA();
  const [usedMarker] = deriveVerifiedTransferPDA(expectedHashBytes);
  const [redeemedMarker] = deriveReleasedTransferPDA(expectedHashBytes);
  const [wrappedMint] = deriveWrappedMintPDA(contractId);
  const [mintAuthority] = deriveWrappedMintAuthorityPDA(wrappedMint);
  const [metadata] = deriveMetadataPDA(wrappedMint);
  const [rateLimitState] = deriveRateLimitStatePDA();
  const [tokenRegistration] = deriveTokenRegistrationPDA(wrappedMint);

  // Bridge info PDA
  const [bridgeInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from('bridge_info'), wrappedMint.toBuffer()],
    TOKEN_BRIDGE_PROGRAM_ID
  );

  // Recipient ATA
  const recipientAta = getATA(recipientPubkey, wrappedMint);

  const amountBigInt = BigInt(amount);
  const usdPriceNanoBigInt = BigInt(usdPriceNano);
  const liquidityUsdNanoBigInt = BigInt(liquidityUsdNano);

  const { sigs, pks } = parseSignatures(signatures);

  // Ed25519 verification instructions
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

  // Simplified payload for existing token (no metadata)
  const payload = concatBytes(
    encodeU64BE(amountBigInt),
    recipientPubkey.toBytes(),
    encodeU16BE(contractIdBytes.length),
    contractIdBytes,
    encodeU64BE(usdPriceNanoBigInt),
    encodeU64BE(liquidityUsdNanoBigInt),
    new Uint8Array([tier])
  );

  const action = ACTION_MINT_WRAPPED_EXISTING; // Action 3 for existing token mint

  // Core post_verified_transfer instruction
  const coreData = concatBytes(
    generateDiscriminator('global:post_verified_transfer'),
    new Uint8Array([version]),
    new Uint8Array([action]),
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

  // Token program mint_wrapped instruction (with None for all options)
  const tokenData = concatBytes(
    generateDiscriminator('global:mint_wrapped'),
    new Uint8Array([version]),
    encodeU64LE(BigInt(timestamp)),
    encodeU64LE(BigInt(expiry)),
    txnHash,
    encodeU32LE(eventIndex),
    encodeU64LE(amountBigInt),
    encodeU32LE(contractIdBytes.length),
    contractIdBytes,
    new Uint8Array([0]), // decimals: None
    new Uint8Array([0]), // name: None
    new Uint8Array([0]), // symbol: None
    new Uint8Array([0]), // uri: None
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
      { pubkey: wrappedMint, isSigner: false, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: bridgeInfo, isSigner: false, isWritable: true },
      { pubkey: recipientPubkey, isSigner: false, isWritable: false },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: usedMarker, isSigner: false, isWritable: false },
      { pubkey: redeemedMarker, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: rateLimitState, isSigner: false, isWritable: true },
      { pubkey: tokenRegistration, isSigner: false, isWritable: true },
      { pubkey: TOKEN_BRIDGE_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(tokenData)
  });

  // TX1: compute budget + ed25519 verify + core post_verified_transfer
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

  // TX2: compute budget + token bridge mint_wrapped
  const mintTransaction = new Transaction();
  mintTransaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
  );
  mintTransaction.add(tokenInstruction);
  mintTransaction.feePayer = payer;

  // Combined transaction (backward compatibility)
  const transaction = new Transaction();
  if (signatureInstructions.length > 0) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
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
    mintTransaction.recentBlockhash = blockhash;
    transaction.recentBlockhash = blockhash;
  }

  return {
    coreInstruction,
    tokenInstruction,
    signatureInstructions,
    transaction,
    verifyTransaction,
    mintTransaction,
    accounts: {
      wrappedMint,
      mintAuthority,
      recipientAta,
      usedMarker,
      redeemedMarker
    }
  };
}
