/**
 * Example usage of the contract creation program
 * 
 * This file demonstrates how to create new contracts on the Kalvora network.
 * Enable/disable features by setting the boolean flags below.
 * This file has not been fully tested and is for illustrative purposes only. It does not cover all validaity checks.
 */

import { protoInt64, create } from '@bufbuild/protobuf';

import { TimestampSchema } from '../../../../proto/generated/google/protobuf/timestamp_pb.js';
import type { Timestamp } from '../../../../proto/generated/google/protobuf/timestamp_pb.js';
import {
  GOVERNANCE_TYPE,
  PROPOSAL_PERIOD,
  CONTRACT_FEE_TYPE,
  CONTRACT_TYPE,
  GovernanceSchema,
  StageSchema,
  RestrictedKeySchema,
  PublicKeySchema,
  ContractFeesSchema,
  ExpenseRatioSchema,
  PreMintWalletSchema,
  CoinDenominationSchema,
  KeyValuePairSchema,
  TokenComplianceSchema,
  ComplianceSchema,
  MaxSupplyReleaseSchema
} from '../../../../proto/generated/txn_pb.js';
import type {
  Governance,
  RestrictedKey,
  PublicKey,
  ContractFees,
  ExpenseRatio,
  PreMintWallet,
  CoinDenomination,
  KeyValuePair,
  TokenCompliance,
  Compliance,
  MaxSupplyRelease,
  Stage
} from '../../../../proto/generated/txn_pb.js';
import { getPublicKeyBytes, sanitizeAndDecodeAddress } from '../../../shared/crypto/address-utils.js';
import { PROTONET_GRPC_CONFIG } from '../../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS, TEST_WALLET_ADDRESSES } from '../../../test-utils/index.js';
import type { CreateContractOptions } from '../../shared/types.js';
import { 
  convertAmountToParts,
  convertPercentToRegularQuorum,
  convertPercentToThreshold,
  convertPercentToContractFeePercent,
  convertDollarAmountToContractFee
} from '../../shared/utils.js';
import { createContractTXN, sendContractTXN } from '../transaction.js';


/**
 * Create a contract with configurable features
 * 
 * Set the boolean flags below to true/false to enable/disable features
 */
async function createContractExample(): Promise<void> {
  try {
    // ============================================
    // CONFIGURATION - Set these to true/false
    // ============================================
    const USE_GOVERNANCE = true;
    const USE_RESTRICTED_KEYS = true;
    const USE_CONTRACT_FEES = true;
    const USE_PREMINT_WALLETS = true;
    const USE_CUSTOM_PARAMETERS = true;
    const USE_EXPENSE_RATIO = true;
    const USE_TOKEN_COMPLIANCE = true;
    const USE_MAX_SUPPLY_RELEASE = true;
    const USE_KYC = true;
    const USE_QUASH_THRESHOLD = true;

    // Basic contract info
    const contractVersion = BigInt(1000000);
    const CONTRACT_TYPE_SELECTION = 'TOKEN' as 'TOKEN' | 'NFT' | 'SBT';
    const name = 'My Token';
    const contractId = 'MYT0000'; // must be unique on the network
    const symbol = 'MYT';

    // Use Alice's test keys for contract creation
    const publicKeyBase58Identifier = ED25519_TEST_KEYS.alice.publicKey;
    const privateKeyBase58 = ED25519_TEST_KEYS.alice.privateKey;
    const feeId = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
    const memo = 'Creating contract with selected features';

    // ============================================
    // Build optional features based on flags
    // ============================================
    
    // Governance
    let governance: Governance | undefined;
    if (USE_GOVERNANCE) {

      // Specify percentages in human-readable format (e.g., 50.5 for 50.5%)
      // Change this value to switch between governance types
      const GOVERNANCE_TYPE_SELECTION = 'STAGGERED' as 'STAGED' | 'CYCLE' | 'STAGGERED' | 'ADAPTIVE';
      const regularQuorumPercent = 50.1; // percent of yes votes needed to pass
      const thresholdPercent = 0.25; // minimum amount of circulating supply needed for vote to be considered valid
      
      // Build governance based on selected type - explicit examples for each type
      if (GOVERNANCE_TYPE_SELECTION === 'STAGED') {
        // STAGED governance: Multiple stages of governance, must pass quorum to get to next stage and if max approved specified proposals through determined by passing quorum + total number of votes. Meaning that a technical pass of quroum and threshold does not mean the proposal will make it to the next stage.

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
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.0% = 5000
          threshold: convertPercentToThreshold(thresholdPercent), // 20.0% = 200
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
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.0% = 5000
          threshold: convertPercentToThreshold(thresholdPercent), // 20.0% = 200
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
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.0% = 5000
          threshold: convertPercentToThreshold(thresholdPercent), // 20.0% = 200
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
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.0% = 5000
          threshold: convertPercentToThreshold(thresholdPercent), // 20.0% = 200
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
          single: restrictedKey1Bytes as Uint8Array<ArrayBuffer>
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
          single: restrictedKey2Bytes as Uint8Array<ArrayBuffer>
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

    // Coin Denomination (always required)
    const denominationName = 'base'; // Name of the denomination
    const denominationAmount = '1000000000000000000'; // 1 base unit = 1 token (18 decimals)
    const coinDenomination = create(CoinDenominationSchema, {
      denominationName,
      amount: denominationAmount
    });

    // Premint Wallets
    // NOTE: Premint wallets can ONLY be used with TOKEN contract type (not NFT or SBT)
    // Specify amounts in decimal format (e.g., 1.5 for 1.5 tokens)
    // The helper function will convert to parts based on the denomination
    let premintWallets;
    if (USE_PREMINT_WALLETS) {
      // Validate that contract type is TOKEN
      if (CONTRACT_TYPE_SELECTION !== 'TOKEN') {
        throw new Error(
          'Premint wallets can only be used with TOKEN contract type. ' +
          `Current contract type is ${CONTRACT_TYPE_SELECTION}. ` +
          'Please set USE_PREMINT_WALLETS to false or change CONTRACT_TYPE_SELECTION to \'TOKEN\'.'
        );
      }
      
      // Use coinDenomination (always available)
      const denominationForConversion = coinDenomination.amount;
      
      premintWallets = [
        create(PreMintWalletSchema, {
          address: sanitizeAndDecodeAddress(TEST_WALLET_ADDRESSES.alice) as Uint8Array<ArrayBuffer>, // Alice's address
          // Convert 1 token to parts
          amount: convertAmountToParts(1.0, contractId, denominationForConversion)
        }),
        create(PreMintWalletSchema, {
          address: sanitizeAndDecodeAddress(TEST_WALLET_ADDRESSES.bob) as Uint8Array<ArrayBuffer>, // Bob's address
          // Convert 0.5 tokens to parts
          amount: convertAmountToParts(0.5, contractId, denominationForConversion)
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
          value: 'Example token contract'
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

    // Max Supply Release
    let maxSupplyRelease;
    if (USE_MAX_SUPPLY_RELEASE) {
      // Use coinDenomination (always available)
      const denominationForConversion = coinDenomination.amount;
      
      const releaseDate1 = new Date();
      releaseDate1.setFullYear(releaseDate1.getFullYear() + 1);
      const maxSupplyRelease1 = create(MaxSupplyReleaseSchema, {
        releaseDate: create(TimestampSchema, {
          seconds: protoInt64.parse(Math.floor(releaseDate1.getTime() / 1000)),
          nanos: (releaseDate1.getTime() % 1000) * 1000000
        }),
        // Convert 10 tokens to parts
        amount: convertAmountToParts(10, contractId, denominationForConversion)
      });

      const releaseDate2 = new Date();
      releaseDate2.setFullYear(releaseDate2.getFullYear() + 2);
      const maxSupplyRelease2 = create(MaxSupplyReleaseSchema, {
        releaseDate: create(TimestampSchema, {
          seconds: protoInt64.parse(Math.floor(releaseDate2.getTime() / 1000)),
          nanos: (releaseDate2.getTime() % 1000) * 1000000
        }),
        // Convert 5 tokens to parts
        amount: convertAmountToParts(5, contractId, denominationForConversion)
      });

      maxSupplyRelease = [maxSupplyRelease1, maxSupplyRelease2];
    }

    // ============================================
    // Build contract options
    // ============================================
    // Convert contract type string to enum value
    const contractType = CONTRACT_TYPE[CONTRACT_TYPE_SELECTION];
    
    // Max supply is always required - convert 1000 tokens to parts
    const maxSupply = convertAmountToParts(1000, contractId, coinDenomination.amount);
    
    const options: CreateContractOptions = {
      contractVersion,
      symbol,
      name,
      type: contractType,
      contractId,
      publicKeyBase58Identifier,
      privateKeyBase58,
      feeId,
      memo,
      maxSupply, // Always required
      ...(USE_GOVERNANCE && { governance }),
      ...(USE_RESTRICTED_KEYS && restrictedKeys && { restrictedKeys }),
      ...(USE_CONTRACT_FEES && contractFees && { contractFees }),
      ...(USE_PREMINT_WALLETS && premintWallets && { premintWallets }),
      coinDenomination, // Always required
      ...(USE_CUSTOM_PARAMETERS && customParameters && { customParameters }),
      ...(USE_EXPENSE_RATIO && expenseRatio && { expenseRatio }),
      ...(USE_TOKEN_COMPLIANCE && tokenCompliance && { tokenCompliance }),
      ...(USE_MAX_SUPPLY_RELEASE && maxSupplyRelease && { maxSupplyRelease }),
      ...(USE_KYC && { 
        kycStatus: true,
        immutableKycStatus: false 
      }),
      ...(USE_QUASH_THRESHOLD && { quashThreshold: 3 }),
      updateContractFees: USE_CONTRACT_FEES,
      updateExpenseRatio: USE_EXPENSE_RATIO,
      grpcConfig: PROTONET_GRPC_CONFIG // Use test gRPC configuration
    };

    console.log('Creating contract...');
    console.log('Enabled features:');
    console.log('  ✓ Max Supply (always required)');
    if (USE_GOVERNANCE) console.log('  ✓ Governance');
    if (USE_RESTRICTED_KEYS) console.log('  ✓ Restricted Keys');
    if (USE_CONTRACT_FEES) console.log('  ✓ Contract Fees');
    if (USE_PREMINT_WALLETS) console.log('  ✓ Premint Wallets');
    console.log('  ✓ Coin Denomination (always required)');
    if (USE_CUSTOM_PARAMETERS) console.log('  ✓ Custom Parameters');
    if (USE_EXPENSE_RATIO) console.log('  ✓ Expense Ratio');
    if (USE_TOKEN_COMPLIANCE) console.log('  ✓ Token Compliance');
    if (USE_MAX_SUPPLY_RELEASE) console.log('  ✓ Max Supply Release');
    if (USE_KYC) console.log('  ✓ KYC Status');
    if (USE_QUASH_THRESHOLD) console.log('  ✓ Quash Threshold');

    const contract = await createContractTXN(options);
    
    console.log('\n✓ Contract created successfully!');
    console.log(`Contract ID: ${contract.contractId}`);
    console.log(`Symbol: ${contract.symbol}`);
    console.log(`Name: ${contract.name}`);
    
    // Send to network (uncomment to actually submit)
    // console.log('\nSubmitting contract to network...');
    // const hash = await sendContractTXN(contract, PROTONET_GRPC_CONFIG);
    // console.log(`✓ Contract submitted with hash: ${hash}`);
    
  } catch (error) {
    console.error('Error creating contract:', error);
    throw error;
  }
}


/**
 * #SEND IT
 */
async function first(): Promise<void> {
  try {
    // ============================================
    // CONFIGURATION - Set these to true/false
    // ============================================
    const USE_GOVERNANCE = true;
    const USE_RESTRICTED_KEYS = true;
    const USE_CONTRACT_FEES = false;
    const USE_PREMINT_WALLETS = true;
    const USE_CUSTOM_PARAMETERS = true;
    const USE_EXPENSE_RATIO = false;
    const USE_TOKEN_COMPLIANCE = false;
    const USE_MAX_SUPPLY_RELEASE = false;
    const USE_KYC = false;
    const USE_QUASH_THRESHOLD = false;

    // Basic contract info
    const contractVersion = BigInt(1000000);
    const CONTRACT_TYPE_SELECTION = 'TOKEN' as 'TOKEN' | 'NFT' | 'SBT';
    const name = 'First';
    const contractId = 'FIRST0000'; // must be unique on the network
    const symbol = 'FIRST';

    // Use Alice's test keys for contract creation
    const publicKeyBase58Identifier = ED25519_TEST_KEYS.alice.publicKey;
    const privateKeyBase58 = ED25519_TEST_KEYS.alice.privateKey;
    const feeId = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
    const memo = 'literally nothing but being first';
    // ============================================
    // Build optional features based on flags
    // ============================================
    
    // Governance
    let governance: Governance | undefined;
    if (USE_GOVERNANCE) {

      // Specify percentages in human-readable format (e.g., 50.5 for 50.5%)
      // Change this value to switch between governance types
      const GOVERNANCE_TYPE_SELECTION = 'STAGGERED' as 'STAGED' | 'CYCLE' | 'STAGGERED' | 'ADAPTIVE';
      const regularQuorumPercent = 75; // percent of yes votes needed to pass
      const thresholdPercent = 2.50; // minimum amount of circulating supply needed for vote to be considered valid
      
      // Build governance based on selected type - explicit examples for each type
      if (GOVERNANCE_TYPE_SELECTION === 'STAGED') {
        // STAGED governance: Multiple stages of governance, must pass quorum to get to next stage and if max approved specified proposals through determined by passing quorum + total number of votes. Meaning that a technical pass of quroum and threshold does not mean the proposal will make it to the next stage.

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
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.0% = 5000
          threshold: convertPercentToThreshold(thresholdPercent), // 20.0% = 200
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
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.0% = 5000
          threshold: convertPercentToThreshold(thresholdPercent), // 20.0% = 200
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
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.0% = 5000
          threshold: convertPercentToThreshold(thresholdPercent), // 20.0% = 200
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
          regularQuorum: convertPercentToRegularQuorum(regularQuorumPercent), // 50.0% = 5000
          threshold: convertPercentToThreshold(thresholdPercent), // 20.0% = 200
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
      const restrictedKey1PublicKeyId = 'r_A_AbvUDYs9jmmwikjFojpwLvzNTYp4kwhkv2btkeHk3EkY';
      const restrictedKey1Bytes = getPublicKeyBytes(restrictedKey1PublicKeyId);
      const restrictedKey1 = create(RestrictedKeySchema, {
        publicKey: create(PublicKeySchema, {
          single: restrictedKey1Bytes as Uint8Array<ArrayBuffer>
        }),
        //timeDelay: BigInt(86400), // 1 day delay
        global: false,
        createContractUpdateTXN: true,
        transfer: true,
        quash: false,
        mint: false,
        vote: true,
        propose: true,
        compliance: false,
        expenseRatio: false,
        revoke: false,
        keyWeight: 0
      });

      restrictedKeys = [restrictedKey1];
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

    // Coin Denomination (always required)
    const denominationName = 'firsties'; // Name of the denomination
    const denominationAmount = '1000000000';
    const coinDenomination = create(CoinDenominationSchema, {
      denominationName,
      amount: denominationAmount
    });

    // Premint Wallets
    // NOTE: Premint wallets can ONLY be used with TOKEN contract type (not NFT or SBT)
    // Specify amounts in decimal format (e.g., 1.5 for 1.5 tokens)
    // The helper function will convert to parts based on the denomination
    let premintWallets;
    if (USE_PREMINT_WALLETS) {
      // Validate that contract type is TOKEN
      if (CONTRACT_TYPE_SELECTION !== 'TOKEN') {
        throw new Error(
          'Premint wallets can only be used with TOKEN contract type. ' +
          `Current contract type is ${CONTRACT_TYPE_SELECTION}. ` +
          'Please set USE_PREMINT_WALLETS to false or change CONTRACT_TYPE_SELECTION to \'TOKEN\'.'
        );
      }
      
      // Use coinDenomination (always available)
      const denominationForConversion = coinDenomination.amount;
      
      premintWallets = [
        create(PreMintWalletSchema, {
          address: sanitizeAndDecodeAddress('4xm3gAmp4WnWHFJmq1dmh6Nci6ncYFEoj3aAXW2LxUgh') as Uint8Array<ArrayBuffer>,
          amount: convertAmountToParts(7000000000000000, contractId, denominationForConversion)
        }),
        create(PreMintWalletSchema, {
          address: sanitizeAndDecodeAddress('EgzTZj6oaJX3yfNJ1qHHBfKrV8QLyJtmsSiAC7d24WFz') as Uint8Array<ArrayBuffer>,
          amount: convertAmountToParts(7000000000000000, contractId, denominationForConversion)
        }),
        create(PreMintWalletSchema, {
          address: sanitizeAndDecodeAddress('ALHSQw6sa8WMkKRoyhKiU2gbtkX6F16r1Dk2qZFGCb7o') as Uint8Array<ArrayBuffer>,
          amount: convertAmountToParts(7000000000000000, contractId, denominationForConversion)
        }),
        create(PreMintWalletSchema, {
          address: sanitizeAndDecodeAddress('8Qx2ccahAWvz5rgaJkyTR7gzEFYBeyKrmmDJfsiCqWST') as Uint8Array<ArrayBuffer>,
          amount: convertAmountToParts(7000000000000000, contractId, denominationForConversion)
        }),
        create(PreMintWalletSchema, {
          address: sanitizeAndDecodeAddress('EYiudHzvJ3L85ximkbdnpobaX8D9eD46XuBEiPfY3ge2') as Uint8Array<ArrayBuffer>,
          amount: convertAmountToParts(7000000000000000, contractId, denominationForConversion)
        }),
        create(PreMintWalletSchema, {
          address: sanitizeAndDecodeAddress('DD191RJ8wKNDHihEtdWt3AdSqsWnJR5NnrX9TVihpLfX') as Uint8Array<ArrayBuffer>,
          amount: convertAmountToParts(7000000000000000, contractId, denominationForConversion)
        })
      ];
    }

    // Custom Parameters
    let customParameters;
    if (USE_CUSTOM_PARAMETERS) {
      customParameters = [
        create(KeyValuePairSchema, {
          key: 'uri',
          value: 'https://cdn.zerafile.io/token/FIRST0000/uri-Y0Xqp3MHiPn1.json'
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

    // Max Supply Release
    let maxSupplyRelease;
    if (USE_MAX_SUPPLY_RELEASE) {
      // Use coinDenomination (always available)
      const denominationForConversion = coinDenomination.amount;
      
      const releaseDate1 = new Date();
      releaseDate1.setFullYear(releaseDate1.getFullYear() + 1);
      const maxSupplyRelease1 = create(MaxSupplyReleaseSchema, {
        releaseDate: create(TimestampSchema, {
          seconds: protoInt64.parse(Math.floor(releaseDate1.getTime() / 1000))
        }),
        // Convert 10 tokens to parts
        amount: convertAmountToParts(10, contractId, denominationForConversion)
      });

      const releaseDate2 = new Date();
      releaseDate2.setFullYear(releaseDate2.getFullYear() + 2);
      const maxSupplyRelease2 = create(MaxSupplyReleaseSchema, {
        releaseDate: create(TimestampSchema, {
          seconds: protoInt64.parse(Math.floor(releaseDate2.getTime() / 1000)),
          nanos: (releaseDate2.getTime() % 1000) * 1000000
        }),
        // Convert 5 tokens to parts
        amount: convertAmountToParts(5, contractId, denominationForConversion)
      });

      maxSupplyRelease = [maxSupplyRelease1, maxSupplyRelease2];
    }

    // ============================================
    // Build contract options
    // ============================================
    // Convert contract type string to enum value
    const contractType = CONTRACT_TYPE[CONTRACT_TYPE_SELECTION];
    
    // Max supply is always required
    const maxSupply = convertAmountToParts(42000000000000000, contractId, coinDenomination.amount);
    
    const options: CreateContractOptions = {
      contractVersion,
      symbol,
      name,
      type: contractType,
      contractId,
      publicKeyBase58Identifier,
      privateKeyBase58,
      feeId,
      memo,
      maxSupply, // Always required
      ...(USE_GOVERNANCE && { governance }),
      ...(USE_RESTRICTED_KEYS && restrictedKeys && { restrictedKeys }),
      //...(USE_CONTRACT_FEES && contractFees && { contractFees }),
      ...(USE_PREMINT_WALLETS && premintWallets && { premintWallets }),
      coinDenomination, // Always required
      ...(USE_CUSTOM_PARAMETERS && customParameters && { customParameters }),
      //...(USE_EXPENSE_RATIO && expenseRatio && { expenseRatio }),
      //...(USE_TOKEN_COMPLIANCE && tokenCompliance && { tokenCompliance }),
      //...(USE_MAX_SUPPLY_RELEASE && maxSupplyRelease && { maxSupplyRelease }),
      // ...(USE_KYC && { 
      //   kycStatus: true,
      //   immutableKycStatus: false 
      // }),
      // ...(USE_QUASH_THRESHOLD && { quashThreshold: 3 }),
      updateContractFees: USE_CONTRACT_FEES,
      updateExpenseRatio: USE_EXPENSE_RATIO
    };

    console.log('Creating contract...');
    console.log('Enabled features:');
    console.log('  ✓ Max Supply (always required)');
    if (USE_GOVERNANCE) console.log('  ✓ Governance');
    if (USE_RESTRICTED_KEYS) console.log('  ✓ Restricted Keys');
    if (USE_CONTRACT_FEES) console.log('  ✓ Contract Fees');
    if (USE_PREMINT_WALLETS) console.log('  ✓ Premint Wallets');
    console.log('  ✓ Coin Denomination (always required)');
    if (USE_CUSTOM_PARAMETERS) console.log('  ✓ Custom Parameters');
    if (USE_EXPENSE_RATIO) console.log('  ✓ Expense Ratio');
    if (USE_TOKEN_COMPLIANCE) console.log('  ✓ Token Compliance');
    if (USE_MAX_SUPPLY_RELEASE) console.log('  ✓ Max Supply Release');
    if (USE_KYC) console.log('  ✓ KYC Status');
    if (USE_QUASH_THRESHOLD) console.log('  ✓ Quash Threshold');

    // Note best to overestimate fee. Fee provided here is for contract #1. As more contractID's that are equal are created cost increases exponentially.
    const contract = await createContractTXN(options);
    
    console.log('\n✓ Contract created successfully!');
    console.log(`Contract ID: ${contract.contractId}`);
    console.log(`Symbol: ${contract.symbol}`);
    console.log(`Name: ${contract.name}`);
    
    console.log('\nSubmitting contract to network...');
    const hash = await sendContractTXN(contract, PROTONET_GRPC_CONFIG);
    console.log(`✓ Contract submitted with hash: ${hash}`);

  } catch (error) {
    console.error('Error creating contract:', error);
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
    // CONTRACT_TYPE and CoinDenomination imported at file top

    // Minimal contract creation with manual nonce
    const coinDenomination = create(CoinDenominationSchema, {
      denominationName: 'base',
      amount: '1000000000000000000'
    });

    const options: CreateContractOptions = {
      contractVersion: BigInt(1000000),
      symbol: 'TEST',
      name: 'Test Token',
      type: CONTRACT_TYPE.TOKEN,
      contractId: 'TEST0000',
      publicKeyBase58Identifier: ED25519_TEST_KEYS.alice.publicKey,
      privateKeyBase58: ED25519_TEST_KEYS.alice.privateKey,
      coinDenomination,
      maxSupply: '1000000000000000000000',
      memo: 'Contract with manual nonce',
      grpcConfig: PROTONET_GRPC_CONFIG,
      // Manual nonce - skips network fetch
      // WARNING: Not validated! Incorrect nonce will cause transaction failure
      nonce: '10'
    };

    console.log('Creating contract with manual nonce...');
    const contract = await createContractTXN(options);

    console.log('✓ Contract created with manual nonce: 10');
    console.log(`Contract ID: ${contract.contractId}`);
    console.log('WARNING: Manual nonce is not validated!');

    // Note: This will likely fail if the nonce is incorrect
    // const hash = await sendContractTXN(contract, PROTONET_GRPC_CONFIG);
    // console.log(`✓ Contract submitted with hash: ${hash}`);

  } catch (error) {
    console.error('Error creating contract:', error);
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
    // CONTRACT_TYPE and CoinDenomination imported at file top

    // Minimal contract creation with manual nonce and fee
    const coinDenomination = create(CoinDenominationSchema, {
      denominationName: 'base',
      amount: '1000000000000000000'
    });

    const options: CreateContractOptions = {
      contractVersion: BigInt(1000000),
      symbol: 'TEST',
      name: 'Test Token',
      type: CONTRACT_TYPE.TOKEN,
      contractId: 'TEST0000',
      publicKeyBase58Identifier: ED25519_TEST_KEYS.alice.publicKey,
      privateKeyBase58: ED25519_TEST_KEYS.alice.privateKey,
      coinDenomination,
      maxSupply: '1000000000000000000000',
      memo: 'Fully offline contract creation',
      grpcConfig: PROTONET_GRPC_CONFIG,
      // Manual nonce - skips network nonce fetch
      nonce: '15',
      // Manual fee - skips fee calculation, used exactly as provided (no overestimation)
      feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      feeAmountParts: '500000000' // 0.5 KALV in smallest units - used exactly!
    };

    console.log('Creating contract fully offline...');
    const contract = await createContractTXN(options);

    console.log('✓ Contract created fully offline:');
    console.log('  Manual nonce: 15');
    console.log('  Manual fee: 500000000 (0.5 KALV) - used exactly, no overestimation');
    console.log(`  Contract ID: ${contract.contractId}`);
    console.log('  WARNING: These values are not validated!');

  } catch (error) {
    console.error('Error creating contract:', error);
    throw error;
  }
}