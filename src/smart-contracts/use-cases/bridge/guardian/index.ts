/**
 * Guardian Module
 * 
 * Proto types, service definition, and VAA helpers for the Kalvora Guardian service.
 * Used to fetch VAA (Verified Action Approval) payloads and submit bridge transactions.
 * 
 * ## Fetching VAA Payloads
 * 
 * @example
 * ```typescript
 * import { createClient } from 'kalvora.js';
 * import { guardian } from 'kalvora.js';
 * 
 * const client = createClient(guardian.GuardianService, { 
 *   host: 'kal-protonet.visiondynamics.ch'
 * });
 * 
 * // Get a VAA payload
 * const response = await client.getPayload(create(guardian.PayloadRequestSchema, {
 *   payloadId: 'txn_hash',
 *   networkType: guardian.NETWORK_TYPE.ZERA
 * }));
 * ```
 * 
 * ## Submit VAA Functions
 * 
 * @example
 * ```typescript
 * import { Connection, Keypair } from '@solana/web3.js';
 * import { guardian } from 'kalvora.js';
 * 
 * // Submit VAA to Solana (auto-fetch, build, and submit)
 * const result = await guardian.submitVAAToSolana({
 *   txnHash: 'zera-txn-hash',
 *   guardianConfig: { host: 'kal-protonet.visiondynamics.ch' },
 *   connection: new Connection('https://api.mainnet-beta.solana.com'),
 *   payer: Keypair.fromSecretKey(yourSecretKey)
 * });
 * 
 * console.log('Solana signature:', result.signature);
 * ```
 */

// ============================================================================
// SERVICE (for use with createClient)
// ============================================================================

export { GuardianService } from '../../../../../proto/generated/guardian_pb.js';

// ============================================================================
// VAA FUNCTIONS
// ============================================================================

export {
  // Main VAA submit functions
  submitVAAToSolana,
  submitVAAToKalvora,
  
  // VAA fetch helpers (for manual control)
  fetchSolanaVAA,
  fetchKalvoraVAA,
  
  // Types
  type SubmitVAAToSolanaOptions,
  type SubmitVAAToSolanaResult,
  type SubmitVAAToKalvoraOptions,
  type SubmitVAAToKalvoraResult,
  type VAARetryOptions
} from './vaa.js';

// ============================================================================
// PROTO TYPES
// ============================================================================

export type {
  // Request/Response types
  PayloadRequest,
  PayloadResponse,
  SearchPayloadRequest,
  SearchPayloadResponse,
  
  // Payload container types
  ZeraPayload,
  SolanaPayload,
  
  // Kalvora payload types
  ZeraContractPayload,
  ZeraMintPayload,
  ZeraReleasePayload,
  ZeraRefundPayload,
  
  // Solana payload types
  SolanaContractPayload,
  SolanaMintPayload,
  SolanaReleasePayload,
  SolanaRegisterPayload,
  SolanaPausePayload,
  SolanaUpgradeBridgePayload,
  SolanaUpdateGuardianKeysPayload,
  
  // Utility types
  CreateSolanaContract,
  ExistingContracts
} from '../../../../../proto/generated/guardian_pb.js';

export {
  // Enums
  NETWORK_TYPE,
  PayloadRequestSchema,
  SearchPayloadRequestSchema
} from '../../../../../proto/generated/guardian_pb.js';
