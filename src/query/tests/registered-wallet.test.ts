import { create, toBinary } from '@bufbuild/protobuf';
import { Code, ConnectError, createRouterTransport } from '@connectrpc/connect';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import { APIService, ContractResponseSchema, SmartContractEventsResponseSchema, SmartContractEventsSearchRequestSchema, SmartContractEventsSearchResponseSchema } from '../../../proto/generated/kal_api_pb.js';
import { FalconPublicKeySchema, GovernanceChildDisposition, TXNService, TRANSACTION_TYPE, WalletRegistrationSchema, TXN_STATUS } from '../../../proto/generated/txn_pb.js';
import { BlockSchema } from '../../../proto/generated/validator_pb.js';
import { submitTransaction } from '../../grpc/transaction/transaction-client.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { bytesToHex } from '../../shared/utils/byte-utils.js';
import { signAndFinalize } from '../../sign/finalize.js';
import { FalconWallet } from '../../wallet-creation/falcon.js';
import { buildWalletRegistration } from '../../wallet-registration/index.js';
import { createQueryClient } from '../api-client.js';
import { listBlockTransactions, listGovernanceChildOutcomes } from '../decoders.js';
import { acceptSmartContractEvent, eventSearchRequestDigest } from '../events.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const hash = new Uint8Array(32).fill(3);
const hex = '03'.repeat(32);

describe('registered wallet RPCs', () => {
  it('matches an independently framed search digest including negative seconds, nanos and the exact cursor', () => {
    const request = create(SmartContractEventsSearchRequestSchema, {
      smartContractId: 'dex', searchStart: { seconds: -1n, nanos: 250000000 }, pageSize: 7, pageCursor: Uint8Array.of(0, 254)
    });
    expect(bytesToHex(eventSearchRequestDigest(request))).toBe('4ee8816725e741fb12be00409ad574ade87707145d04f9ca33a8a75b8721d5eb');
  });

  it('binds a returned contract and pushed event to the expected operator', async () => {
    const signer = FalconWallet.generate({ networkName: 'kal_main', genesisHash: hex });
    const key = create(FalconPublicKeySchema, { variant: signer.variant, rawPublicKey: signer.rawPublicKey });
    const publicKey = { walletAddress: bs58.decode(signer.walletAddress) };
    const transport = createRouterTransport(({ service }) => {
      service(APIService, { getSigningWallet: () => ({ identity: { case: 'falcon', value: key } }), contract: async req => {
        const response = create(ContractResponseSchema, { contract: { contractId: req.contractId }, publicKey });
        response.signature = await signer.sign(toBinary(ContractResponseSchema, response));
        return response;
      } });
    });
    const transactionContext = { chainId: signer.chainId };
    await expect(createQueryClient({ transport, transactionContext }).getContract(KALVORA_NATIVE_TOKEN)).rejects.toThrow(/trusted operator/);
    const query = createQueryClient({ transport, transactionContext, trustedOperatorAddress: signer.walletAddress });
    expect((await query.getContract(KALVORA_NATIVE_TOKEN)).operatorVerified).toBe(true);
    const event = create(SmartContractEventsResponseSchema, { publicKey, eventData: ['test'] });
    event.signature = await signer.sign(toBinary(SmartContractEventsResponseSchema, event));
    const operator = await query.resolveOperator(signer.walletAddress);
    expect(acceptSmartContractEvent(event, operator).eventData).toEqual(['test']);
    expect(() => acceptSmartContractEvent(event, { ...operator, address: bs58.encode(hash) })).toThrow(/signature/);
  });
  it('routes registration and distinguishes an empty registry response from an RPC error', async () => {
    const wide = new Uint8Array(1126).fill(0x80);
    let submitted = false;
    const transport = createRouterTransport(({ service }) => {
      service(TXNService, { registerWallet: () => { submitted = true; return {}; } });
      service(APIService, { getSigningWallet: req => {
        if (req.walletAddress.length === 32) throw new ConnectError('storage unavailable', Code.Unavailable);
        expect(req.walletAddress).toEqual(wide);
        return {};
      } });
    });
    const signer = FalconWallet.generate({ networkName: 'kal_main', genesisHash: hex });
    const grpcConfig = { transport, transactionContext: { chainId: signer.chainId } };
    const reg = await buildWalletRegistration(signer, { grpcConfig, nonce: 1, feeAmountParts: '500' });
    await signAndFinalize(reg, signer);
    expect(await submitTransaction(reg, grpcConfig)).toBe(bytesToHex(reg.base!.hash!));
    expect(submitted).toBe(true);
    const query = createQueryClient({ transport });
    expect(await query.getSigningWallet(bs58.encode(wide))).toBeUndefined();
    await expect(query.getSigningWallet(bs58.encode(hash))).rejects.toMatchObject({ code: Code.Unavailable });
  });

  it('discards old voters and restarts with an empty digest after ABORTED', async () => {
    let version = 1;
    const offsets: number[] = [];
    const transport = createRouterTransport(({ service }) => {
      service(APIService, { proposalDetail: req => {
        offsets.push(req.voterOffset);
        expect(req.proposalId).toEqual(hash);
        expect(req.expectedStateDigest).toEqual(req.voterOffset ? new Uint8Array(32).fill(version) : new Uint8Array());
        if (version === 1 && req.voterOffset === 1) {
          version++;
          throw new ConnectError('changed', Code.Aborted);
        }
        return { proposalId: hash, stateDigest: new Uint8Array(32).fill(version), voterOffset: req.voterOffset,
          voters: [{ wallet: new Uint8Array(64).fill(version + req.voterOffset) }], preGovernanceStage: 0,
          hasMore: req.voterOffset === 0, nextVoterOffset: req.voterOffset + 1 };
      } });
    });
    const detail = await createQueryClient({ transport }).getProposalDetail(hex, 1);
    expect(offsets).toEqual([0, 1, 0, 1]);
    expect(detail?.voters.map(v => v.wallet[0])).toEqual([2, 3]);
    expect(detail?.firstPage.preGovernanceStage).toBe(0);
  });

  it('verifies the signed search around stored events, the request digest, and each opaque cursor', async () => {
    const signer = FalconWallet.generate({ networkName: 'kal_main', genesisHash: hex });
    const key = create(FalconPublicKeySchema, { variant: signer.variant, rawPublicKey: signer.rawPublicKey });
    let corruptDigest = false;
    let tamperEvent = false;
    const transport = createRouterTransport(({ service }) => {
      service(APIService, {
        getSigningWallet: () => ({ identity: { case: 'falcon', value: key } }),
        smartContractEventsSearch: async req => {
          const page = req.pageCursor.length ? 2 : 1;
          expect(req.pageCursor).toEqual(page === 2 ? Uint8Array.of(9, 8) : new Uint8Array());
          const response = create(SmartContractEventsSearchResponseSchema, {
            publicKey: { walletAddress: bs58.decode(signer.walletAddress) },
            events: [{ smartContract: req.smartContractId, eventData: [String(page)] }],
            requestDigest: corruptDigest ? hash : eventSearchRequestDigest(req),
            nextPageCursor: page === 1 ? Uint8Array.of(9, 8) : new Uint8Array()
          });
          response.signature = await signer.sign(toBinary(SmartContractEventsSearchResponseSchema, response));
          if (tamperEvent) response.events[0]!.eventData.push('changed');
          return response;
        }
      });
    });
    const query = createQueryClient({ transport });
    const options = { operator: await query.resolveOperator(signer.walletAddress), pageSize: 1 };
    expect((await query.searchSmartContractEvents('dex', undefined, options)).map(e => e.eventData)).toEqual([['1'], ['2']]);
    corruptDigest = true;
    await expect(query.searchSmartContractEvents('dex', undefined, options)).rejects.toThrow(/digest/);
    tamperEvent = true;
    await expect(query.searchSmartContractEvents('dex', undefined, options)).rejects.toThrow(/signature/);
  });

  it('decodes registrations, receipt zero, and the single marker for a whole oversized child group', async () => {
    const block = create(BlockSchema, { transactions: {
      walletRegistrations: [{ base: { hash } }],
      txnFeesAndStatus: [{ txnHash: hash, status: TXN_STATUS.SMART_CONTRACT_OUTPUT_TOO_LARGE, gas: 52n }],
      governanceChildOutcomes: [
        { receiptIndex: 0, childHash: hash, disposition: GovernanceChildDisposition.GOVERNANCE_CHILD_RECEIPT_FAILURE },
        { terminalGroupChildCount: 4, terminalGroupSha256: hash, disposition: GovernanceChildDisposition.GOVERNANCE_CHILD_GROUP_OUTPUT_TOO_LARGE }
      ]
    } });
    expect(listBlockTransactions(block)[0]?.type).toBe(TRANSACTION_TYPE.REGISTER_WALLET_TYPE);
    const outcomes = listGovernanceChildOutcomes(block);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.receipt).toMatchObject({ status: 45, gas: 52n, success: false });
    expect(outcomes[1]?.receipt).toBeUndefined();
    const transport = createRouterTransport(({ service }) => service(APIService, { block: () => ({ block }) }));
    expect(await createQueryClient({ transport }).getTransactionResult(hex, 1)).toMatchObject({
      status: 45, statusName: 'SMART_CONTRACT_OUTPUT_TOO_LARGE', success: false, gas: 52n
    });
  });
});
