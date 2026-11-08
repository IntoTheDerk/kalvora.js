import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as root from '../../index.js';
import * as native from '../../native.js';
import signedContextVector from '../proposal/tests/fixtures/text-proposal-signed-context-v1.json';
import vector from '../proposal/tests/fixtures/text-proposal-v1.json';
import { UniversalFeeCalculator } from '../shared/fee-calculators/universal-fee-calculator.js';
import { ED25519_TEST_KEYS } from '../test-utils/keys.test.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-25T09:22:00.000Z'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Native API tests forbid network access'); }));
});

afterEach(() => {
  native.configureTransactionContext({ chainId: signedContextVector.chainIdHex });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('native public API', () => {
  it('includes every backend runtime member and the package version', () => {
    for (const name of ['KalvoraClient', 'KalvoraRpcError', 'isKalvoraRpcError', 'RpcCode',
      'PROPOSAL_TYPE', 'PROPOSAL_PHASE', 'PRE_GOVERNANCE_OUTCOME', 'ProposalType',
      'buildTextGovernanceProposalTXN', 'sendGovernanceProposalTXN', 'buildVoteTXN',
      'applyProposalStageFee', 'serializeTransaction', 'generateAddressFromPublicKey',
      'isValidContractId', 'isCanonicalContractId', 'UniversalFeeCalculator', 'VERSION',
      'configureTransactionContext', 'assertTransactionContext']) {
      expect(native, name).toHaveProperty(name);
    }
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(native.VERSION).toBe(pkg.version);
    expect(native.VERSION).toBe(root.VERSION);
  });

  it('exposes existing delegation builders and preserves unsigned assignment bytes', async () => {
    for (const name of ['buildDelegatedTXN', 'createDelegatedTXN', 'sendDelegatedTXN',
      'DELEGATE_PRIORITY_MIN', 'DELEGATE_PRIORITY_MAX'] as const) {
      expect(native[name]).toBe(root[name]);
    }
    const input: native.DelegatedInput = {
      publicKey: vector.publicKey,
      delegateVotes: [{ address: ED25519_TEST_KEYS.bob.address,
        contracts: [{ contractId: vector.input.contractId, priority: 1 }] }]
    };
    const options = { nonce: '9007199254740993', feeAmountParts: '101', timestamp: new Date(vector.base.timestamp) };
    const txn: native.DelegatedTXN = await native.buildDelegatedTXN(input, options);
    const expected = await root.buildDelegatedTXN(input, options);
    expect(native.serializeTransaction(txn)).toEqual(root.serializeTransaction(expected));
    expect(native.deserializeTransaction(native.serializeTransaction(txn))).toEqual(txn);
    expect(txn.base?.intendedType).toBe(root.TRANSACTION_TYPE.DELEGATED_VOTING_TYPE);
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.hash).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('re-exports existing root implementations and enums without bridge namespaces', () => {
    const rootExports = root as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(native)) {
      if (name === 'UniversalFeeCalculator') expect(value).toBe(UniversalFeeCalculator);
      else expect(value, name).toBe(rootExports[name]);
    }
    expect(native).not.toHaveProperty('solanaBridge');
    expect(native).not.toHaveProperty('guardianBridge');
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./native']).toEqual({
      types: './dist/native.d.ts', import: './dist/native.js', default: './dist/native.js'
    });
  });

  it('preserves the published proposal vector and authored Markdown bytes', async () => {
    const options: native.BuildTextGovernanceProposalTXNOptions = {
      constructionContext: vector.constructionContext as native.ProposalConstructionContext,
      nonce: vector.base.nonce,
      timestamp: new Date(vector.base.timestamp),
      feeId: vector.base.feeId,
      feeAmountParts: vector.base.feeAmountParts
    };
    for (const body of [vector.input.body, '\n\tconst café = "公共";  \n\n']) {
      const input = { ...vector.input, body };
      const proposal = await native.buildTextGovernanceProposalTXN(input, vector.publicKey, options);
      const expected = await root.buildTextGovernanceProposalTXN(input, vector.publicKey, options);
      const serialized = native.serializeTransaction(proposal);
      expect(serialized).toEqual(root.serializeTransaction(expected));
      expect((native.deserializeTransaction(serialized) as native.GovernanceProposal).body).toBe(body);
      expect(proposal.base?.feeAmount).toBe('1234');
      expect(proposal.base?.signature).toBeUndefined();
      expect(proposal.base?.hash).toBeUndefined();
      if (body === vector.input.body) {
        expect(Buffer.from(serialized.data, 'base64').toString('hex')).toBe(signedContextVector.expectedProtobufHex);
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a trusted pin and rejects changed signing intent through the native entry', async () => {
    const build = () => native.buildVoteTXN(vector.input.contractId, 'ab'.repeat(32), vector.publicKey, {
      support: true, nonce: '1', feeAmountParts: '101', timestamp: new Date(vector.base.timestamp)
    });
    native.configureTransactionContext(undefined);
    await expect(build()).rejects.toThrow('Trusted chainId is required');
    native.configureTransactionContext({ chainId: 'kal_proto' });
    const vote = await build();
    expect(vote.base?.chainId).toEqual(new TextEncoder().encode('kal_proto'));
    expect(() => root.assertTransactionContext(vote)).not.toThrow();
    expect(() => native.assertTransactionContext(vote, { chainId: 'kal_main' })).toThrow('trusted target chain');
    vote.base!.signatureDomain = new TextEncoder().encode('KAL_PROPOSAL_RESULT_V1');
    expect(() => native.assertTransactionContext(vote)).toThrow('signatureDomain');
    vote.base!.signatureDomain = new TextEncoder().encode('KAL_USER_TXN_V1');
    vote.base!.intendedType = root.TRANSACTION_TYPE.PROPOSAL_TYPE;
    expect(() => native.assertTransactionContext(vote)).toThrow('intendedType');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([true, false])('preserves binary vote bytes for support=%s and an exact uint64 nonce', async (support) => {
    const options = {
      support, nonce: '9007199254740993', feeAmountParts: '101',
      timestamp: new Date(vector.base.timestamp)
    };
    const vote = await native.buildVoteTXN(vector.input.contractId, 'ab'.repeat(32), vector.publicKey, options);
    const expected = await root.buildVoteTXN(vector.input.contractId, 'ab'.repeat(32), vector.publicKey, options);
    expect(native.serializeTransaction(vote)).toEqual(root.serializeTransaction(expected));
    expect(vote.base?.nonce).toBe(9007199254740993n);
    expect(vote.base?.feeAmount).toBe('101');
    expect(vote.base?.signature).toBeUndefined();
    expect(vote.base?.hash).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains exact stage-fee arithmetic, canonical contract checks and address derivation', () => {
    for (const fee of ['101', '9007199254740993']) {
      for (const preGovernance of [false, true]) {
        expect(native.applyProposalStageFee(fee, 3, preGovernance))
          .toBe(root.applyProposalStageFee(fee, 3, preGovernance));
      }
    }
    expect(native.applyProposalStageFee('101', 3, true)).toBe('127');
    expect(native.generateAddressFromPublicKey(vector.publicKey)).toBe(vector.constructionContext.walletAddress);
    expect(native.isValidContractId(vector.input.contractId)).toBe(true);
    expect(native.isCanonicalContractId(vector.input.contractId)).toBe(true);
    expect(native.isValidContractId('KALV')).toBe(false);
    expect(native.isValidContractId(`${vector.input.contractId.slice(0, -1)}1`)).toBe(false);
  });
});
