import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as root from '../../index.js';
import * as native from '../../native.js';
import vector from '../proposal/tests/fixtures/text-proposal-v1.json';
import { UniversalFeeCalculator } from '../shared/fee-calculators/universal-fee-calculator.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-25T09:22:00.000Z'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Native API tests forbid network access'); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('native public API', () => {
  it('includes every backend runtime member and the package version', () => {
    for (const name of ['KalvoraClient', 'KalvoraRpcError', 'isKalvoraRpcError', 'RpcCode',
      'PROPOSAL_TYPE', 'PROPOSAL_PHASE', 'PRE_GOVERNANCE_OUTCOME', 'ProposalType',
      'buildTextGovernanceProposalTXN', 'sendGovernanceProposalTXN', 'buildVoteTXN',
      'applyProposalStageFee', 'serializeTransaction', 'generateAddressFromPublicKey',
      'isValidContractId', 'isCanonicalContractId', 'UniversalFeeCalculator', 'VERSION']) {
      expect(native, name).toHaveProperty(name);
    }
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(native.VERSION).toBe(pkg.version);
    expect(native.VERSION).toBe(root.VERSION);
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
        expect(Buffer.from(serialized.data, 'base64').toString('hex')).toBe(vector.expectedProtobufHex);
      }
    }
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
