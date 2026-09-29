/**
 * Item transaction examples for NFT/SBT contracts.
 *
 * These examples use test keys and manual nonce/fee values for illustration.
 * Remove nonce/feeAmountParts in production so the SDK can fetch and calculate
 * current network values.
 */

import { ED25519_TEST_KEYS, TEST_WALLET_ADDRESSES } from '../../test-utils/keys.test.js';
import {
  buildBurnSBTTXN,
  buildItemizedMintTXN,
  buildNFTTXN,
  createItemizedMintTXN
} from '../index.js';

const alice = ED25519_TEST_KEYS.alice;

async function buildUnsignedItemMint(): Promise<void> {
  const unsigned = await buildItemizedMintTXN({
    contractId: 'NFT0001',
    itemId: 'item-001',
    recipientAddress: TEST_WALLET_ADDRESSES.bob,
    publicKeyBase58Identifier: alice.publicKey,
    parameters: [
      { key: 'name', value: 'Genesis Item' },
      { key: 'uri', value: 'ipfs://example' }
    ],
    nonce: '0',
    feeAmountParts: '1'
  });

  console.log('Unsigned item mint:', unsigned.$typeName);
}

async function createSignedItemMint(): Promise<void> {
  const signed = await createItemizedMintTXN({
    contractId: 'SBT0001',
    itemId: 'badge-001',
    recipientAddress: TEST_WALLET_ADDRESSES.bob,
    publicKeyBase58Identifier: alice.publicKey,
    privateKeyBase58: alice.privateKey,
    votingWeight: '1',
    nonce: '1',
    feeAmountParts: '1'
  });

  // const hash = await sendItemizedMintTXN(signed);
  // console.log('Submitted item mint:', hash);
  console.log('Signed item mint:', Boolean(signed.base?.signature));
}

async function buildNFTTransfer(): Promise<void> {
  const unsigned = await buildNFTTXN({
    contractId: 'NFT0001',
    itemId: 'item-001',
    recipientAddress: TEST_WALLET_ADDRESSES.charlie,
    publicKeyBase58Identifier: alice.publicKey,
    nonce: '2',
    feeAmountParts: '1'
  });

  console.log('Unsigned NFT transaction:', unsigned.$typeName);
}

async function buildSBTBurn(): Promise<void> {
  const unsigned = await buildBurnSBTTXN({
    contractId: 'SBT0001',
    itemId: 'badge-001',
    publicKeyBase58Identifier: alice.publicKey,
    nonce: '3',
    feeAmountParts: '1'
  });

  console.log('Unsigned SBT burn:', unsigned.$typeName);
}

async function runExamples(): Promise<void> {
  await buildUnsignedItemMint();
  await createSignedItemMint();
  await buildNFTTransfer();
  await buildSBTBurn();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples().catch(error => {
    console.error('Item example failed:', error);
    process.exit(1);
  });
}
