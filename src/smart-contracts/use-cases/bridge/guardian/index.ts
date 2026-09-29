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
 * import { create } from '@bufbuild/protobuf';
 * import { createGrpcClient, guardianBridge, NETWORK_TYPE_KALVORA } from 'kalvora.js';
 * 
 * const client = createGrpcClient(guardianBridge.GuardianService, { 
 *   host: 'kal-proto.visiondynamics.ch'
 * });
 * 
 * // Get a VAA payload for a Kalvora transaction
 * const response = await client.getPayload(create(guardianBridge.PayloadRequestSchema, {
 *   payloadId: 'txn_hash',
 *   networkType: NETWORK_TYPE_KALVORA
 * }));
 * ```
 * 
 * ## Submit VAA Functions
 * 
 * @example
 * ```typescript
 * import { Connection, Keypair } from '@solana/web3.js';
 * import { guardianBridge } from 'kalvora.js';
 * 
 * // Submit VAA to Solana (auto-fetch, build, and submit)
 * const result = await guardianBridge.submitVAAToSolana({
 *   txnHash: 'kalvora-txn-hash',
 *   guardianConfig: { host: 'kal-proto.visiondynamics.ch' },
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
  SolanaPayload,
  
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

// Kalvora-side payload types (Kalvora names for the generated guardian messages)
export type {
  KalvoraGuardianPayload,
  KalvoraGuardianContractPayload,
  KalvoraGuardianMintPayload,
  KalvoraGuardianReleasePayload,
  KalvoraGuardianRefundPayload
} from '../../../../protocol/guardian-names.js';

export {
  NETWORK_TYPE_KALVORA,
  GUARDIAN_KALVORA_PAYLOAD_CASE
} from '../../../../protocol/guardian-names.js';

export {
  // Enums
  NETWORK_TYPE,
  PayloadRequestSchema,
  SearchPayloadRequestSchema
} from '../../../../../proto/generated/guardian_pb.js';
