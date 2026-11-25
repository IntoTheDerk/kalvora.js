import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { CoinDenominationSchema, CONTRACT_TYPE, GovernanceSchema, GOVERNANCE_TYPE, PreMintWalletSchema, RestrictedKeySchema } from '../../../proto/generated/txn_pb.js';
import { GENESIS_CONTRACT_IDS } from '../../protocol/contract-id.js';
import { buildContractTXN } from '../create/transaction.js';
import { convertPercentToThreshold, validateCurrentContractFields } from '../shared/utils.js';

describe('clean-genesis contract fields', () => {
  it('rejects the retired quash threshold instead of silently dropping it', () => {
    expect(() => validateCurrentContractFields({ quashThreshold: 3 } as Parameters<typeof validateCurrentContractFields>[0]))
      .toThrow('quashThreshold is retired');
  });

  it.each([
    ['timeDelay', 0n],
    ['global', false],
    ['quash', false]
  ])('rejects retired restricted-key field %s even at its default value', (field, value) => {
    const key = { ...create(RestrictedKeySchema), [field]: value };
    expect(() => validateCurrentContractFields({ restrictedKeys: [key] }))
      .toThrow(`restrictedKeys.${field} is retired`);
  });

  it('accepts the current permission fields', () => {
    expect(() => validateCurrentContractFields({
      restrictedKeys: [create(RestrictedKeySchema, { publicKey: { walletAddress: new Uint8Array(128) }, updateContract: true, mint: true })]
    })).not.toThrow();
  });

  it('rejects repeated direct identities, including entries with different action flags', () => {
    const address = new Uint8Array(128);
    const a = create(RestrictedKeySchema, { publicKey: { walletAddress: address }, mint: true });
    const b = create(RestrictedKeySchema, { publicKey: { walletAddress: address.slice() }, updateContract: true });
    expect(() => validateCurrentContractFields({ restrictedKeys: [a, b] })).toThrow('Duplicate direct grant');
  });

  it('rejects a child that names itself as its parent even when it has a recovery grant', () => {
    const parent = create(RestrictedKeySchema, { publicKey: { parentContract: GENESIS_CONTRACT_IDS.KALV } });
    const recovery = create(RestrictedKeySchema, { publicKey: { walletAddress: new Uint8Array(32) }, updateContract: true });
    expect(() => validateCurrentContractFields({ contractId: GENESIS_CONTRACT_IDS.KALV, restrictedKeys: [parent, recovery] })).toThrow('own parent');
  });

  it('binds a registered creator to the zero default vanity nonce and validates token amounts offline', async () => {
    const options = {
      name: 'Zero Nonce', symbol: 'ZRO', type: CONTRACT_TYPE.TOKEN, contractVersion: 1n,
      publicKeyBase58Identifier: '1'.repeat(128), maxSupply: '100',
      coinDenomination: create(CoinDenominationSchema, { denominationName: 'part', amount: '1' }),
      nonce: 2n, feeAmountParts: '20000', grpcConfig: { transactionContext: { chainId: new Uint8Array(32) } }
    };
    const zero = await buildContractTXN({ ...options, vanityNonce: 0n });
    expect((await buildContractTXN({ ...options, contractId: zero.contractId })).contractId).toBe(zero.contractId);
    await expect(buildContractTXN({ ...options, contractId: GENESIS_CONTRACT_IDS.KALV })).rejects.toThrow('vanityNonce 0');
    const { maxSupply: _supply, ...missingSupply } = options;
    await expect(buildContractTXN(missingSupply)).rejects.toThrow('require maxSupply');
    await expect(buildContractTXN({ ...options, coinDenomination: create(CoinDenominationSchema, { amount: '0' }) })).rejects.toThrow('coinDenomination.amount');
    await expect(buildContractTXN({ ...options, maxSupply: (1n << 256n).toString() })).rejects.toThrow('uint256');
    const premint = create(PreMintWalletSchema, { address: new Uint8Array(128), amount: '100' });
    const bad = create(PreMintWalletSchema, { address: Uint8Array.of(1), amount: '1' });
    await expect(buildContractTXN({ ...options, premintWallets: [premint, bad] })).rejects.toThrow('Invalid premint');
    await expect(buildContractTXN({ ...options, premintWallets: [premint, premint] })).rejects.toThrow('Duplicate premint');
    await expect(buildContractTXN({ ...options, maxSupply: '99', premintWallets: [premint] })).rejects.toThrow('exceed maxSupply');
  });

  it('requires one parent and a local recovery authority when inheriting', () => {
    const parent = create(RestrictedKeySchema, { publicKey: { parentContract: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' }, updateContract: true });
    const recovery = create(RestrictedKeySchema, { publicKey: { walletAddress: new Uint8Array(64) }, updateContract: true });
    expect(() => validateCurrentContractFields({ restrictedKeys: [parent] })).toThrow('direct update_contract');
    expect(() => validateCurrentContractFields({ restrictedKeys: [parent, parent, recovery] })).toThrow('one parent');
    expect(() => validateCurrentContractFields({ restrictedKeys: [parent, recovery] })).not.toThrow();
  });

  it('rejects governance removal while consensus disables it', () => {
    expect(() => validateCurrentContractFields({
      governance: create(GovernanceSchema, { type: GOVERNANCE_TYPE.REMOVE })
    })).toThrow('Governance REMOVE is disabled');
  });
});

describe('governance participation threshold', () => {
  it.each([[0, 0], [0.25, 25], [20.5, 2050], [100, 10000]])('converts %s percent to %s basis points', (percent, expected) => {
    expect(convertPercentToThreshold(percent)).toBe(expected);
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid percentage %s', percent => {
    expect(() => convertPercentToThreshold(percent)).toThrow('Percent must be between 0 and 100');
  });
});
