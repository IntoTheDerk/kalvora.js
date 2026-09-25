/**
 * Adapter Example — Governance Vote
 *
 * Demonstrates how to build, sign, and (optionally) send a governance vote
 * without ever exposing a private key to the SDK.
 *
 * The flow is:
 *   1. buildVoteTXN()  — construct the protobuf, calc fees
 *   2. serializeTransaction()  — portable JSON envelope (for transport)
 *   3. signAndFinalize()       — sign with any KalvoraSigner implementation
 *   4. sendVoteTXN()           — submit to the network
 */

import type { GovernanceVote } from '../../../proto/generated/txn_pb.js';
import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import { sendVoteTXN } from '../../vote/index.js';
import {
  buildVoteTXN,
  signAndFinalize,
  serializeTransaction,
  deserializeTransaction,
  KeyPairSigner
} from '../index.js';

// ============================================================================
// Example 1: Basic vote with KeyPairSigner
// ============================================================================

export async function exampleBasicVote(): Promise<void> {
  console.log('🗳️  Example 1: Basic Governance Vote via Adapter');

  const alice = ED25519_TEST_KEYS.alice;
  const signer = new KeyPairSigner(alice.publicKey, alice.privateKey);

  // Step 1 — Build unsigned
  const unsigned = await buildVoteTXN(
    'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    'aabbccddee001122',  // proposal ID in hex
    alice.publicKey,
    {
      support: true,
      memo: 'I support this!',
      grpcConfig: PROTONET_GRPC_CONFIG,
      feeAmountParts: '1'
    }
  );
  console.log('  ✅ Unsigned vote built (no signature, no hash yet)');

  // Step 2 — Sign
  const signed = await signAndFinalize(unsigned, signer);
  console.log('  ✅ Vote signed —', signed.base?.signature ? 'signature present' : 'ERROR');
  console.log('  ✅ Hash added —', signed.base?.hash ? 'hash present' : 'ERROR');

  // Step 3 — (Optional) send
  // const result = await sendVoteTXN(signed, PROTONET_GRPC_CONFIG);
  // console.log('  🎉 Sent:', result);
}

// ============================================================================
// Example 2: Serialize for remote signing
// ============================================================================

export async function exampleRemoteSignVote(): Promise<void> {
  console.log('🗳️  Example 2: Remote-Signed Governance Vote');

  const alice = ED25519_TEST_KEYS.alice;

  // Build unsigned on "frontend"
  const unsigned = await buildVoteTXN(
    'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
    'aabbccddee001122',
    alice.publicKey,
    {
      supportOption: 2,  // multi-option vote
      grpcConfig: PROTONET_GRPC_CONFIG,
      feeAmountParts: '1'
    }
  );

  // Serialize — this JSON can be sent over HTTP / WebSocket / etc.
  const envelope = serializeTransaction(unsigned);
  const json = JSON.stringify(envelope);
  console.log('  📦 Serialized envelope:', json.length, 'bytes');

  // On the "signing device" — deserialize, sign, send back
  const restored = deserializeTransaction(json) as GovernanceVote;
  const signer = new KeyPairSigner(alice.publicKey, alice.privateKey);
  const signed = await signAndFinalize(restored, signer);

  console.log('  ✅ Signed remotely —', signed.base?.signature ? 'ok' : 'ERROR');
}
