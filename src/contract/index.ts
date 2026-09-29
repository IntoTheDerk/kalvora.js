/**
 * Contract Module
 * 
 * This module provides functionality for creating and updating contracts on the Kalvora network.
 * 
 * @example
 * ```typescript
 * import { createContractTXN, createContractUpdateTXN } from 'kalvora.js';
 * 
 * // Create a new contract
 * const contract = await createContractTXN({
 *   contractVersion: BigInt(0),
 *   symbol: 'MYT',
 *   name: 'My Token',
 *   type: 0,
 *   contractId: 'MYT0000',
 *   publicKeyBase58Identifier: '...',
 *   privateKeyBase58: '...'
 * });
 * 
 * // Update an existing contract
 * const update = await createContractUpdateTXN({
 *   contractId: 'MYT0000',
 *   contractVersion: BigInt(1),
 *   publicKeyBase58Identifier: '...',
 *   privateKeyBase58: '...',
 *   name: 'Updated Name'
 * });
 * ```
 */

export * from './create/index.js';
export * from './update/index.js';
export * from './shared/index.js';

