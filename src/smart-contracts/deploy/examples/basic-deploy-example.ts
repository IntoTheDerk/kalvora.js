/**
 * SmartContractTXN deploy examples.
 *
 * These examples use manual nonce and fee values so they can be built offline.
 * Uncomment the send calls only when the nonce, fee, code, and keys are valid for
 * the target network.
 */

import { LANGUAGE } from '../../../../proto/generated/txn_pb.js';
import { PROTONET_GRPC_CONFIG } from '../../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS } from '../../../test-utils/index.js';
import {
  buildSmartContractTXN,
  createSmartContractTXN,
  sendSmartContractTXN
} from '../index.js';

function section(title: string) {
  console.log(`\n==== ${title} ====`);
}

const publicKeyBase58Identifier = ED25519_TEST_KEYS.alice.publicKey;
const privateKeyBase58 = ED25519_TEST_KEYS.alice.privateKey;

async function exampleBuildUnsignedRustDeploy() {
  section('Build unsigned Rust deploy with source reference');

  const compiledRustWasmBytes = new Uint8Array([0, 97, 115, 109]);

  const unsigned = await buildSmartContractTXN({
    smartContractName: 'hello_contract_rust',
    binaryCode: compiledRustWasmBytes,
    sourceCode: 'ipfs://bafybeihash/hello_contract.rs',
    language: LANGUAGE.COMPILED,
    functions: ['init', 'execute'],
    publicKeyBase58Identifier,
    memo: 'Build unsigned deploy',
    grpcConfig: PROTONET_GRPC_CONFIG,
    nonce: '10',
    feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    feeAmountParts: '500000000'
  });

  console.log('Unsigned deploy transaction type:', unsigned.$typeName);
  console.log('Smart contract name:', unsigned.smartContractName);
}

async function exampleCreateSignedRustDeploy() {
  section('Create signed Rust deploy with source reference');

  const compiledRustWasmBytes = new Uint8Array([0, 97, 115, 109]);

  const txn = await createSmartContractTXN({
    smartContractName: 'hello_contract_rust',
    binaryCode: compiledRustWasmBytes,
    sourceCode: 'https://github.com/example/contracts/blob/main/src/lib.rs',
    language: LANGUAGE.COMPILED,
    functions: ['init', 'execute'],
    publicKeyBase58Identifier,
    privateKeyBase58,
    memo: 'Create signed deploy',
    grpcConfig: PROTONET_GRPC_CONFIG,
    nonce: '11',
    feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    feeAmountParts: '500000000'
  });

  console.log('Signed deploy hash bytes:', txn.base?.hash?.length ?? 0);
  if (process.env.KALVORA_SUBMIT_EXAMPLES === 'true') {
    const hash = await sendSmartContractTXN(txn, PROTONET_GRPC_CONFIG);
    console.log('Submitted SmartContractTXN. Hash:', hash);
  }
}

async function exampleCreateSignedCompiledDeploy() {
  section('Create signed Rust deploy without source reference');

  const compiledRustWasmBytes = new Uint8Array([0, 97, 115, 109]);

  const txn = await createSmartContractTXN({
    smartContractName: 'hello_contract_rust_compiled',
    binaryCode: compiledRustWasmBytes,
    language: LANGUAGE.COMPILED,
    functions: ['init', 'execute'],
    publicKeyBase58Identifier,
    privateKeyBase58,
    memo: 'Create signed compiled deploy',
    grpcConfig: PROTONET_GRPC_CONFIG,
    nonce: '12',
    feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    feeAmountParts: '500000000'
  });

  console.log('Compiled deploy hash bytes:', txn.base?.hash?.length ?? 0);
}

async function main() {
  await exampleBuildUnsignedRustDeploy();
  await exampleCreateSignedRustDeploy();
  await exampleCreateSignedCompiledDeploy();
}

void main();
