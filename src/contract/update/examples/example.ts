/**
 * Example usage of the contract update program
 * 
 * This file demonstrates how to update existing contracts on the Kalvora network.
 * Enable/disable features by setting the boolean flags below.
 * This file has not been fully tested and is for illustrative purposes only. It does not cover all validity checks.
 */

import { PROTONET_GRPC_CONFIG } from '../../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS, TEST_WALLET_ADDRESSES } from '../../../test-utils/index.js';
import type { UpdateContractOptions } from '../../shared/types.js';
import { 
  convertPercentToRegularQuorum,
  convertPercentToThreshold,
  convertPercentToContractFeePercent,
  convertDollarAmountToContractFee
} from '../../shared/utils.js';
import { createContractUpdateTXN, sendContractUpdateTXN } from '../transaction.js';

/**
 * Update a contract with configurable features
 * 
 * Set the boolean flags below to true/false to enable/disable features
 */
async function updateContractExample(): Promise<void> {
  try {
    // ============================================
    // CONFIGURATION - Set these to true/false
    // ============================================
    const USE_GOVERNANCE = true;
    const USE_RESTRICTED_KEYS = true;
    const USE_CONTRACT_FEES = true;
    const USE_CUSTOM_PARAMETERS = true;
    const USE_EXPENSE_RATIO = true;
    const USE_TOKEN_COMPLIANCE = true;
    const USE_KYC = true;
    const USE_QUASH_THRESHOLD = true;
    const UPDATE_NAME = true;

    // Basic contract info
    const contractId = 'MYT0000'; // Contract ID of the contract to update
    const contractVersion = BigInt(1); // Must be current version + 1
    
    // Use Alice's test keys for contract update
    const publicKeyBase58Identifier = ED25519_TEST_KEYS.alice.publicKey;
    const privateKeyBase58 = ED25519_TEST_KEYS.alice.privateKey;
    const feeId = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
    const memo = 'Updating contract with selected features';
    
    // New contract name (optional)
    const newName = UPDATE_NAME ? 'My Updated Token' : undefined;

    // ============================================
    // Import required modules
    // ============================================
    const { create, protoInt64 } = await import('@bufbuild/protobuf');
    const { 
      GovernanceSchema, 
      GOVERNANCE_TYPE,
      PROPOSAL_PERIOD,
      RestrictedKeySchema,
      PublicKeySchema,
      ContractFeesSchema,
      CONTRACT_FEE_TYPE,
      ExpenseRatioSchema,
      KeyValuePairSchema,
      TokenComplianceSchema,
      ComplianceSchema
    } = await import('../../../../proto/generated/txn_pb.js');
    const { TimestampSchema } = await import('../../../../proto/generated/google/protobuf/timestamp_pb.js');
    const { getPublicKeyBytes, sanitizeAndDecodeAddress } = await import('../../../../src/shared/crypto/address-utils.js');

    // ============================================
    // Build optional features based on flags
    // ============================================
    
    // Governance
    let governance;
    if (USE_GOVERNANCE) {
      const { StageSchema } = await import('../../../../proto/generated/txn_pb.js');

      // Specify percentages in human-readable format (e.g., 50.5 for 50.5%)
      // Change this value to switch between governance types
      const GOVERNANCE_TYPE_SELECTION = 'STAGGERED' as 'STAGED' | 'CYCLE' | 'STAGGERED' | 'ADAPTIVE';
      const regularQuorumPercent = 50.1; // percent of yes votes needed to pass
      const thresholdPercent = 0.25; // minimum amount of circulating supply needed for vote to be considered valid
      
      // Build governance based on selected type - explicit examples for each type
      if (GOVERNANCE_TYPE_SELECTION === 'STAGED') {
        // STAGED governance: Multiple stages of governance, must pass quorum to get to next stage and if max approved specified proposals through determined by passing quorum + total number of votes. Meaning that a technical pass of quorum and threshold does not mean the proposal will make it to the next stage.

        const stages = [
          create(StageSchema, {
            length: 7,
            period: PROPOSAL_PERIOD.DAYS,
            break: false, // Not a break stage
            maxApproved: 10 // Max proposals approved in this stage
          }),
          create(StageSchema, {
            length: 7,
            period: PROPOSAL_PERIOD.DAYS,
            break: true, // BREAK STAGE - no voting during this period
            maxApproved: 5
          }),
          create(StageSchema, {
            length: 7,
            period: PROPOSAL_PERIOD.DAYS,
            break: false,
            maxApproved: 3
          }),
          create(StageSchema, {
            length: 7,
            period: PROPOSAL_PERIOD.DAYS,
            break: false,
            maxApproved: 2
          }),
          create(StageSchema, {
            length: 0, // REMAINDER - represents remainder of proposal period
            period: PROPOSAL_PERIOD.DAYS,
            break: false,
            maxApproved: 1
          })
        ];


        // Requires: votingPeriod, proposalPeriod, startTimestamp
        governance = create(GovernanceSchema, {
          type: GOVERNANCE_TYPE.STAGED,
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.1% = 5010
          threshold: convertPercentToThreshold(thresholdPercent), // 0.25% = 2.5
          votingInstrument: [contractId], // Contract IDs allowed to vote
          allowedProposalInstrument: [contractId], // Contract IDs allowed to create proposals
          allowMulti: true, // Allow multiple choice proposals
          votingPeriod: 1, // Month (as per proposalPeriod setting)
          proposalPeriod: PROPOSAL_PERIOD.MONTHS,
          stageLength: stages,
          startTimestamp: create(TimestampSchema, {
            seconds: protoInt64.parse(Math.floor(Date.now() / 1000)) // starting timestamp of the whole cycle - for example, start of the month, on a monthly cycle
          })
        });
      } else if (GOVERNANCE_TYPE_SELECTION === 'CYCLE') {
        // CYCLE governance: Proposals are grouped into cycles, with stages within each cycle
        // Requires: votingPeriod, proposalPeriod, startTimestamp, maxApproved
        governance = create(GovernanceSchema, {
          type: GOVERNANCE_TYPE.CYCLE,
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.1% = 5010
          threshold: convertPercentToThreshold(thresholdPercent), // 0.25% = 2.5
          votingInstrument: [contractId], // Contract IDs allowed to vote
          allowedProposalInstrument: [contractId], // Contract IDs allowed to create proposals
          allowMulti: true, // Allow multiple choice proposals
          votingPeriod: 30, // Days (as per proposalPeriod setting)
          proposalPeriod: PROPOSAL_PERIOD.DAYS,
          startTimestamp: create(TimestampSchema, {
            seconds: protoInt64.parse(Math.floor(Date.now() / 1000)) // starting timestamp of the whole cycle - for example, start of the month, on a monthly cycle
          }),
          maxApproved: 10 // Max proposals approved in entire cycle
        });
      } else if (GOVERNANCE_TYPE_SELECTION === 'STAGGERED') {
        // STAGGERED governance: Every proposal has the same voting period length and starts when proposal is made
        // Requires: votingPeriod, proposalPeriod
        // Does NOT require: startTimestamp, maxApproved
        governance = create(GovernanceSchema, {
          type: GOVERNANCE_TYPE.STAGGERED,
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.1% = 5010
          threshold: convertPercentToThreshold(thresholdPercent), // 0.25% = 2.5
          votingInstrument: [contractId], // Contract IDs allowed to vote
          allowedProposalInstrument: [contractId], // Contract IDs allowed to create proposals
          allowMulti: false, // Typically no multi-choice for staggered
          votingPeriod: 4, // Days (as per proposalPeriod setting)
          proposalPeriod: PROPOSAL_PERIOD.DAYS
          // No startTimestamp or maxApproved for STAGGERED
        });
      } else if (GOVERNANCE_TYPE_SELECTION === 'ADAPTIVE') {
        // ADAPTIVE governance: Every proposal has its own specified voting period
        // Does NOT require: votingPeriod, proposalPeriod, startTimestamp, maxApproved
        governance = create(GovernanceSchema, {
          type: GOVERNANCE_TYPE.ADAPTIVE,
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.1% = 5010
          threshold: convertPercentToThreshold(thresholdPercent), // 0.25% = 2.5
          votingInstrument: [contractId], // Contract IDs allowed to vote
          allowedProposalInstrument: [contractId], // Contract IDs allowed to create proposals
          allowMulti: true // Allow multiple choice proposals
          // No votingPeriod or proposalPeriod for ADAPTIVE - each proposal specifies its own
          // No startTimestamp or maxApproved for ADAPTIVE
        });
      } else {
        throw new Error(`Unknown governance type: ${GOVERNANCE_TYPE_SELECTION}`);
      }
    }

    // Restricted Keys
    let restrictedKeys;
    if (USE_RESTRICTED_KEYS) {
      // Use Alice's public key for restricted key 1
      const restrictedKey1PublicKeyId = ED25519_TEST_KEYS.alice.publicKey;
      const restrictedKey1Bytes = getPublicKeyBytes(restrictedKey1PublicKeyId);
      const restrictedKey1 = create(RestrictedKeySchema, {
        publicKey: create(PublicKeySchema, {
          single: restrictedKey1Bytes
        }),
        timeDelay: BigInt(86400), // 1 day delay
        global: true,
        createContractUpdateTXN: true,
        transfer: false,
        quash: true,
        mint: true,
        vote: true,
        propose: true,
        compliance: true,
        expenseRatio: true,
        revoke: false,
        keyWeight: 50
      });

      // Use Bob's public key for restricted key 2
      const restrictedKey2PublicKeyId = ED25519_TEST_KEYS.bob.publicKey;
      const restrictedKey2Bytes = getPublicKeyBytes(restrictedKey2PublicKeyId);
      const restrictedKey2 = create(RestrictedKeySchema, {
        publicKey: create(PublicKeySchema, {
          single: restrictedKey2Bytes
        }),
        timeDelay: BigInt(0),
        global: false,
        createContractUpdateTXN: false,
        transfer: true,
        quash: false,
        mint: false,
        vote: false,
        propose: false,
        compliance: false,
        expenseRatio: false,
        revoke: false,
        keyWeight: 30
      });

      restrictedKeys = [restrictedKey1, restrictedKey2];
    }

    // Contract Fees
    // Specify fee configuration in human-readable format
    // Change this value to switch between fee types
    const CONTRACT_FEE_TYPE_SELECTION = 'PERCENTAGE' as 'FIXED' | 'CUR_EQUIVALENT' | 'PERCENTAGE' | 'NONE';
    const feePercent = 2.5; // 2.5% - for PERCENTAGE type
    const feeDollarAmount = 1.0; // $1.00 - for FIXED or CUR_EQUIVALENT type
    const burnPercent = 50.0; // 50% of fees go to burn
    const validatorPercent = 30.0; // 30% of fees go to validator
    
    let contractFees;
    if (USE_CONTRACT_FEES) {
      let feeValue: string;
      
      if (CONTRACT_FEE_TYPE_SELECTION === 'PERCENTAGE') {
        // For PERCENTAGE type: fee is a percentage (100% = 1000000000000000000)
        feeValue = convertPercentToContractFeePercent(feePercent);
      } else if (CONTRACT_FEE_TYPE_SELECTION === 'FIXED' || CONTRACT_FEE_TYPE_SELECTION === 'CUR_EQUIVALENT') {
        // For FIXED or CUR_EQUIVALENT: fee is a dollar amount ($1.00 = 1000000000000000000)
        feeValue = convertDollarAmountToContractFee(feeDollarAmount);
      } else {
        // NONE type - no fees
        feeValue = '0';
      }

      contractFees = create(ContractFeesSchema, {
        fee: feeValue,
        feeAddress: sanitizeAndDecodeAddress(TEST_WALLET_ADDRESSES.alice), // Use Alice's address for fee recipient
        // burn and validator are always percentages (100% = 1000000000000000000)
        burn: convertPercentToContractFeePercent(burnPercent),
        validator: convertPercentToContractFeePercent(validatorPercent),
        allowedFeeInstrument: ['KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'],
        contractFeeType: CONTRACT_FEE_TYPE[CONTRACT_FEE_TYPE_SELECTION as keyof typeof CONTRACT_FEE_TYPE]
      });
    }

    // Expense Ratios
    let expenseRatio;
    if (USE_EXPENSE_RATIO) {
      expenseRatio = [
        create(ExpenseRatioSchema, {
          day: 1,
          month: 1, // January
          percent: 10000 // 10%
        }),
        create(ExpenseRatioSchema, {
          day: 15,
          month: 6, // June
          percent: 15000 // 15%
        })
      ];
    }

    // Custom Parameters
    let customParameters;
    if (USE_CUSTOM_PARAMETERS) {
      customParameters = [
        create(KeyValuePairSchema, {
          key: 'website',
          value: 'https://example.com'
        }),
        create(KeyValuePairSchema, {
          key: 'description',
          value: 'Updated example token contract'
        })
      ];
    }

    // Token Compliance
    let tokenCompliance;
    if (USE_TOKEN_COMPLIANCE) {
      const compliance1 = create(ComplianceSchema, {
        contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
        complianceLevel: 5
      });

      tokenCompliance = [
        create(TokenComplianceSchema, {
          compliance: [compliance1]
        })
      ];
    }

    // ============================================
    // Build contract update options
    // ============================================
    const options: UpdateContractOptions = {
      contractId,
      contractVersion,
      publicKeyBase58Identifier,
      privateKeyBase58,
      feeId,
      memo,
      ...(UPDATE_NAME && newName && { name: newName }),
      ...(USE_GOVERNANCE && { governance }),
      ...(USE_RESTRICTED_KEYS && restrictedKeys && { restrictedKeys }),
      ...(USE_CONTRACT_FEES && contractFees && { contractFees }),
      ...(USE_CUSTOM_PARAMETERS && customParameters && { customParameters }),
      ...(USE_EXPENSE_RATIO && expenseRatio && { expenseRatio }),
      ...(USE_TOKEN_COMPLIANCE && tokenCompliance && { tokenCompliance }),
      ...(USE_KYC && { 
        kycStatus: true,
        immutableKycStatus: false 
      }),
      ...(USE_QUASH_THRESHOLD && { quashThreshold: 3 }),
      grpcConfig: PROTONET_GRPC_CONFIG // Use test gRPC configuration
    };

    console.log('Updating contract...');
    console.log('Contract ID:', contractId);
    console.log('New version:', contractVersion.toString());
    console.log('Enabled features:');
    if (UPDATE_NAME) console.log('  ✓ Name Update');
    if (USE_GOVERNANCE) console.log('  ✓ Governance');
    if (USE_RESTRICTED_KEYS) console.log('  ✓ Restricted Keys');
    if (USE_CONTRACT_FEES) console.log('  ✓ Contract Fees');
    if (USE_CUSTOM_PARAMETERS) console.log('  ✓ Custom Parameters');
    if (USE_EXPENSE_RATIO) console.log('  ✓ Expense Ratio');
    if (USE_TOKEN_COMPLIANCE) console.log('  ✓ Token Compliance');
    if (USE_KYC) console.log('  ✓ KYC Status');
    if (USE_QUASH_THRESHOLD) console.log('  ✓ Quash Threshold');

    const update = await createContractUpdateTXN(options);
    
    console.log('\n✓ Contract updated successfully!');
    console.log(`Contract ID: ${update.contractId}`);
    console.log(`Version: ${update.contractVersion}`);
    if (update.name) {
      console.log(`Name: ${update.name}`);
    }
    
    // Send to network (uncomment to actually submit)
    // console.log('\nSubmitting contract update to network...');
    // const hash = await sendContractUpdateTXN(update, PROTONET_GRPC_CONFIG);
    // console.log(`✓ Contract update submitted with hash: ${hash}`);
    
  } catch (error) {
    console.error('Error updating contract:', error);
    throw error;
  }
}

/**
 * Example: Manual Nonce Specification
 *
 * Use this when you already know the nonce (e.g., from a previous query)
 * or when building offline transactions.
 *
 * WARNING: Manually specified nonces are not validated. Incorrect nonces
 * will cause transaction failure.
 */
async function exampleManualNonce(): Promise<void> {
  try {
    const options: UpdateContractOptions = {
      contractId: 'MYT0000',
      contractVersion: BigInt(2), // Must be current version + 1
      publicKeyBase58Identifier: ED25519_TEST_KEYS.alice.publicKey,
      privateKeyBase58: ED25519_TEST_KEYS.alice.privateKey,
      name: 'Updated Token Name',
      memo: 'Contract update with manual nonce',
      grpcConfig: PROTONET_GRPC_CONFIG,
      // Manual nonce - skips network fetch
      // WARNING: Not validated! Incorrect nonce will cause transaction failure
      nonce: '10'
    };

    console.log('Updating contract with manual nonce...');
    const update = await createContractUpdateTXN(options);

    console.log('✓ Contract update created with manual nonce: 10');
    console.log(`Contract ID: ${update.contractId}`);
    console.log('WARNING: Manual nonce is not validated!');

    // Note: This will likely fail if the nonce is incorrect
    // const hash = await sendContractUpdateTXN(update, PROTONET_GRPC_CONFIG);
    // console.log(`✓ Contract update submitted with hash: ${hash}`);

  } catch (error) {
    console.error('Error updating contract:', error);
    throw error;
  }
}

/**
 * Example: Fully Offline (Manual Nonce + Fee)
 *
 * Use this for fully offline transaction building when you know both
 * the nonce and want to specify the exact fee amount.
 *
 * Note: Manual fees are used exactly as provided (no overestimation applied)
 * WARNING: Manually specified values are not validated!
 */
async function exampleFullyOffline(): Promise<void> {
  try {
    const options: UpdateContractOptions = {
      contractId: 'MYT0000',
      contractVersion: BigInt(2), // Must be current version + 1
      publicKeyBase58Identifier: ED25519_TEST_KEYS.alice.publicKey,
      privateKeyBase58: ED25519_TEST_KEYS.alice.privateKey,
      name: 'Updated Token Name',
      memo: 'Fully offline contract update',
      grpcConfig: PROTONET_GRPC_CONFIG,
      // Manual nonce - skips network nonce fetch
      nonce: '15',
      // Manual fee - skips fee calculation, used exactly as provided (no overestimation)
      feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      feeAmountParts: '500000000' // 0.5 KALV in smallest units - used exactly!
    };

    console.log('Updating contract fully offline...');
    const update = await createContractUpdateTXN(options);

    console.log('✓ Contract update created fully offline:');
    console.log('  Manual nonce: 15');
    console.log('  Manual fee: 500000000 (0.5 KALV) - used exactly, no overestimation');
    console.log(`  Contract ID: ${update.contractId}`);
    console.log('  WARNING: These values are not validated!');

  } catch (error) {
    console.error('Error updating contract:', error);
    throw error;
  }
}

// Run example
async function main(): Promise<void> {
  console.log('Contract Update Example\n');
  console.log('='.repeat(50));
  await updateContractExample();
  console.log('\nNote: Update contract ID and version before running.');
}

// Run automatically if executed directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('example.ts')) {
  main().catch(console.error);
}

export { updateContractExample, exampleManualNonce, exampleFullyOffline };

