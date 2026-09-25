import { createValidatorAPIClient } from './api/validator-api-client.js';
import { createTransactionClient, submitTransaction } from './transaction/transaction-client.js';

/**
 * gRPC Infrastructure Module
 * 
 * This module provides gRPC client infrastructure for the Kalvora Network.
 * It includes generic clients, specific service clients, and utility functions.
 * All gRPC connections default to kal-protonet.visiondynamics.ch on port 443
 * over HTTPS. HTTP fallback is disabled by default because this is a public
 * network boundary.
 */

// Re-export main functions
export { createValidatorAPIClient } from './api/validator-api-client.js';
export { createTransactionClient, submitTransaction } from './transaction/transaction-client.js';
export type { AnyKalvoraTransaction } from './transaction/transaction-client.js';

export default {
  createValidatorAPIClient,
  createTransactionClient,
  submitTransaction
};
