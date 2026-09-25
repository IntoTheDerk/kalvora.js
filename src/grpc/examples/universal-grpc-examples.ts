/**
 * gRPC Client Creation Patterns
 * 
 * This demonstrates different patterns for creating and configuring gRPC clients.
 * Focuses on infrastructure patterns rather than business logic.
 */

import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import { 
  createValidatorAPIClient
} from '../api/validator-api-client.js';
import { 
  createTransactionClient
} from '../transaction/transaction-client.js';

/**
 * Example 1: Pre-configured Service Clients
 */
export async function examplePreConfiguredClients() {
  console.log('🔧 Example 1: Pre-configured Service Clients');
  
  try {
    // Create validator API client (pre-configured for validator operations)
    const validatorClient = createValidatorAPIClient({
      host: PROTONET_GRPC_CONFIG.host,
      timeout: 10000
    });
    
    console.log('✅ Validator API client created:');
    console.log(`  Host: ${validatorClient.host}`);
    console.log(`  Port: ${validatorClient.port}`);
    
    // Create transaction client (pre-configured for transaction operations)
    const transactionClient = createTransactionClient({
      host: PROTONET_GRPC_CONFIG.host,
      timeout: 15000
    });
    
    console.log('✅ Transaction client created:');
    console.log(`  Host: ${transactionClient.host}`);
    console.log(`  Port: ${transactionClient.port}`);
    
    return { validatorClient, transactionClient };
  } catch (error) {
    console.error('❌ Error creating pre-configured clients:', (error as Error).message);
    throw error;
  }
}
