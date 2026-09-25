/**
 * VoteTXN Examples
 *
 * This file demonstrates how to create and send GovernanceVote transactions
 * using the SDK. Fee ID defaults to KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao and base fees are auto-calculated
 * when omitted.
 */

import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS } from '../../test-utils/index.js';
import { createVoteTXN, sendVoteTXN } from '../index.js';

function section(title: string) {
  console.log(`\n==== ${title} ====`);
}

const contractId = 'contract id (ie KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao)';
const proposalIdHex = '11111111111111';
const publicKeyId = ED25519_TEST_KEYS.alice.publicKey;
const privateKeyBase58 = ED25519_TEST_KEYS.alice.privateKey;

async function exampleSupportVote() {
  section('Support Vote (auto fee)');

  const voteTxn = await createVoteTXN(
    contractId,
    proposalIdHex,
    publicKeyId,
    privateKeyBase58,
    { support: true, memo: 'Voting Support', grpcConfig: PROTONET_GRPC_CONFIG }
  );

  const txHashHex = await sendVoteTXN(voteTxn, PROTONET_GRPC_CONFIG);
  console.log('Submitted VoteTXN. Hash:', txHashHex);
}

async function exampleAgainstVote() {
  section('Against Vote (auto fee)');

  const voteTxn = await createVoteTXN(
    contractId,
    proposalIdHex,
    publicKeyId,
    privateKeyBase58,
    { support: false, memo: 'Voting Against', grpcConfig: PROTONET_GRPC_CONFIG }
  );

  const txHashHex = await sendVoteTXN(voteTxn, PROTONET_GRPC_CONFIG);
  console.log('Submitted VoteTXN (against). Hash:', txHashHex);
}

async function exampleMultiOptionVote() {
  section('Multi-Option Vote (choose option index)');

  // Choose option 2 (example)
  const supportOption = 2;

  const voteTxn = await createVoteTXN(
    contractId,
    proposalIdHex,
    publicKeyId,
    privateKeyBase58,
    { supportOption, memo: `Voting for option ${supportOption}`, grpcConfig: PROTONET_GRPC_CONFIG }
  );

  const txHashHex = await sendVoteTXN(voteTxn, PROTONET_GRPC_CONFIG);
  console.log('Submitted VoteTXN (multi-option). Hash:', txHashHex);
}

async function exampleExplicitFee() {
  section('Vote with explicit base fee');

  // Provide explicit base fee (in parts); skips auto calculation
  // Manual fees are used exactly as provided (no overestimation)
  const voteTxn = await createVoteTXN(
    contractId,
    proposalIdHex,
    publicKeyId,
    privateKeyBase58,
    {
      support: true,
      memo: 'Voting yes (explicit fee)',
      feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      feeAmountParts: '1000000000000000',
      grpcConfig: PROTONET_GRPC_CONFIG
    }
  );

  const txHashHex = await sendVoteTXN(voteTxn, PROTONET_GRPC_CONFIG);
  console.log('Submitted VoteTXN. Hash:', txHashHex);
}

async function exampleCustomOverestimate() {
  section('Vote with custom overestimate percent');

  // Customize the overestimate percentage (default is 5.0%)
  // Use 0% for no overestimate, or higher values for more buffer
  const voteTxn = await createVoteTXN(
    contractId,
    proposalIdHex,
    publicKeyId,
    privateKeyBase58,
    {
      support: true,
      memo: 'Voting with custom overestimate',
      overestimatePercent: 0, // No overestimate buffer
      grpcConfig: PROTONET_GRPC_CONFIG
    }
  );

  const txHashHex = await sendVoteTXN(voteTxn, PROTONET_GRPC_CONFIG);
  console.log('Submitted VoteTXN (0% overestimate). Hash:', txHashHex);
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
async function exampleManualNonce() {
  section('Vote with manual nonce (skips network fetch)');

  const voteTxn = await createVoteTXN(
    contractId,
    proposalIdHex,
    publicKeyId,
    privateKeyBase58,
    {
      support: true,
      memo: 'Vote with manual nonce',
      grpcConfig: PROTONET_GRPC_CONFIG,
      // Manual nonce - skips network fetch
      // WARNING: Not validated! Incorrect nonce will cause transaction failure
      nonce: '10'
    }
  );

  console.log('Transaction created with manual nonce: 10');
  // Note: This will likely fail if the nonce is incorrect
  // const txHashHex = await sendVoteTXN(voteTxn, PROTONET_GRPC_CONFIG);
  // console.log('Submitted VoteTXN. Hash:', txHashHex);
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
exampleFullyOffline();
async function exampleFullyOffline() {
  section('Vote: Fully offline (manual nonce + fee)');

  const voteTxn = await createVoteTXN(
    contractId,
    proposalIdHex,
    publicKeyId,
    privateKeyBase58,
    {
      support: true,
      memo: 'Fully offline vote transaction',
      grpcConfig: PROTONET_GRPC_CONFIG,
      // Manual nonce - skips network nonce fetch
      nonce: '15',
      // Manual fee - skips fee calculation, used exactly as provided (no overestimation)
      feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      feeAmountParts: '500000000' // 0.5 KALV in smallest units - used exactly!
    }
  );

  console.log('Transaction created fully offline:');
  console.log('  Manual nonce: 15');
  console.log('  Manual fee: 500000000 (0.5 KALV) - used exactly, no overestimation');
  console.log('  WARNING: These values are not validated!');
}


