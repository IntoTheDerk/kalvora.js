/** Build and sign an example token offline. Run with npx tsx src/contract/create/examples/example.ts. */
import { pathToFileURL } from 'node:url';

import { create } from '@bufbuild/protobuf';

import {
  CoinDenominationSchema, CONTRACT_FEE_TYPE, CONTRACT_TYPE, ContractFeesSchema, ExpenseRatioSchema,
  GovernanceSchema, GOVERNANCE_TYPE, KeyValuePairSchema, MaxSupplyReleaseSchema, PreMintWalletSchema,
  PROPOSAL_PERIOD, RestrictedKeySchema, TokenComplianceSchema
} from '../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../shared/network/constants.js';
import { FalconWallet, decodeWalletAddress } from '../../../wallet-creation/falcon.js';
import { convertPercentToContractFeePercent } from '../../shared/utils.js';
import { createContractTXN } from '../transaction.js';

/** The synthetic chain and fee cap below are solely for this offline example. */
export const exampleNetwork = { networkName: 'kal_proto', genesisHash: '47'.repeat(32) } as const;

export async function createContractExample(owner: FalconWallet) {
  const recipient = FalconWallet.generate(exampleNetwork);
  const ownerAddress = decodeWalletAddress(owner.walletAddress);
  const recipientAddress = decodeWalletAddress(recipient.walletAddress);
  const denomination = '1000000000';
  const releaseTime = BigInt(Math.floor(Date.now() / 1000)) + 365n * 86400n;

  return createContractTXN({
    name: 'Example Token', symbol: 'EXT', type: CONTRACT_TYPE.TOKEN, contractVersion: 1000000n,
    vanityNonce: 1n,
    // The builder takes the selected registered address and its signer separately.
    publicKeyBase58Identifier: owner.walletAddress, privateKeyBase58: owner,
    nonce: 2n, feeId: KALVORA_NATIVE_TOKEN, feeAmountParts: '1000000000',
    coinDenomination: create(CoinDenominationSchema, { denominationName: 'parts', amount: denomination }),
    maxSupply: '1000000000000',
    // The initial release covers the premint. Both tranches sum to maxSupply in parts.
    maxSupplyRelease: [
      create(MaxSupplyReleaseSchema, { releaseDate: { seconds: 0n }, amount: '1500000000' }),
      create(MaxSupplyReleaseSchema, { releaseDate: { seconds: releaseTime }, amount: '998500000000' })
    ],
    premintWallets: [
      create(PreMintWalletSchema, { address: ownerAddress, amount: '1000000000' }),
      create(PreMintWalletSchema, { address: recipientAddress, amount: '500000000' })
    ],
    restrictedKeys: [
      create(RestrictedKeySchema, { publicKey: { walletAddress: ownerAddress }, updateContract: true, mint: true }),
      create(RestrictedKeySchema, { publicKey: { walletAddress: recipientAddress }, compliance: true })
    ],
    governance: create(GovernanceSchema, {
      type: GOVERNANCE_TYPE.STAGGERED, regularQuorum: 5010, threshold: 25,
      votingPeriod: 4, proposalPeriod: PROPOSAL_PERIOD.DAYS,
      allowedProposalInstrument: [KALVORA_NATIVE_TOKEN], votingInstrument: [KALVORA_NATIVE_TOKEN],
      votingRatio: [{ contractId: KALVORA_NATIVE_TOKEN, numerator: 1n, denominator: 1n }]
    }),
    contractFees: create(ContractFeesSchema, {
      contractFeeType: CONTRACT_FEE_TYPE.PERCENTAGE, fee: convertPercentToContractFeePercent(2.5),
      feeAddress: ownerAddress, burn: '50', validator: '30', allowedFeeInstrument: [KALVORA_NATIVE_TOKEN]
    }),
    expenseRatio: [create(ExpenseRatioSchema, { day: 1, month: 1, percent: 1000 })],
    customParameters: [create(KeyValuePairSchema, { key: 'website', value: 'https://example.org' })],
    tokenCompliance: [create(TokenComplianceSchema, {
      compliance: [{ contractId: KALVORA_NATIVE_TOKEN, complianceLevel: 1 }]
    })],
    kycStatus: false, immutableKycStatus: false, updateContractFees: true, updateExpenseRatio: true
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const contract = await createContractExample(FalconWallet.generate(exampleNetwork));
  console.log('Signed offline token creation', contract.contractId);
}
