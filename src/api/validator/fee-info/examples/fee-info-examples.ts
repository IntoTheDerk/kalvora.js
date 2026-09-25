/**
 * Fee Info Service Examples
 * 
 * Demonstrates how to use the fee info service to get comprehensive token fee information.
 */

import { PROTONET_GRPC_CONFIG } from '../../../../shared/utils/testing-defaults/index.js';
import { getTokenFeeInfo } from '../request.js';

/**
 * Example: Get comprehensive fee information for all tokens
 */
async function getAllTokenFeeInfoExample() {
  try {
    console.log('Fetching comprehensive fee information for all tokens...');
    
    const response = await getTokenFeeInfo({
      contractIds: ['KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', 'IIT0000'],
      includeRates: true,
      includeContractFees: true
    }, PROTONET_GRPC_CONFIG); // Use PROTONET_GRPC_CONFIG here
    
    console.log(`Found ${response.tokens.length} tokens with fee information:`);
    response.tokens.forEach((info) => {
      console.log(`  Contract ID: ${info.contractId}`);
      console.log(`  Rate: ${info.rate} (raw string)`);
      console.log(`  Authorized: ${info.authorized}`);
      console.log(`  Denomination: ${info.denomination}`);
      console.log(`  Allowed Fees: ${info.allowedFees}`);
      console.log(`  Used Fees: ${info.usedFees}`);
      if (info.contractFees) {
        console.log('  Contract Fees:');
        console.log(`    Fee: ${info.contractFees.fee}`);
        console.log(`    Burn: ${info.contractFees.burn}`);
        console.log(`    Validator: ${info.contractFees.validator}`);
        if (info.contractFees.feeAddress) {
          console.log(`    Fee Address: ${info.contractFees.feeAddress}`);
        }
      }
      console.log('---');
    });
    
    return response;
  } catch (error) {
    console.error('Error fetching token fee information:', error);
    throw error;
  }
}

/**
 * Example: Get fee information for a single token using PROTONET_GRPC_CONFIG
 */
getSingleTokenFeeInfoExample();
async function getSingleTokenFeeInfoExample() {
  try {
    console.log('Fetching fee information for a single token (KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao) using PROTONET_GRPC_CONFIG...');
    
    const response = await getTokenFeeInfo({
      contractIds: ['KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'],
      includeRates: true,
      includeContractFees: true
    }, PROTONET_GRPC_CONFIG);
    
    if (response.tokens.length > 0) {
      const info = response.tokens[0];
      console.log(`  Contract ID: ${info.contractId}`);
      console.log(`  Rate: ${info.rate} (raw string)`);
      console.log(`  Authorized: ${info.authorized}`);
      console.log(`  Denomination: ${info.denomination}`);
      console.log(`  Allowed Fees: ${info.allowedFees}`);
      console.log(`  Used Fees: ${info.usedFees}`);
      if (info.contractFees) {
        console.log('  Contract Fees:');
        console.log(`    Fee: ${info.contractFees.fee}`);
        console.log(`    Burn: ${info.contractFees.burn}`);
        console.log(`    Validator: ${info.contractFees.validator}`);
        if (info.contractFees.feeAddress) {
          console.log(`    Fee Address: ${info.contractFees.feeAddress}`);
        }
      }
    } else {
      console.log('No token information found for KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao.');
    }
    
    return response;
  } catch (error) {
    console.error('Error fetching single token fee information:', error);
    throw error;
  }
}