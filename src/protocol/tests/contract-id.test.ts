import { describe, expect, it } from 'vitest';

import {
  CREATOR_AUTHORIZATION,
  CREATOR_KEY_ALGORITHM,
  GENESIS_CONTRACT_IDS,
  GENESIS_CONTRACT_NONCES,
  KALV_CONTRACT_DIGEST,
  decodeContractId,
  deriveContractDataHash,
  deriveGenesisContractId,
  deriveOrdinaryContractId,
  isCanonicalContractId,
  kalvDigestHex
} from '../contract-id.js';

describe('genesis contract IDs', () => {
  it('matches the live KALV digest and Base58 ID', () => {
    expect(kalvDigestHex()).toBe(KALV_CONTRACT_DIGEST);
    expect(deriveGenesisContractId(GENESIS_CONTRACT_NONCES.KALV)).toBe(GENESIS_CONTRACT_IDS.KALV);
    const decoded = decodeContractId(GENESIS_CONTRACT_IDS.KALV);
    expect(Buffer.from(decoded?.digest ?? new Uint8Array()).toString('hex')).toBe(KALV_CONTRACT_DIGEST);
  });

  it('matches the older native-token vector (nonce 142654458)', () => {
    expect(kalvDigestHex(142654458)).toBe('293c97ebd9e742a9baa56d34019425c97cb59b320ad551337b29c7bfee0a721f');
    expect(deriveGenesisContractId(142654458)).toBe('KALVErY7zkXAqEC5y2BzchQ8HoRdzK2zxPeKEXPtckeZvwHnz');
  });

  it.each(Object.keys(GENESIS_CONTRACT_NONCES) as (keyof typeof GENESIS_CONTRACT_NONCES)[])(
    'derives the published %s ID',
    (name) => {
      expect(deriveGenesisContractId(GENESIS_CONTRACT_NONCES[name])).toBe(GENESIS_CONTRACT_IDS[name]);
      expect(isCanonicalContractId(GENESIS_CONTRACT_IDS[name])).toBe(true);
    }
  );

  it('rejects placeholder and tampered IDs', () => {
    expect(isCanonicalContractId('KAL111112')).toBe(false);
    expect(isCanonicalContractId('KAL000001')).toBe(false);
    expect(isCanonicalContractId('OTHER0000')).toBe(false);
    expect(isCanonicalContractId(`${GENESIS_CONTRACT_IDS.KALV.slice(0, -1)}x`)).toBe(false);
    expect(isCanonicalContractId('')).toBe(false);
  });
});

describe('ordinary contract IDs', () => {
  it('changes when the vanity nonce or an identity field changes, and round-trips the checksum', () => {
    const hash = deriveContractDataHash({
      symbol: 'MYT',
      type: 0,
      maxSupply: '1000',
      coinDenomination: { denominationName: 'myt', amount: '1000000000' }
    });
    const creator = new Uint8Array([0x41, 0x5f, 0x01, 0x02]);
    const first = deriveOrdinaryContractId({
      creatorAuthorizationType: CREATOR_AUTHORIZATION.SINGLE_KEY,
      creatorKeyAlgorithm: CREATOR_KEY_ALGORITHM.ED25519,
      creatorAuthorizationBytes: creator,
      vanityNonce: 0n,
      contractDataHash: hash
    });
    const nextNonce = deriveOrdinaryContractId({
      creatorAuthorizationType: CREATOR_AUTHORIZATION.SINGLE_KEY,
      creatorKeyAlgorithm: CREATOR_KEY_ALGORITHM.ED25519,
      creatorAuthorizationBytes: creator,
      vanityNonce: 1n,
      contractDataHash: hash
    });
    const renamed = deriveOrdinaryContractId({
      creatorAuthorizationType: CREATOR_AUTHORIZATION.SINGLE_KEY,
      creatorKeyAlgorithm: CREATOR_KEY_ALGORITHM.ED25519,
      creatorAuthorizationBytes: creator,
      vanityNonce: 0n,
      contractDataHash: deriveContractDataHash({
        symbol: 'MYU',
        type: 0,
        maxSupply: '1000',
        coinDenomination: { denominationName: 'myt', amount: '1000000000' }
      })
    });

    expect(isCanonicalContractId(first)).toBe(true);
    expect(nextNonce).not.toBe(first);
    expect(renamed).not.toBe(first);
    expect(deriveContractDataHash({ symbol: 'NFT', type: 1 })).not.toEqual(hash);
  });

  it('matches the published ordinary ed25519 vector', () => {
    const hash = deriveContractDataHash({
      symbol: 'KAL',
      type: 0,
      maxSupply: '001000000',
      coinDenomination: { denominationName: 'microKAL', amount: '000100' },
      maxSupplyRelease: [{ seconds: 1700000000, nanos: 0, amount: '1000000' }]
    });
    expect(Buffer.from(hash).toString('hex')).toBe('8a692db9b4b4247f5c5a9b6d585fac56c778821fd0d05844f32e830572dac040');
    const id = deriveOrdinaryContractId({
      creatorAuthorizationType: 1,
      creatorKeyAlgorithm: 1,
      creatorAuthorizationBytes: Buffer.from('415f000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'),
      vanityNonce: 42,
      contractDataHash: hash
    });
    expect(id).toBe('7CbKHc2FGLUAqtj8gbi848VMRHms15NUFEh7vatLfapXJHU8Q');
  });
});
