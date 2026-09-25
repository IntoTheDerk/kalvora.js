import { describe, expect, it } from 'vitest';

import { ED25519_TEST_KEYS, TEST_WALLET_ADDRESSES } from '../../test-utils/keys.test.js';
import {
  buildBurnSBTTXN,
  buildItemizedMintTXN,
  buildNFTTXN,
  createBurnSBTTXN,
  createItemizedMintTXN,
  createNFTTXN,
  sendBurnSBTTXN,
  sendItemizedMintTXN,
  sendNFTTXN
} from '../transaction.js';

const alice = ED25519_TEST_KEYS.alice;
const commonBuildOptions = {
  publicKeyBase58Identifier: alice.publicKey,
  nonce: '0',
  feeAmountParts: '1'
};

describe('itemized mint transactions', () => {
  it('builds an unsigned ItemizedMintTXN with item metadata', async () => {
    const txn = await buildItemizedMintTXN({
      ...commonBuildOptions,
      contractId: 'NFT0001',
      itemId: 'item-001',
      recipientAddress: TEST_WALLET_ADDRESSES.bob,
      votingWeight: '100',
      expiry: '123',
      validFrom: '100',
      parameters: [
        { key: 'name', value: 'Genesis Item' },
        { key: 'uri', value: 'ipfs://example' }
      ],
      contractFees: {
        fee: '1000',
        burn: '100',
        validator: '900',
        feeAddress: TEST_WALLET_ADDRESSES.alice,
        allowedFeeInstrument: ['KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao']
      }
    });

    expect(txn.$typeName).toBe('zera_txn.ItemizedMintTXN');
    expect(txn.contractId).toBe('NFT0001');
    expect(txn.itemId).toBe('item-001');
    expect(txn.recipientAddress.length).toBeGreaterThan(0);
    expect(txn.parameters).toHaveLength(2);
    expect(txn.parameters[0]?.key).toBe('name');
    expect(txn.expiry).toBe(BigInt(123));
    expect(txn.validFrom).toBe(BigInt(100));
    expect(txn.contractFees?.allowedFeeInstrument).toEqual(['KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao']);
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.feeAmount).toBe('1');
  });

  it('creates and signs an ItemizedMintTXN', async () => {
    const txn = await createItemizedMintTXN({
      ...commonBuildOptions,
      contractId: 'SBT0001',
      itemId: 'badge-001',
      recipientAddress: TEST_WALLET_ADDRESSES.bob,
      publicKeyBase58Identifier: alice.publicKey,
      privateKeyBase58: alice.privateKey
    });

    expect(txn.base?.signature).toBeInstanceOf(Uint8Array);
    expect(txn.base?.hash).toBeInstanceOf(Uint8Array);
  });

  it('validates required itemized mint fields', async () => {
    await expect(
      buildItemizedMintTXN({
        ...commonBuildOptions,
        contractId: 'bad id',
        itemId: 'item-001',
        recipientAddress: TEST_WALLET_ADDRESSES.bob
      })
    ).rejects.toThrow('ContractId must be a valid Kalvora mint ID');

    await expect(
      buildItemizedMintTXN({
        ...commonBuildOptions,
        contractId: 'NFT0001',
        itemId: '',
        recipientAddress: TEST_WALLET_ADDRESSES.bob
      })
    ).rejects.toThrow('itemId is required');
  });

  it('submits ItemizedMintTXN through the transaction router', async () => {
    const txn = await createItemizedMintTXN({
      ...commonBuildOptions,
      contractId: 'NFT0001',
      itemId: 'item-002',
      recipientAddress: TEST_WALLET_ADDRESSES.bob,
      privateKeyBase58: alice.privateKey
    });

    const hash = await sendItemizedMintTXN(txn);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('NFT transactions', () => {
  it('builds an unsigned NFTTXN', async () => {
    const txn = await buildNFTTXN({
      ...commonBuildOptions,
      contractId: 'NFT0001',
      itemId: 'item-001',
      recipientAddress: TEST_WALLET_ADDRESSES.charlie,
      contractFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
      contractFeeAmountParts: '10'
    });

    expect(txn.$typeName).toBe('zera_txn.NFTTXN');
    expect(txn.contractId).toBe('NFT0001');
    expect(txn.itemId).toBe('item-001');
    expect(txn.contractFeeId).toBe('KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
    expect(txn.contractFeeAmount).toBe('10');
    expect(txn.base?.signature).toBeUndefined();
  });

  it('creates and signs an NFTTXN', async () => {
    const txn = await createNFTTXN({
      ...commonBuildOptions,
      contractId: 'NFT0001',
      itemId: 'item-001',
      recipientAddress: TEST_WALLET_ADDRESSES.charlie,
      privateKeyBase58: alice.privateKey
    });

    expect(txn.base?.signature).toBeInstanceOf(Uint8Array);
    expect(txn.base?.hash).toBeInstanceOf(Uint8Array);
  });

  it('submits NFTTXN through the transaction router', async () => {
    const txn = await createNFTTXN({
      ...commonBuildOptions,
      contractId: 'NFT0001',
      itemId: 'item-003',
      recipientAddress: TEST_WALLET_ADDRESSES.charlie,
      privateKeyBase58: alice.privateKey
    });

    const hash = await sendNFTTXN(txn);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('SBT burn transactions', () => {
  it('builds an unsigned BurnSBTTXN', async () => {
    const txn = await buildBurnSBTTXN({
      ...commonBuildOptions,
      contractId: 'SBT0001',
      itemId: 'badge-001'
    });

    expect(txn.$typeName).toBe('zera_txn.BurnSBTTXN');
    expect(txn.contractId).toBe('SBT0001');
    expect(txn.itemId).toBe('badge-001');
    expect(txn.base?.signature).toBeUndefined();
  });

  it('creates and signs a BurnSBTTXN', async () => {
    const txn = await createBurnSBTTXN({
      ...commonBuildOptions,
      contractId: 'SBT0001',
      itemId: 'badge-001',
      privateKeyBase58: alice.privateKey
    });

    expect(txn.base?.signature).toBeInstanceOf(Uint8Array);
    expect(txn.base?.hash).toBeInstanceOf(Uint8Array);
  });

  it('submits BurnSBTTXN through the transaction router', async () => {
    const txn = await createBurnSBTTXN({
      ...commonBuildOptions,
      contractId: 'SBT0001',
      itemId: 'badge-002',
      privateKeyBase58: alice.privateKey
    });

    const hash = await sendBurnSBTTXN(txn);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});
