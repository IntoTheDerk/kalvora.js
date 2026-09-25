/**
 * SmartContractExecuteTXN Examples
 *
 * This file demonstrates how to create and send SmartContractExecute transactions
 * using the SDK. Fee ID defaults to KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao and base fees are auto-calculated
 * when omitted.
 */

import { PROTONET_GRPC_CONFIG } from '../../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS } from '../../../test-utils/index.js';
import { createSmartContractExecuteTXN, sendSmartContractExecuteTXN, type ExecuteParameter, ParamType } from '../index.js';

function section(title: string) {
  console.log(`\n==== ${title} ====`);
}

const publicKeyId = ED25519_TEST_KEYS.alice.publicKey;
const privateKeyBase58 = ED25519_TEST_KEYS.alice.privateKey;

async function exampleExecuteNoParams() {
  section('Execute: No Parameters (auto fee)');

  const txn = await createSmartContractExecuteTXN(
    'basic_test_v1',
    1,
    'no_params',
    [],
    publicKeyId,
    privateKeyBase58,
    { memo: 'test no params', gasFeeInUsd: 0.05, grpcConfig: PROTONET_GRPC_CONFIG }
  );

  const hash = await sendSmartContractExecuteTXN(txn, PROTONET_GRPC_CONFIG);
  console.log('Submitted SmartContractExecute. Hash:', hash);
}

async function exampleExecuteWithParams() {
  section('Execute: With Parameters (auto fee)');

  const params: ExecuteParameter[] = [
    { type: ParamType.STRING, value: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' },
    { type: ParamType.STRING, value: '1000000000' }
  ];

  const txn = await createSmartContractExecuteTXN(
    'basic_test_v1',
    1,
    'test',
    params,
    publicKeyId,
    privateKeyBase58,
    { memo: 'test params', gasFeeInUsd: 0.50, grpcConfig: PROTONET_GRPC_CONFIG }
  );

  const hash = await sendSmartContractExecuteTXN(txn, PROTONET_GRPC_CONFIG);
  console.log('Submitted SmartContractExecute. Hash:', hash);
}

async function exampleExplicitFee() {
  section('Execute: Explicit base fee');

  const params: ExecuteParameter[] = [
    { type: ParamType.BYTES, value: new Uint8Array([1, 2, 3]) }
  ];

  // Provide explicit base fee (in parts); skips auto calculation
  // Manual fees are used exactly as provided (no overestimation)
  const txn = await createSmartContractExecuteTXN(
    'MyContract',
    2,
    'submitData',
    params,
    publicKeyId,
    privateKeyBase58,
    {
      memo: 'Explicit fee',
      gasFeeInUsd: 0.05,
      feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      feeAmountParts: '1000000000000000',
      grpcConfig: PROTONET_GRPC_CONFIG
    }
  );

  const hash = await sendSmartContractExecuteTXN(txn, PROTONET_GRPC_CONFIG);
  console.log('Submitted SmartContractExecute. Hash:', hash);
}

async function exampleWithGasFee() {
  section('Execute: With gas fee (USD)');

  const params: ExecuteParameter[] = [
    { type: ParamType.STRING, value: 'complex operation' },
    { type: ParamType.UINT64, value: '1000' }
  ];

  // Add gas fee: 0.05 USD (5 cents) for computational cost
  // Simple functions may need ~0.004-0.005 USD, complex ones may need more
  const txn = await createSmartContractExecuteTXN(
    'MyContract',
    3,
    'complexFunction',
    params,
    publicKeyId,
    privateKeyBase58,
    {
      memo: 'Complex operation with gas fee',
      gasFeeInUsd: 0.05, // 5 cents USD for gas
      grpcConfig: PROTONET_GRPC_CONFIG
    }
  );

  const hash = await sendSmartContractExecuteTXN(txn, PROTONET_GRPC_CONFIG);
  console.log('Submitted SmartContractExecute with gas fee. Hash:', hash);
}

async function exampleCustomOverestimate() {
  section('Execute: With custom overestimate percent');

  const params: ExecuteParameter[] = [
    { type: ParamType.STRING, value: 'test' },
    { type: ParamType.UINT64, value: '42' }
  ];

  // Customize the overestimate percentage for base fee (default is 5.0%)
  // Note: overestimatePercent only applies to base fee, not gas fee
  // Use 0% for no overestimate, or higher values for more buffer
  const txn = await createSmartContractExecuteTXN(
    'basic_test_v1',
    1,
    'test',
    params,
    publicKeyId,
    privateKeyBase58,
    {
      memo: 'Execute with custom overestimate',
      gasFeeInUsd: 0.05,
      overestimatePercent: 0, // No overestimate buffer on base fee
      grpcConfig: PROTONET_GRPC_CONFIG
    }
  );

  const hash = await sendSmartContractExecuteTXN(txn, PROTONET_GRPC_CONFIG);
  console.log('Submitted SmartContractExecute (0% overestimate). Hash:', hash);
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
  section('Execute: With manual nonce (skips network fetch)');

  const params: ExecuteParameter[] = [
    { type: ParamType.STRING, value: 'test' }
  ];

  const txn = await createSmartContractExecuteTXN(
    'basic_test_v1',
    1,
    'test',
    params,
    publicKeyId,
    privateKeyBase58,
    {
      memo: 'Execute with manual nonce',
      gasFeeInUsd: 0.05,
      grpcConfig: PROTONET_GRPC_CONFIG,
      // Manual nonce - skips network fetch
      // WARNING: Not validated! Incorrect nonce will cause transaction failure
      nonce: '10'
    }
  );

  console.log('Transaction created with manual nonce: 10');
  // Note: This will likely fail if the nonce is incorrect
  // const hash = await sendSmartContractExecuteTXN(txn, PROTONET_GRPC_CONFIG);
  // console.log('Submitted SmartContractExecute. Hash:', hash);
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
async function exampleFullyOffline() {
  section('Execute: Fully offline (manual nonce + fee)');

  const params: ExecuteParameter[] = [
    { type: ParamType.STRING, value: 'offline test' }
  ];

  const txn = await createSmartContractExecuteTXN(
    'basic_test_v1',
    1,
    'test',
    params,
    publicKeyId,
    privateKeyBase58,
    {
      memo: 'Fully offline transaction',
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

async function main() {
  await exampleFullyOffline();

  if (process.env.KALVORA_SUBMIT_EXAMPLES === 'true') {
    await exampleExecuteNoParams();
  } else {
    console.log('');
    console.log('Set KALVORA_SUBMIT_EXAMPLES=true to run a live submit example.');
  }
}

void main();
