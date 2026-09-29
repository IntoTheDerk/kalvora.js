/**
 * Adapter Example — Smart Contract Execute
 *
 * Demonstrates building and signing a SmartContractExecuteTXN externally
 * via the adapter module.
 */

import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import { sendSmartContractExecuteTXN } from '../../smart-contracts/execute/index.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import {
  buildSmartContractExecuteTXN,
  signAndFinalize,
  KeyPairSigner,
  type ExecuteParameter
} from '../index.js';

// ============================================================================
// Example 1: Execute a smart contract function
// ============================================================================

export async function exampleExecuteSmartContract(): Promise<void> {
  console.log('⚡ Example 1: Smart Contract Execute via Adapter');

  const alice = ED25519_TEST_KEYS.alice;
  const signer = new KeyPairSigner(alice.publicKey, alice.privateKey);

  const parameters: ExecuteParameter[] = [
    { type: 'string', value: 'hello world' },
    { type: 'uint64', value: '42' }
  ];

  const unsigned = await buildSmartContractExecuteTXN(
    'my_contract',       // smart contract name
    0,                   // instance
    'greet',             // function name
    parameters,
    alice.publicKey,
    {
      grpcConfig: PROTONET_GRPC_CONFIG,
      feeAmountParts: '1',
      nonce: '0',
      memo: 'Hello from adapter!'
    }
  );
  console.log('  ✅ Unsigned SC execute built');
  console.log('  📋 Contract:', unsigned.smartContractName);
  console.log('  📋 Function:', unsigned.function);
  console.log('  📋 Params:',   unsigned.parameters.length);

  // Sign with external signer
  const signed = await signAndFinalize(unsigned, signer);
  console.log('  ✅ SC execute signed —', signed.base?.signature ? 'ok' : 'ERROR');

  // Send
  // const result = await sendSmartContractExecuteTXN(signed, PROTONET_GRPC_CONFIG);
  // console.log('  🎉 Sent:', result);
}

// ============================================================================
// Example 2: Custom signer (hardware wallet mock)
// ============================================================================

export async function exampleHardwareWalletExecute(): Promise<void> {
  console.log('⚡ Example 2: Hardware Wallet SC Execute');

  const alice = ED25519_TEST_KEYS.alice;

  // Simulate a hardware wallet signer
  const hwSigner = {
    publicKey: alice.publicKey,
    async sign(data: Uint8Array): Promise<Uint8Array> {
      // In real life, this would call a WebHID / USB API
      console.log('  📱 Hardware wallet signing', data.length, 'bytes...');
      const { KeyPairSigner: KPS } = await import('../signer.js');
      const inner = new KPS(alice.publicKey, alice.privateKey);
      return inner.sign(data);
    }
  };

  const unsigned = await buildSmartContractExecuteTXN(
    'bridge',
    0,
    'lock_tokens',
    [{ type: 'string', value: '1000000' }],
    alice.publicKey,
    { feeAmountParts: '1', nonce: '5' }
  );

  const signed = await signAndFinalize(unsigned, hwSigner);
  console.log('  ✅ Signed by hardware wallet —', signed.base?.signature ? 'ok' : 'ERROR');
}
