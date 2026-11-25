import type { KalvoraClient } from '../../client/index.js';
import type { FalconWallet } from '../../wallet-creation/falcon.js';
import { createVoteTXN } from '../index.js';

/** Build a binary vote. Supply the registered voter and an operator-pinned client. */
export async function signRegisteredVote(
  client: KalvoraClient, voter: FalconWallet, proposalId: string, support: boolean
) {
  const detail = await client.query.getProposalDetail(proposalId);
  if (!detail) throw new Error('Proposal not found');
  return createVoteTXN(detail.firstPage.contractId, proposalId, voter.walletAddress, voter, {
    grpcConfig: client.grpcConfig,
    proposalDetail: detail.firstPage,
    support
  });
}
