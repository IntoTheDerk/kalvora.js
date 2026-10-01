/**
 * Live protonet submit: a governance proposal with a CoinTXN attached.
 *
 * Skipped unless both `KALVORA_LIVE_ENDPOINT` and `KALVORA_PRIVATE_KEY` are
 * set. The key is a base58 Ed25519 seed and is never printed.
 *
 *   Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#][^=]*)=(.*)$') { Set-Item -Path "env:$($Matches[1].Trim())" -Value $Matches[2].Trim() } }
 *   npx vitest run src/proposal/tests/live-coin-proposal.test.ts
 */
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { sha3_256 } from '@noble/hashes/sha3.js';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  CoinTXNSchema,
  GOVERNANCE_TYPE,
  GovernanceTXNSchema,
  PublicKeySchema,
  TRANSACTION_TYPE,
  type CoinTXN,
  type GovernanceTXN
} from '../../../proto/generated/txn_pb.js';
import { buildCoinTXN } from '../../coin-txn/transaction.js';
import { createQueryClient } from '../../query/api-client.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { signCoinTXNWithKeys, signWithKey } from '../../sign/finalize.js';
import type { GRPCConfig } from '../../types/index.js';
import { Ed25519KeyPair } from '../../wallet-creation/crypto-core.js';
import { buildGovernanceProposalTXN } from '../governance.js';
import { sendGovernanceProposalTXN } from '../transaction.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const ENDPOINT = process.env.KALVORA_LIVE_ENDPOINT ?? '';
const PRIVATE_KEY = process.env.KALVORA_PRIVATE_KEY ?? '';

function ed25519Identity(privateKeyBase58: string): { publicKey: string; address: string } {
  let seed = bs58.decode(privateKeyBase58);
  if (seed.length === 64) seed = seed.subarray(0, 32);
  if (seed.length !== 32) throw new Error('KALVORA_PRIVATE_KEY must be a 32-byte Ed25519 seed');
  const address = Ed25519KeyPair.fromPrivateKey(seed).getPublicKeyBase58();
  return { publicKey: `A_${address}`, address };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

/**
 * The node accepts an inner transaction only when `base.public_key.governance_auth`
 * is `gov_` plus the proposal contract id, and `base.hash` is SHA3-256 of the
 * serialized transaction with that hash cleared.
 */
async function buildGovernanceCoinTXN(
  publicKey: string,
  address: string,
  contractId: string,
  grpcConfig: GRPCConfig
): Promise<CoinTXN> {
  const coin = await buildCoinTXN(
    [{ publicKey, amount: '0.000000001', feePercent: '100' }],
    [{ to: address, amount: '0.000000001', memo: 'sdk proposal attachment' }],
    contractId,
    { baseFeeId: KALVORA_NATIVE_TOKEN },
    'sdk proposal attachment',
    grpcConfig
  );
  if (!coin.base) throw new Error('coin txn has no base');
  coin.base.publicKey = create(PublicKeySchema, {
    governanceAuth: new TextEncoder().encode(`gov_${contractId}`)
  });
  return coin;
}

function sealGovernanceCoin(coin: CoinTXN, publicKey: string, privateKey: string): GovernanceTXN {
  const signed = signCoinTXNWithKeys(coin, [{ publicKey, privateKey }]);
  const serializedTxn = toBinary(CoinTXNSchema, signed);
  const parsed = fromBinary(CoinTXNSchema, serializedTxn);
  const hash = parsed.base?.hash;
  if (!parsed.base || !hash || hash.length !== 32) {
    throw new Error('attached coin txn is missing its SHA3-256 hash');
  }
  delete parsed.base.hash;
  const recomputed = sha3_256(toBinary(CoinTXNSchema, parsed));
  if (!sameBytes(hash, recomputed)) {
    throw new Error('attached coin hash does not match SHA3-256 of the hash-cleared message');
  }
  return create(GovernanceTXNSchema, {
    txnType: TRANSACTION_TYPE.COIN_TYPE,
    serializedTxn,
    txnHash: hash
  });
}

describe.skipIf(!ENDPOINT || !PRIVATE_KEY)('live proposal with an attached coin txn', () => {
  it('builds a KALV proposal carrying a one-part coin transfer and submits it to protonet', async () => {
    const grpcConfig: GRPCConfig = { endpoint: ENDPOINT };
    const query = createQueryClient(grpcConfig);
    const { publicKey, address } = ed25519Identity(PRIVATE_KEY);

    const info = await query.getContract(KALVORA_NATIVE_TOKEN);
    const governance = info.contract.governance;
    expect(governance, 'KALV has no governance').toBeDefined();
    if (!governance) return;

    const balance = await query.getBalance(address, KALVORA_NATIVE_TOKEN);
    expect(balance.balance > 0n, 'wallet holds no KALV to propose with').toBe(true);

    const coin = await buildGovernanceCoinTXN(publicKey, address, KALVORA_NATIVE_TOKEN, grpcConfig);
    const governanceTxn = sealGovernanceCoin(coin, publicKey, PRIVATE_KEY);
    expect(governanceTxn.txnType).toBe(TRANSACTION_TYPE.COIN_TYPE);
    expect(new TextDecoder().decode(coin.base?.publicKey?.governanceAuth)).toBe(`gov_${KALVORA_NATIVE_TOKEN}`);

    const adaptive = governance.type === GOVERNANCE_TYPE.ADAPTIVE;
    const proposal = await buildGovernanceProposalTXN({
      contractId: KALVORA_NATIVE_TOKEN,
      title: 'SDK test proposal',
      synopsis: 'Attaches a one-part KALV transfer.',
      body: 'Passing this proposal sends 0.000000001 KALV from the proposer back to the same wallet.',
      publicKey,
      governanceTxn: [governanceTxn],
      governance: {
        type: governance.type,
        allowMulti: governance.allowMulti,
        stageLengthCount: governance.stageLength.length,
        hasPreGovernance: governance.preGovernance !== undefined
      },
      ...(adaptive
        ? {
          startTimestamp: new Date(Date.now() + 60_000),
          endTimestamp: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
        : {})
    }, { grpcConfig, memo: 'sdk live proposal' });

    expect(proposal.options).toEqual([]);
    expect(proposal.governanceTxn).toHaveLength(1);
    expect(proposal.base?.feeAmount && proposal.base.feeAmount !== '0').toBeTruthy();

    const signed = signWithKey(proposal, PRIVATE_KEY, publicKey);
    const fromHeight = await query.getLatestBlockHeight();
    const hash = await sendGovernanceProposalTXN(signed, grpcConfig);
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);

    const confirmed = await query.waitForTransaction(hash, {
      fromHeight,
      timeoutMs: 180_000,
      pollIntervalMs: 3_000
    });
    expect(confirmed.success, `proposal ${hash} landed as ${confirmed.statusName}`).toBe(true);
    expect(confirmed.proposalIdentifier).toBeDefined();
  }, 240_000);
});
