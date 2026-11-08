import { create } from '@bufbuild/protobuf';
import { createRouterTransport } from '@connectrpc/connect';
import { ed25519 } from '@noble/curves/ed25519.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildTextGovernanceProposalTXN, buildVoteTXN, configureTransactionContext,
  deserializeTransaction, finalizeTransactionHash, getSponsorSigningBytes,
  sendGovernanceProposalTXN, serializeTransaction,
  type GovernanceProposal, type GovernanceVote, type ProposalConstructionContext
} from '../../../native.js';
import { FeePayerSchema, TRANSACTION_TYPE, TXNService } from '../../../proto/generated/txn_pb.js';
import vector from '../../proposal/tests/fixtures/text-proposal-v1.json';
import { getPublicKeyBytes } from '../../shared/crypto/address-utils.js';
import { createTransactionHash, signTransactionData } from '../../shared/crypto/signature-utils.js';
import { ED25519_TEST_KEYS } from '../../test-utils/keys.test.js';
import { sendVoteTXN } from '../../vote/transaction.js';
import { getTransactionSigningBytes, signWithKey } from '../finalize.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const { alice, bob, charlie } = ED25519_TEST_KEYS;
const context = { chainId: new Uint8Array(32).fill(0x42) };
type GovernanceTransaction = GovernanceProposal | GovernanceVote;
const wire = (txn: GovernanceTransaction) => Buffer.from(serializeTransaction(txn).data, 'base64');
const copy = (txn: GovernanceTransaction) => deserializeTransaction(serializeTransaction(txn)) as GovernanceTransaction;
const verify = (signature: Uint8Array, bytes: Uint8Array, key: string) =>
  ed25519.verify(signature, bytes, getPublicKeyBytes(key).slice(2));

beforeEach(() => {
  configureTransactionContext(context);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-25T09:22:00.000Z'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Sponsorship tests forbid network access'); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  configureTransactionContext(context);
});

describe.each(['proposal', 'vote'] as const)('offline %s sponsorship', kind => {
  async function signed(): Promise<GovernanceTransaction> {
    // Fixed manual fees are fixtures, not a verified sponsor fee quote.
    const options = { nonce: 7n, feeAmountParts: '1234', timestamp: new Date(vector.base.timestamp) };
    const txn = kind === 'proposal'
      ? await buildTextGovernanceProposalTXN(vector.input, alice.publicKey, {
        ...options, constructionContext: vector.constructionContext as ProposalConstructionContext
      })
      : await buildVoteTXN(vector.input.contractId, 'ab'.repeat(32), alice.publicKey, { ...options, support: true });
    signWithKey(txn, alice.privateKey, alice.publicKey, context);
    txn.base!.feePayer = create(FeePayerSchema, {
      publicKey: { single: getPublicKeyBytes(bob.publicKey) }, nonce: 9007199254740993n
    });
    txn.base!.feePayer.signature = signTransactionData(getSponsorSigningBytes(txn, context), bob.privateKey, bob.publicKey);
    return finalizeTransactionHash(txn, context);
  }

  it('verifies both real signatures, canonical bytes and hash across round-trip and in-memory send', async () => {
    const txn = await signed();
    const original = wire(txn);
    const user = copy(txn);
    delete user.base!.signature;
    delete user.base!.hash;
    delete user.base!.feePayer;
    expect(getTransactionSigningBytes(txn, context)).toEqual(new Uint8Array(wire(user)));
    expect(verify(txn.base!.signature!, wire(user), alice.publicKey)).toBe(true);
    const sponsor = copy(txn);
    delete sponsor.base!.hash;
    sponsor.base!.feePayer!.signature = new Uint8Array(0);
    expect(getSponsorSigningBytes(txn, context)).toEqual(new Uint8Array(wire(sponsor)));
    expect(verify(txn.base!.feePayer!.signature, wire(sponsor), bob.publicKey)).toBe(true);
    const hashInput = copy(txn);
    delete hashInput.base!.hash;
    expect(txn.base!.hash).toEqual(createTransactionHash(wire(hashInput)));
    expect(wire(copy(txn))).toEqual(original);
    expect(copy(txn).base!.feePayer!.nonce).toBe(9007199254740993n);

    const receive = vi.fn((received: GovernanceTransaction) => {
      expect(wire(received)).toEqual(original);
      expect(verify(received.base!.signature!, getTransactionSigningBytes(received, context), alice.publicKey)).toBe(true);
      expect(verify(received.base!.feePayer!.signature, getSponsorSigningBytes(received, context), bob.publicKey)).toBe(true);
      return {};
    });
    const transport = createRouterTransport(router => router.service(TXNService, {
      governProposal: receive, governVote: receive
    }));
    const hash = txn.$typeName === 'kal_txn.GovernanceProposal'
      ? await sendGovernanceProposalTXN(txn, { transport })
      : await sendVoteTXN(txn, { transport });
    expect(hash).toBe(Buffer.from(txn.base!.hash!).toString('hex'));
    expect(receive).toHaveBeenCalledTimes(1);
    expect(wire(txn)).toEqual(original);
  });

  it.each(['payload', 'fee', 'user nonce', 'user signature', 'sponsor nonce', 'sponsor key'] as const)(
    'invalidates sponsor approval after changing %s', async field => {
      const txn = await signed();
      if (field === 'payload') {
        if (txn.$typeName === 'kal_txn.GovernanceProposal') txn.body += '\nChanged';
        else txn.support = false;
      } else if (field === 'fee') txn.base!.feeAmount = '1235';
      else if (field === 'user nonce') txn.base!.nonce += 1n;
      else if (field === 'user signature') txn.base!.signature![0] ^= 1;
      else if (field === 'sponsor nonce') txn.base!.feePayer!.nonce += 1n;
      else txn.base!.feePayer!.publicKey!.single = getPublicKeyBytes(charlie.publicKey);
      expect(verify(txn.base!.feePayer!.signature, getSponsorSigningBytes(txn, context), bob.publicKey)).toBe(false);
      // The user approves the transaction; sponsor identity/nonce are bound by the sponsor signature.
      expect(verify(txn.base!.signature!, getTransactionSigningBytes(txn, context), alice.publicKey))
        .toBe(field === 'sponsor nonce' || field === 'sponsor key');
    }
  );

  it.each(['chainId', 'signatureDomain', 'intendedType'] as const)('rejects changed %s for sponsor bytes and finalization', async field => {
    const txn = await signed();
    if (field === 'intendedType') txn.base!.intendedType = TRANSACTION_TYPE.COIN_TYPE;
    else txn.base![field] = new Uint8Array(0);
    const original = wire(txn);
    expect(() => getSponsorSigningBytes(txn, context)).toThrow();
    expect(() => finalizeTransactionHash(txn, context)).toThrow();
    expect(wire(txn)).toEqual(original);
  });
});
