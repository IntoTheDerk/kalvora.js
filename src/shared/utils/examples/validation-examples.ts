/**
 * Validation Examples
 * 
 * Demonstrates how to use the shared validation utilities.
 */

import { isValidContractId, validateContractId, validateAmount } from '../validation.js';

/**
 * Example 1: Simple Contract ID Validation
 */
export function exampleContractIdValidation(): void {
  console.log('🔍 Example 1: Contract ID Validation');
  
  // Valid contract IDs
  const validIds = ['KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao', 'BTC1234', 'ETH9999'];
  
  validIds.forEach(id => {
    const isValid = isValidContractId(id);
    console.log(`  ${id}: ${isValid ? '✅ Valid' : '❌ Invalid'}`);
  });
  
  // Invalid contract IDs
  const invalidIds = ['', 'bad id', '$KALV+00', 'KAL 111112'];
  
  invalidIds.forEach(id => {
    const isValid = isValidContractId(id);
    console.log(`  ${id}: ${isValid ? '✅ Valid' : '❌ Invalid'}`);
  });
}

/**
 * Example 2: Detailed Contract ID Validation
 */
export function exampleDetailedContractIdValidation(): void {
  console.log('🔍 Example 2: Detailed Contract ID Validation');
  
  const contractId = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
  
  // Simple validation
  const isValid = isValidContractId(contractId);
  console.log(`  Simple validation: ${isValid ? 'Valid' : 'Invalid'}`);
  
  // Detailed validation with error handling
  const result = validateContractId(contractId, { throwOnError: false });
  
  if (result.isValid) {
    console.log('  Detailed validation: ✅ Valid');
    console.log(`  Contract ID: ${result.value}`);
  } else {
    console.log('  Detailed validation: ❌ Invalid');
    console.log(`  Error: ${result.error}`);
  }
}

/**
 * Example 3: Amount Validation
 */
export function exampleAmountValidation(): void {
  console.log('🔍 Example 3: Amount Validation');
  
  const amounts = ['100.50', '0', '-10', 'invalid', '1000000'];
  
  amounts.forEach(amount => {
    const result = validateAmount(amount, { 
      throwOnError: false,
      allowZero: false 
    });
    
    if (result.isValid) {
      console.log(`  ${amount}: ✅ Valid`);
    } else {
      console.log(`  ${amount}: ❌ Invalid - ${result.error}`);
    }
  });
}

/**
 * Run all validation examples
 */
export function runAllValidationExamples(): void {
  console.log('🚀 Running Validation Examples\n');
  
  try {
    exampleContractIdValidation();
    console.log('');
    
    exampleDetailedContractIdValidation();
    console.log('');
    
    exampleAmountValidation();
    console.log('');
    
    console.log('✅ All validation examples completed!');
  } catch (error) {
    console.error('❌ Error running validation examples:', (error as Error).message);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllValidationExamples();
}
