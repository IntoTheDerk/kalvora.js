/**
 * CoinTXN Examples — needsInitialization Override
 *
 * Demonstrates how to use the `needsInitialization` option in FeeConfig
 * to control the per-address initialization fee for token transfers.
 *
 * By default, the SDK calls getBalance() to check if the recipients
 * already hold the transferred token. If they don't, the network-sourced
 * new_wallet_fee is added per address. The `needsInitialization` flag
 * lets you skip that API call.
 */

import { PROTONET_GRPC_CONFIG } from '../../shared/utils/testing-defaults/index.js';
import { ED25519_TEST_KEYS, TEST_WALLET_ADDRESSES } from '../../test-utils/index.js';
import { createCoinTXN, sendCoinTXN } from '../index.js';

const contractId = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
const grpcConfig = PROTONET_GRPC_CONFIG;

/**
 * Example 1: Default behavior (auto-detect)
 * 
 * When `needsInitialization` is not set (undefined), the SDK calls getBalance()
 * for the sender and each recipient. If any address has a zero balance for the
 * token, the new_wallet_fee is added to the base fee per such address.
 */
exampleAutoDetect(); 
async function exampleAutoDetect() {
  console.log('\n==== Auto-detect (default) ====');

  const txn = await createCoinTXN(
    [{ privateKey: ED25519_TEST_KEYS.alice.privateKey, publicKey: ED25519_TEST_KEYS.alice.publicKey, amount: '10' }],
    [{ to: TEST_WALLET_ADDRESSES.alice, amount: '10' }],
    contractId,
    { baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' },          // needsInitialization is undefined — auto-detect via API
    '',
    grpcConfig
  );

  console.log('Transaction created with auto-detected initialization fee');
  const txHash = await sendCoinTXN(txn, grpcConfig);
  console.log('Submitted. Hash:', txHash);
}

/**
 * Example 2: Force initialization fee (needsInitialization = true)
 * 
 * When you KNOW the recipient doesn't have the token yet, set `needsInitialization: true`
 * to skip the balance check API call and always include the initialization fee.
 * 
 * This saves a network round-trip and is useful when:
 * - You just created a new wallet and are sending its first tokens
 * - You want to avoid the extra latency of a balance lookup
 * - You're building offline and can't make API calls
 */
async function exampleForceInitialization() {
  console.log('\n==== Force initialization fee (skip API) ====');

  const txn = await createCoinTXN(
    [{ privateKey: ED25519_TEST_KEYS.alice.privateKey, publicKey: ED25519_TEST_KEYS.alice.publicKey, amount: '10' }],
    [{ to: TEST_WALLET_ADDRESSES.bob, amount: '10' }],
    contractId,
    {
      baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      needsInitialization: true           // Always add initialization fee per address — no API call
    },
    '',
    grpcConfig
  );

  console.log('Transaction created with forced initialization fee (no balance check)');
  const txHash = await sendCoinTXN(txn, grpcConfig);
  console.log('Submitted. Hash:', txHash);
}

/**
 * Example 3: Skip initialization fee (needsInitialization = false)
 * 
 * When you KNOW the recipient already has the token, set `needsInitialization: false`
 * to skip both the balance check and the fee.
 * 
 * This is useful when:
 * - You're sending between your own wallets that already hold the token
 * - You've already confirmed the recipient's balance in your application logic
 * - You want the smallest possible fee
 */
async function exampleSkipInitialization() {
  console.log('\n==== Skip initialization fee (skip API) ====');

  const txn = await createCoinTXN(
    [{ privateKey: ED25519_TEST_KEYS.alice.privateKey, publicKey: ED25519_TEST_KEYS.alice.publicKey, amount: '10' }],
    [{ to: TEST_WALLET_ADDRESSES.bob, amount: '10' }],
    contractId,
    {
      baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      needsInitialization: false          // Never add initialization fee — no API call
    },
    '',
    grpcConfig
  );

  console.log('Transaction created without initialization fee (no balance check)');
  const txHash = await sendCoinTXN(txn, grpcConfig);
  console.log('Submitted. Hash:', txHash);
}

/**
 * Example 4: Combine with other fee options
 * 
 * `needsInitialization` works alongside all other FeeConfig options.
 */
async function exampleCombinedOptions() {
  console.log('\n==== Combined with overestimate and interface fee ====');

  const txn = await createCoinTXN(
    [{ privateKey: ED25519_TEST_KEYS.alice.privateKey, publicKey: ED25519_TEST_KEYS.alice.publicKey, amount: '10' }],
    [{ to: TEST_WALLET_ADDRESSES.bob, amount: '10' }],
    contractId,
    {
      baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      overestimatePercent: 10,            // 10% overestimate buffer on base fee
      needsInitialization: true           // Always add initialization fee
    },
    'Transfer with initialization',
    grpcConfig
  );

  console.log('Transaction created with combined fee options');
  const txHash = await sendCoinTXN(txn, grpcConfig);
  console.log('Submitted. Hash:', txHash);
}