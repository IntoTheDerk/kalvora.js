/** Run with npx tsx src/contract/update/examples/example.ts. Both transactions are signed offline. */
import { pathToFileURL } from 'node:url';

import { clone, create } from '@bufbuild/protobuf';

import {
  ContractFeesSchema, KeyValuePairSchema, RestrictedKeySchema, type InstrumentContract
} from '../../../../proto/generated/txn_pb.js';
import { KALVORA_NATIVE_TOKEN } from '../../../shared/network/constants.js';
import { FalconWallet, decodeWalletAddress } from '../../../wallet-creation/falcon.js';
import { createContractExample, exampleNetwork } from '../../create/examples/example.js';
import { convertPercentToContractFeePercent } from '../../shared/utils.js';
import { createContractUpdateTXN } from '../transaction.js';

export async function updateContractExample(owner: FalconWallet, current: InstrumentContract) {
  if (!current.contractFees) throw new Error('The example expects an existing percentage fee schedule');
  const contractFees = clone(ContractFeesSchema, current.contractFees);
  contractFees.fee = convertPercentToContractFeePercent(1);
  const operator = FalconWallet.generate(exampleNetwork);
  // Carry forward the direct recovery grant when replacing the grant list.
  const restrictedKeys = [
    ...current.restrictedKeys,
    create(RestrictedKeySchema, { publicKey: { walletAddress: decodeWalletAddress(operator.walletAddress) }, vote: true })
  ];
  return createContractUpdateTXN({
    contractId: current.contractId, contractVersion: current.contractVersion + 1n,
    publicKeyBase58Identifier: owner.walletAddress, privateKeyBase58: owner,
    // Assumes registration used nonce 1 and token creation used nonce 2.
    nonce: 3n, feeId: KALVORA_NATIVE_TOKEN, feeAmountParts: '1000000000',
    name: 'Updated Example Token',
    restrictedKeys,
    contractFees,
    customParameters: [create(KeyValuePairSchema, { key: 'website', value: 'https://example.org/token' })],
    kycStatus: false
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const owner = FalconWallet.generate(exampleNetwork);
  const current = await createContractExample(owner);
  const update = await updateContractExample(owner, current);
  console.log('Signed offline token update', update.contractId, update.contractVersion.toString());
}

