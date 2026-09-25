/**
 * Token Registration Transaction Builders
 * 
 * Builds transactions for registering tokens with the bridge.
 */

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
import type { RequestTokenRegistrationOptions, RegisterTokenOptions } from '../types.js';
import {
  CORE_PROGRAM_ID,
  TOKEN_BRIDGE_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  generateDiscriminator,
  deriveRouterConfigPDA,
  deriveVerifiedTransferPDA,
  deriveTokenRegistrationPDA,
  deriveExtensionWhitelist2022PDA,
  getMintAccountOwner
} from '../utils.js';

import {
  DEFAULT_VAA_VERSION,
  DEFAULT_VAA_EXPIRY,
  DEFAULT_EVENT_INDEX,
  createEd25519VerifyInstruction,
  parseSignatures
} from './helpers.js';

// ============================================================================
// REQUEST TOKEN REGISTRATION (Permissionless)
// ============================================================================

export interface RequestTokenRegistrationResult {
  instruction: TransactionInstruction;
  transaction: Transaction;
  accounts: {
    pendingRegistration: PublicKey;
    mint: PublicKey;
    tokenProgramId: PublicKey;
    extensionWhitelist: PublicKey | undefined;
  };
}

async function resolveMintTokenProgramId(
  mint: PublicKey,
  connection?: Connection,
  tokenProgramId?: string
): Promise<PublicKey> {
  if (tokenProgramId) {
    const owner = new PublicKey(tokenProgramId);
    if (owner.equals(TOKEN_PROGRAM_ID) || owner.equals(TOKEN_2022_PROGRAM_ID)) {
      return owner;
    }

    throw new Error(`Unsupported token program override: ${owner.toBase58()}`);
  }

  if (!connection) {
    return TOKEN_PROGRAM_ID;
  }

  const owner = await getMintAccountOwner(connection, mint);
  if (owner.equals(TOKEN_PROGRAM_ID) || owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return owner;
  }

  throw new Error(
    `Mint ${mint.toBase58()} is owned by unsupported token program ${owner.toBase58()}`
  );
}

/**
 * Build a Request Token Registration transaction
 * 
 * Permissionless request for token registration.
 * Anyone can request registration; guardians must approve via register_token.
 *
 * Rust reference: stx_proxy_execute_request_token_registration
 */
export async function buildRequestTokenRegistrationTransaction(
  options: RequestTokenRegistrationOptions,
  payer: PublicKey,
  connection?: Connection
): Promise<RequestTokenRegistrationResult> {
  const { mint, tokenProgramId: tokenProgramIdOverride } = options;

  const mintPubkey = new PublicKey(mint);
  const tokenProgramId = await resolveMintTokenProgramId(
    mintPubkey,
    connection,
    tokenProgramIdOverride
  );
  const [extensionWhitelist] = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)
    ? deriveExtensionWhitelist2022PDA()
    : [undefined];

  // Derive pending_registration PDA
  const [pendingRegistration] = PublicKey.findProgramAddressSync(
    [Buffer.from('pending_registration'), mintPubkey.toBuffer()],
    TOKEN_BRIDGE_PROGRAM_ID
  );

  const data = generateDiscriminator('global:request_token_registration');
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: mintPubkey, isSigner: false, isWritable: false },
    { pubkey: pendingRegistration, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ];

  if (extensionWhitelist) {
    keys.push({ pubkey: extensionWhitelist, isSigner: false, isWritable: false });
  }

  const instruction = new TransactionInstruction({
    programId: TOKEN_BRIDGE_PROGRAM_ID,
    keys,
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
    accounts: { pendingRegistration, mint: mintPubkey, tokenProgramId, extensionWhitelist }
  };
}

// ============================================================================
// REGISTER TOKEN (Guardian-attested)
// ============================================================================

export interface RegisterTokenResult {
  coreInstruction: TransactionInstruction;
  tokenInstruction: TransactionInstruction;
  signatureInstructions: TransactionInstruction[];
  /** Combined transaction (all instructions) - for backward compatibility */
  transaction: Transaction;
  /** TX1: compute budget + ed25519 verify + core post_verified_transfer */
  verifyTransaction: Transaction;
  /** TX2: register_token only */
  registerTransaction: Transaction;
  accounts: {
    tokenRegistration: PublicKey;
    mint: PublicKey;
    usedMarker: PublicKey;
    tokenProgramId: PublicKey;
    extensionWhitelist: PublicKey | undefined;
  };
}

/**
 * Build a Register Token transaction
 * 
 * Guardian-attested token registration.
 * Completes the registration requested by request_token_registration.
 *
 * Rust reference: stx_proxy_execute_register_token
 */
export async function buildRegisterTokenTransaction(
  options: RegisterTokenOptions,
  payer: PublicKey,
  connection?: Connection
): Promise<RegisterTokenResult> {
  const {
    mint,
    txnId,
    timestamp,
    signatures,
    expectedHash,
    usdPriceNano,
    liquidityUsdNano,
    tier,
    tokenProgramId: tokenProgramIdOverride
  } = options;

  const version = DEFAULT_VAA_VERSION;
  const expiry = DEFAULT_VAA_EXPIRY;
  const eventIndex = DEFAULT_EVENT_INDEX;

  const mintPubkey = new PublicKey(mint);
  const tokenProgramId = await resolveMintTokenProgramId(
    mintPubkey,
    connection,
    tokenProgramIdOverride
  );
  const [extensionWhitelist] = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)
    ? deriveExtensionWhitelist2022PDA()
    : [undefined];
  const txnHashRaw = hexToBytes(txnId);
  const txnHash = txnHashRaw.slice(0, 32); // Truncate to 32 bytes to match Kalvora hash size
  const expectedHashBytes = hexToBytes(expectedHash);

  // Derive PDAs
  const [routerCfg] = deriveRouterConfigPDA();
  const [usedMarker] = deriveVerifiedTransferPDA(expectedHashBytes);
  const [tokenRegistration] = deriveTokenRegistrationPDA(mintPubkey);

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

  // Payload for register_token
  const payload = concatBytes(
    mintPubkey.toBytes(),
    encodeU64BE(usdPriceNanoBigInt),
    encodeU64BE(liquidityUsdNanoBigInt),
    new Uint8Array([tier])
  );

  const action = 4; // ACTION_REGISTER_TOKEN

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

  // Token program register_token instruction
  const tokenData = concatBytes(
    generateDiscriminator('global:register_token'),
    new Uint8Array([version]),
    encodeU64LE(BigInt(timestamp)),
    encodeU64LE(BigInt(expiry)),
    txnHash,
    encodeU32LE(eventIndex),
    encodeU64LE(usdPriceNanoBigInt),
    encodeU64LE(liquidityUsdNanoBigInt),
    new Uint8Array([tier])
  );

  const tokenKeys = [
    { pubkey: CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: mintPubkey, isSigner: false, isWritable: false },
    { pubkey: tokenRegistration, isSigner: false, isWritable: true },
    { pubkey: usedMarker, isSigner: false, isWritable: false },
    { pubkey: TOKEN_BRIDGE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ];

  if (extensionWhitelist) {
    tokenKeys.push({ pubkey: extensionWhitelist, isSigner: false, isWritable: false });
  }

  const tokenInstruction = new TransactionInstruction({
    programId: TOKEN_BRIDGE_PROGRAM_ID,
    keys: tokenKeys,
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

  // TX2: register_token only
  const registerTransaction = new Transaction();
  registerTransaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
  );
  registerTransaction.add(tokenInstruction);
  registerTransaction.feePayer = payer;

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
    registerTransaction.recentBlockhash = blockhash;
    transaction.recentBlockhash = blockhash;
  }

  return {
    coreInstruction,
    tokenInstruction,
    signatureInstructions,
    transaction,
    verifyTransaction,
    registerTransaction,
    accounts: { tokenRegistration, mint: mintPubkey, usedMarker, tokenProgramId, extensionWhitelist }
  };
}
