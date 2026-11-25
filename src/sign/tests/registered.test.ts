import { readFileSync } from 'node:fs';

import { clone, create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { createRouterTransport } from '@connectrpc/connect';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import { APIService, TokenFeeInfoSchema } from '../../../proto/generated/kal_api_pb.js';
import { CoinTXNSchema, GovernanceProposalSchema, TXNService, WalletPolicySchema, WalletRegistrationSchema } from '../../../proto/generated/txn_pb.js';
import { buildCoinTXN } from '../../coin-txn/transaction.js';
import { submitTransaction } from '../../grpc/transaction/transaction-client.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { FalconWallet, verifyFalconSignature } from '../../wallet-creation/falcon.js';
import { buildWalletRegistration, derivePolicyAddress, encodePolicyDescriptor } from '../../wallet-registration/index.js';
import { countersignTransaction, finalizeTransactionHash, getSponsorSigningBytes, getTransactionSigningBytes, signAndFinalize, signCoinTXN } from '../finalize.js';
import { assertAuthenticationBudget } from '../resources.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const vectors = JSON.parse(readFileSync(new URL('../../../docs/kalvora-js-protocol-handoff-2026-11-25/tests/transactions/falcon_wallet_vectors.json', import.meta.url), 'utf8')) as {
  signed_policy_registration: string;
  policy_descriptor: string;
  single_wallets: { raw_public_key: string }[];
};

const network = { networkName: 'kal_main' as const, genesisHash: '47'.repeat(32) };

describe('registered transaction proofs', () => {
  it('reproduces the validator policy descriptor, registration hash and both witness preimages', () => {
    const wire = Buffer.from(vectors.signed_policy_registration, 'hex');
    const reg = fromBinary(WalletRegistrationSchema, new Uint8Array(wire));
    if (reg.identity.case !== 'policy' || !reg.base?.publicKey) throw new Error('Expected policy vector');
    const context = { chainId: reg.base.chainId };
    const policy = reg.identity.value;
    expect(Buffer.from(encodePolicyDescriptor(policy, reg.walletHash)).toString('hex')).toBe(vectors.policy_descriptor);
    expect(derivePolicyAddress(policy, reg.walletHash)).toEqual(reg.base.publicKey.walletAddress);
    const bytes = getTransactionSigningBytes(reg, context);
    for (const witness of reg.base.publicKey.witnesses) {
      const raw = Buffer.from(vectors.single_wallets[witness.slot]!.raw_public_key, 'hex');
      expect(verifyFalconSignature(raw, bytes, witness.signature)).toBe(true);
    }
    finalizeTransactionHash(reg, context);
    expect(Buffer.from(toBinary(WalletRegistrationSchema, reg))).toEqual(wire);
  });

  it('signs a mixed-variant policy registration, sponsored cap and first Coin payment', async () => {
    const alice = FalconWallet.generate(network);
    const bob = FalconWallet.generate({ ...network, variant: 2, walletHash: 7 });
    const sponsor = FalconWallet.generate(network);
    const members = [alice, bob];
    const policy = create(WalletPolicySchema, {
      members: members.map((w, i) => ({ classId: i, walletAddress: bs58.decode(w.walletAddress) })),
      patterns: [{ thresholds: [{ classId: 0, required: 1 }, { classId: 1, required: 1 }] }]
    });
    const owner = { policy, walletHash: 1, members: members.map((signer, slot) => ({ signer, slot })) };
    const token = create(TokenFeeInfoSchema, { contractId: KALVORA_NATIVE_TOKEN, authorized: true, denomination: '1000000000', rate: '1000000000000000000' });
    const transport = createRouterTransport(({ service }) => service(APIService, {
      getTokenFeeInfo: () => ({ tokens: [token] }),
      baseFee: request => {
        expect(request.additionalSigner?.walletAddress).toEqual(bs58.decode(sponsor.walletAddress));
        expect(request.publicKey?.witnesses.map(w => w.signature.length)).toEqual([666, 1280]);
        return { byteFee: '1000000000', keyFee: '1' };
      }
    }));
    const grpcConfig = { transactionContext: { chainId: alice.chainId }, transport };
    const registration = await buildWalletRegistration({ policy, memberKeys: members }, {
      nonce: 1, grpcConfig, overestimatePercent: 0,
      proofLayout: { owner: [{ slot: 0, variant: 1 }, { slot: 1, variant: 2 }], sponsor: { address: sponsor.walletAddress, variant: 1, nonce: 5n } }
    });
    await expect(signAndFinalize(registration, { ...owner, members: [owner.members[0]!] })).rejects.toThrow('satisfy');
    await signAndFinalize(registration, owner);
    await countersignTransaction(registration, sponsor, 5n);
    expect(registration.base?.signature).toBeUndefined();
    expect(registration.base?.feeAmount).toBe(String(toBinary(WalletRegistrationSchema, registration).length + 1));
    const ownerBytes = getTransactionSigningBytes(registration, grpcConfig.transactionContext);
    const sponsorBytes = getSponsorSigningBytes(registration, grpcConfig.transactionContext);
    expect(verifyFalconSignature(sponsor.rawPublicKey, sponsorBytes, registration.base!.feePayer!.signature)).toBe(true);
    expect(verifyFalconSignature(bob.rawPublicKey, ownerBytes, registration.base!.publicKey!.witnesses[1]!.signature)).toBe(true);

    const address = bs58.encode(derivePolicyAddress(policy));
    const coin = await buildCoinTXN([
      { publicKey: address, amount: '0.000000007', feePercent: '0', contractFeePercent: '100', nonce: 2 },
      { publicKey: sponsor.walletAddress, amount: 0, feePercent: '100', contractFeePercent: '0', nonce: 6 }
    ], [{ to: alice.walletAddress, amount: '0.000000007' }], token.contractId, { baseFeeParts: '500' }, '', grpcConfig,
    { safeSend: false, tokenInfoMap: new Map([[token.contractId, token]]) });
    await signCoinTXN(coin, [owner, sponsor]);
    expect(coin.base?.safeSend).toBe(false);
    expect(coin.auth?.signature.map(s => s.length)).toEqual([0, 666]);
    expect(coin.inputTransfers.map(input => [input.amount, input.feePercent, input.contractFeePercent])).toEqual([
      ['7', 0, 100000000], ['0', 100000000, 0]
    ]);
    const coinBytes = getTransactionSigningBytes(coin, grpcConfig.transactionContext);
    expect(verifyFalconSignature(bob.rawPublicKey, coinBytes, coin.auth!.publicKey[0]!.witnesses[1]!.signature)).toBe(true);
    expect(verifyFalconSignature(sponsor.rawPublicKey, coinBytes, coin.auth!.signature[1]!)).toBe(true);
    const submitConfig = { transactionContext: grpcConfig.transactionContext, transport: createRouterTransport(({ service }) => {
      service(TXNService, { coin: () => ({}) });
    }) };
    expect(await submitTransaction(coin, submitConfig)).toBe(Buffer.from(coin.base!.hash!).toString('hex'));
    const wrongKey = { ...sponsor, rawPublicKey: sponsor.rawPublicKey, sign: (bytes: Uint8Array) => alice.sign(bytes) };
    await expect(signCoinTXN(coin, [owner, wrongKey], grpcConfig.transactionContext)).rejects.toThrow('invalid Falcon signature');
    const wrongFee = clone(CoinTXNSchema, coin);
    wrongFee.base!.feeAmount = '100';
    await expect(submitTransaction(wrongFee, submitConfig)).rejects.toThrow('hash does not match');
    const proposal = create(GovernanceProposalSchema, {
      governanceOptionTxns: [{ optionIndex: 1, governanceTxn: Array.from({ length: 22 }, () => ({ txnType: 1, serializedTxn: toBinary(CoinTXNSchema, coin) })) }]
    });
    expect(() => assertAuthenticationBudget(proposal)).toThrow('authentication budget');
    const tampered = clone(CoinTXNSchema, coin);
    tampered.base!.chainId[0] ^= 1;
    await expect(signCoinTXN(tampered, [owner, sponsor])).rejects.toThrow(/chainId/);
  });
});
