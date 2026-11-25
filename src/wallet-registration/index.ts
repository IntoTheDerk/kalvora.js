import bs58 from 'bs58';

import { WalletHash, WalletRegistrationSchema, type FalconVariant, type WalletPolicy } from '../../proto/generated/txn_pb.js';
import { deriveFalconAddress } from '../shared/crypto/falcon-address.js';
import { buildStandardTransaction, type StandardTXNOptions } from '../shared/tx/standard.js';

import { derivePolicyAddress, validatePolicyMemberKeys, type PolicyMemberKey } from './policy.js';

export { derivePolicyAddress, encodePolicyDescriptor, validatePolicyMemberKeys, type PolicyMemberKey } from './policy.js';

export type WalletRegistrationInput = { walletHash?: WalletHash } & (
  | { variant: FalconVariant; rawPublicKey: Uint8Array }
  | { policy: WalletPolicy; memberKeys: readonly PolicyMemberKey[] }
);

/** Build an unsigned registration. A fresh address signs with nonce one. */
export async function buildWalletRegistration(input: WalletRegistrationInput, options: StandardTXNOptions = {}) {
  const walletHash = input.walletHash ?? WalletHash.BLAKE3_256;
  const isPolicy = 'policy' in input;
  const address = isPolicy ? derivePolicyAddress(input.policy, walletHash) : deriveFalconAddress(input.rawPublicKey, walletHash);
  if (isPolicy) validatePolicyMemberKeys(input.policy, input.memberKeys);
  else if (input.variant !== (input.rawPublicKey[0] === 9 ? 1 : 2)) throw new Error('Falcon variant and public key disagree');
  return buildStandardTransaction({
    operation: 'buildWalletRegistration',
    schema: WalletRegistrationSchema,
    publicKeyId: bs58.encode(address),
    fields: {
      walletHash,
      identity: isPolicy ? { case: 'policy', value: input.policy } :
        { case: 'falcon', value: { rawPublicKey: input.rawPublicKey, variant: input.variant } }
    },
    options
  });
}
