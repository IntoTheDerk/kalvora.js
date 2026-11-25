/**
 * Opt-in protonet rehearsal. Submitting spends proposal fees and publishes a proposal.
 * Set KALVORA_LIVE_SUBMIT_PROPOSAL=1, KALVORA_LIVE_ENDPOINT (trusted finalized API),
 * KALVORA_LIVE_NETWORK_NAME=kal_proto, KALVORA_LIVE_GENESIS_HASH (final block-zero
 * hash in hex), KALVORA_LIVE_OPERATOR_ADDRESS, and KALVORA_LIVE_WALLET_BACKUP
 * (path to a protected FalconWallet.exportBackup() JSON file for a funded,
 * registered rehearsal wallet). KALVORA_LIVE_TXN_ENDPOINT can select a separate
 * transaction gateway. Reserve the wallet's next nonce after proposal submission
 * for the attached self-transfer until voting and action execution finish.
 */
import { readFile } from 'node:fs/promises';

import { create, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';

import { CoinTXNSchema, GOVERNANCE_TYPE, GovernanceTXNSchema, TRANSACTION_TYPE } from '../../../proto/generated/txn_pb.js';
import { createQueryClient } from '../../query/api-client.js';
import { UniversalFeeCalculator } from '../../shared/fee-calculators/universal-fee-calculator.js';
import { deriveChainId } from '../../shared/network/chain-id.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { toTimestampInit } from '../../shared/tx/standard.js';
import { bytesToHex } from '../../shared/utils/byte-utils.js';
import { transactionContextFields, type TransactionContext } from '../../sign/context.js';
import { finalizeTransactionHash, getTransactionSigningBytes, signAndFinalize } from '../../sign/finalize.js';
import type { GRPCConfig } from '../../types/index.js';
import { decodeWalletAddress, FalconWallet, type FalconWalletBackup } from '../../wallet-creation/falcon.js';
import { buildGovernanceProposalTXN } from '../governance.js';
import { sendGovernanceProposalTXN } from '../transaction.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const ENDPOINT = process.env.KALVORA_LIVE_ENDPOINT ?? '';
const TXN_ENDPOINT = process.env.KALVORA_LIVE_TXN_ENDPOINT || ENDPOINT;
const NETWORK = process.env.KALVORA_LIVE_NETWORK_NAME ?? '';
const GENESIS = process.env.KALVORA_LIVE_GENESIS_HASH ?? '';
const OPERATOR = process.env.KALVORA_LIVE_OPERATOR_ADDRESS ?? '';
const BACKUP = process.env.KALVORA_LIVE_WALLET_BACKUP ?? '';

async function buildChild(wallet: FalconWallet, nonce: bigint, grpcConfig: GRPCConfig, context: TransactionContext) {
  const address = decodeWalletAddress(wallet.walletAddress);
  const authority = { governanceAuth: new TextEncoder().encode(`gov_${KALVORA_NATIVE_TOKEN}`) };
  const unsigned = create(CoinTXNSchema, {
    base: {
      ...transactionContextFields(CoinTXNSchema.typeName, context),
      publicKey: authority, feeId: KALVORA_NATIVE_TOKEN, feeAmount: '1', timestamp: toTimestampInit(new Date())
    },
    contractId: KALVORA_NATIVE_TOKEN,
    auth: { publicKey: [authority, { walletAddress: address }], nonce: [0n, nonce] },
    inputTransfers: [
      { index: 0n, amount: '0', feePercent: 0, contractFeePercent: 0 },
      { index: 1n, amount: '1', feePercent: 100_000_000, contractFeePercent: 100_000_000 }
    ],
    outputTransfers: [{ walletAddress: address, amount: '1' }]
  });
  const coin = await UniversalFeeCalculator.calculateFee({
    protoObject: unsigned, contractId: KALVORA_NATIVE_TOKEN, tokenInfoMap: new Map(), grpcConfig
  });
  if (!coin.auth) throw new Error('Missing Coin authorization slots');
  coin.auth.signature = [new Uint8Array(), await wallet.sign(getTransactionSigningBytes(coin, context))];
  const hash = finalizeTransactionHash(coin, context).base?.hash;
  if (!hash) throw new Error('Missing sealed Coin hash');
  return create(GovernanceTXNSchema, {
    txnType: TRANSACTION_TYPE.COIN_TYPE, txnHash: hash, serializedTxn: toBinary(CoinTXNSchema, coin)
  });
}

describe.skipIf(process.env.KALVORA_LIVE_SUBMIT_PROPOSAL !== '1')('live protonet proposal submission', () => {
  it('submits a one-part self-transfer proposal and confirms its finalized result', async () => {
    if (!ENDPOINT || !GENESIS || !OPERATOR || !BACKUP || NETWORK !== 'kal_proto') {
      throw new Error('Set the trusted protonet endpoint, network name, genesis hash, operator address, and wallet backup path');
    }
    for (const endpoint of [ENDPOINT, TXN_ENDPOINT]) expect(new URL(endpoint).protocol).toBe('https:');
    expect(GENESIS).toMatch(/^[0-9a-f]{64}$/iu);
    decodeWalletAddress(OPERATOR);
    const context = { chainId: deriveChainId(NETWORK, GENESIS) };
    const grpcConfig = { endpoint: ENDPOINT, transactionContext: context, trustedOperatorAddress: OPERATOR };
    const query = createQueryClient(grpcConfig);
    const genesis = (await query.getBlock({ height: 0 })).blockHeader;
    expect(genesis?.blockHeight).toBe(0n);
    expect(genesis?.hash && bytesToHex(genesis.hash)).toBe(GENESIS.toLowerCase());
    const operator = await query.resolveOperator(OPERATOR);
    const info = await query.getContract(KALVORA_NATIVE_TOKEN, operator);
    expect(info.operatorVerified).toBe(true);
    const governance = info.contract.governance;
    if (!governance) throw new Error('Native contract has no governance');

    const contents = await readFile(BACKUP, 'utf8');
    let wallet: FalconWallet;
    try {
      wallet = FalconWallet.restore(JSON.parse(contents) as FalconWalletBackup);
    } catch {
      throw new Error('Unable to restore protected Falcon backup');
    }
    expect(wallet.chainId).toEqual(context.chainId);
    const identity = (await query.getSigningWallet(wallet.walletAddress))?.identity;
    if (identity?.case !== 'falcon') throw new Error('Rehearsal wallet is not registered as a single Falcon key');
    expect(identity.value.rawPublicKey).toEqual(wallet.rawPublicKey);
    expect(identity.value.variant).toBe(wallet.variant);
    expect((await query.getBalance(wallet.walletAddress, KALVORA_NATIVE_TOKEN)).balance).toBeGreaterThan(0n);

    const nonce = await query.getNextNonce(wallet.walletAddress);
    const child = await buildChild(wallet, nonce + 1n, grpcConfig, context);
    const granular = governance.type === GOVERNANCE_TYPE.GRANULAR;
    const timed = granular || governance.type === GOVERNANCE_TYPE.ADAPTIVE;
    const now = Math.floor(Date.now() / 1000) * 1000;
    const proposal = await buildGovernanceProposalTXN({
      contractId: KALVORA_NATIVE_TOKEN,
      title: 'SDK rehearsal proposal',
      synopsis: 'Attaches a one-part KALV self-transfer.',
      body: 'If approved, the proposer sends one part of KALV to the same wallet and pays the transfer fees.',
      publicKey: wallet.walletAddress, governanceTxn: [child],
      governance: {
        type: governance.type, allowMulti: governance.allowMulti, stageLengthCount: governance.stageLength.length,
        preGovernanceStageCount: governance.preGovernanceStages.length || (governance.preGovernance ? 1 : 0),
        postGovernanceStageCount: governance.postGovernanceStages.length,
        allowProposalCouncils: governance.allowProposalCouncils
      },
      ...(timed && { startTimestamp: new Date(now + 60_000), endTimestamp: new Date(now + 86_400_000) }),
      ...(granular && { granular: { threshold: 10_000, regularQuorum: 10_000, voterWallets: [decodeWalletAddress(wallet.walletAddress)] } })
    }, { grpcConfig, nonce, proofLayout: { owner: wallet.variant }, memo: 'sdk live proposal' });

    expect(proposal.governanceTxn).toHaveLength(1);
    expect(BigInt(proposal.base?.feeAmount ?? '0')).toBeGreaterThan(0n);
    const signed = await signAndFinalize(proposal, wallet, context);
    const fromHeight = await query.getLatestBlockHeight();
    const hash = await sendGovernanceProposalTXN(signed, { ...grpcConfig, endpoint: TXN_ENDPOINT });
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    const confirmed = await query.waitForTransaction(hash, { fromHeight, timeoutMs: 180_000, pollIntervalMs: 3_000 });
    expect(confirmed.success, `proposal ${hash} landed as ${confirmed.statusName}`).toBe(true);
    expect(confirmed.proposalIdentifier).toBeDefined();
  }, 240_000);
});
