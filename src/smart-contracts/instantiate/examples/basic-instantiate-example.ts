/**
 * SmartContractInstantiateTXN examples.
 *
 * These examples use manual nonce and fee values so they can be built offline.
 * Uncomment the send calls only when the nonce, fee, contract, and keys are valid
 * for the target network.
 */

import { PROTONET_GRPC_CONFIG } from '../../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS } from '../../../test-utils/index.js';
import {
  buildSmartContractInstantiateTXN,
  createSmartContractInstantiateTXN,
  sendSmartContractInstantiateTXN,
  ParamType,
  type InstantiateParameter
} from '../index.js';

function section(title: string) {
  console.log(`\n==== ${title} ====`);
}

const publicKeyBase58Identifier = ED25519_TEST_KEYS.alice.publicKey;
const privateKeyBase58 = ED25519_TEST_KEYS.alice.privateKey;

const parameters: InstantiateParameter[] = [
  { type: ParamType.STRING, value: 'owner-wallet-address' },
  { type: ParamType.UINT64, value: 1000 }
];

async function exampleBuildUnsignedInstantiate() {
  section('Build unsigned instantiate');

  const unsigned = await buildSmartContractInstantiateTXN({
    smartContractName: 'hello_contract',
    instance: 1,
    parameters,
    publicKeyBase58Identifier,
    memo: 'Build unsigned instantiate',
    grpcConfig: PROTONET_GRPC_CONFIG,
    nonce: '20',
    feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    feeAmountParts: '500000000'
  });

  console.log('Unsigned instantiate transaction type:', unsigned.$typeName);
  console.log('Smart contract instance:', unsigned.instance);
}

async function exampleCreateSignedInstantiate() {
  section('Create signed instantiate');

  const txn = await createSmartContractInstantiateTXN({
    smartContractName: 'hello_contract',
    instance: 1,
    parameters,
    publicKeyBase58Identifier,
    privateKeyBase58,
    memo: 'Create signed instantiate',
    grpcConfig: PROTONET_GRPC_CONFIG,
    nonce: '21',
    feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    feeAmountParts: '500000000'
  });

  console.log('Signed instantiate hash bytes:', txn.base?.hash?.length ?? 0);
  if (process.env.KALVORA_SUBMIT_EXAMPLES === 'true') {
    const hash = await sendSmartContractInstantiateTXN(txn, PROTONET_GRPC_CONFIG);
    console.log('Submitted SmartContractInstantiateTXN. Hash:', hash);
  }
}

async function main() {
  await exampleBuildUnsignedInstantiate();
  await exampleCreateSignedInstantiate();
}

void main();
