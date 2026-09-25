/**
 * Burn Transaction Builders
 * 
 * Builds transactions for burning wrapped tokens to bridge back to Kalvora.
 */

import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js';

import {
  concatBytes,
  encodeU64LE
} from '../../../../../shared/utils/byte-utils.js';
import type { BurnWrappedOptions } from '../types.js';
import {
  TOKEN_BRIDGE_PROGRAM_ID,
  generateDiscriminator,
  deriveRouterConfigPDA,
  deriveWrappedMintAuthorityPDA,
  deriveRateLimitStatePDA,
  deriveTokenRegistrationPDA,
  getATA,
  encodeBorshString
} from '../utils.js';

// ============================================================================
// BURN WRAPPED TOKENS (Bridge back to Kalvora)
// ============================================================================

export interface BurnWrappedResult {
  instruction: TransactionInstruction;
  transaction: Transaction;
  accounts: {
    wrappedMint: PublicKey;
    userAta: PublicKey;
    mintAuthority: PublicKey;
    bridgeInfo: PublicKey;
  };
}

/**
 * Build a Burn Wrapped Tokens transaction
 * 
 * Burns wrapped Kalvora tokens on Solana to bridge back to Kalvora chain.
 * 
 * Rust reference: stx_proxy_execute_burn_wrapped
 */
export async function buildBurnWrappedTransaction(
  options: BurnWrappedOptions,
  payer: PublicKey,
  connection?: Connection
): Promise<BurnWrappedResult> {
  const { amount, wrappedMint, zeraRecipient } = options;

  const wrappedMintPubkey = new PublicKey(wrappedMint);

  // Derive PDAs (matching Rust reference)
  const [routerCfg] = deriveRouterConfigPDA();
  const [mintAuthority] = deriveWrappedMintAuthorityPDA(wrappedMintPubkey);
  const [rateLimitState] = deriveRateLimitStatePDA();
  const [tokenRegistration] = deriveTokenRegistrationPDA(wrappedMintPubkey);

  // Bridge info PDA
  const [bridgeInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from('bridge_info'), wrappedMintPubkey.toBuffer()],
    TOKEN_BRIDGE_PROGRAM_ID
  );

  const userAta = getATA(payer, wrappedMintPubkey);

  const amountBigInt = BigInt(amount);

  // Data = disc("global:burn_wrapped") || amount (u64 LE) || zera_recipient (Vec<u8>)
  const data = concatBytes(
    generateDiscriminator('global:burn_wrapped'),
    encodeU64LE(amountBigInt),
    encodeBorshString(zeraRecipient)
  );

  // Accounts must match BurnWrapped context (Rust reference order)
  const instruction = new TransactionInstruction({
    programId: TOKEN_BRIDGE_PROGRAM_ID,
    keys: [
      { pubkey: routerCfg, isSigner: false, isWritable: false },           // router_cfg
      { pubkey: payer, isSigner: true, isWritable: true },                 // authority (signer)
      { pubkey: wrappedMintPubkey, isSigner: false, isWritable: true },    // wrapped_mint
      { pubkey: mintAuthority, isSigner: false, isWritable: false },       // mint_authority
      { pubkey: bridgeInfo, isSigner: false, isWritable: false },          // bridge_info
      { pubkey: userAta, isSigner: false, isWritable: true },              // user_ata
      { pubkey: rateLimitState, isSigner: false, isWritable: true },       // rate_limit_state
      { pubkey: tokenRegistration, isSigner: false, isWritable: true },    // token_registration
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }     // token_program
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
    accounts: { wrappedMint: wrappedMintPubkey, userAta, mintAuthority, bridgeInfo }
  };
}
