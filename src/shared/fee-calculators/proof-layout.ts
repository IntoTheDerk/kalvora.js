import { clone, create } from '@bufbuild/protobuf';
import bs58 from 'bs58';

import { FeePayerSchema, WalletWitnessSchema, type FalconVariant, type PublicKey } from '../../../proto/generated/txn_pb.js';
import { getSchemaForTypeName } from '../../adapter/serialization.js';
import { createValidatorAPIClient } from '../../grpc/api/validator-api-client.js';
import { allowsFeePayer } from '../../sign/resources.js';
import type { GRPCConfig } from '../../types/index.js';
import { getKeyTypeFromPublicKey, getPublicKeyIdentifierFromBytes } from '../crypto/address-utils.js';
import { decodeWalletAddress, falconSignatureSize } from '../crypto/falcon-address.js';

import { getSignatureSize } from './base-fee-constants.js';
import type { TransactionMessage } from './universal-fee-calculator.js';

export type SignerProofLayout = FalconVariant | readonly { slot: number; variant: FalconVariant }[];

export interface ProofLayout {
  owner?: SignerProofLayout;
  coin?: readonly SignerProofLayout[];
  sponsor?: { address: string; nonce: bigint; variant: FalconVariant };
  operator?: FalconVariant;
}

/** Size the actual protobuf fields, including enclosing message length prefixes. */
export async function signedFeeTemplate(txn: TransactionMessage, layout: ProofLayout = {}, config?: GRPCConfig) {
  const schema = getSchemaForTypeName(txn.$typeName);
  if (!schema || !txn.base) throw new Error('Cannot size transaction without a concrete schema and base envelope');
  const copy = clone(schema, txn) as TransactionMessage;
  const base = copy.base;
  if (!base) throw new Error('Missing base envelope');
  base.hash = new Uint8Array(32);

  async function placeholder(key: PublicKey | undefined, selected?: SignerProofLayout): Promise<Uint8Array> {
    if (!key) throw new Error('Signer identity required for a fee quote');
    if (key.governanceAuth || key.smartContractAuth) return new Uint8Array();
    if (selected === undefined && key.walletAddress) {
      const { identity } = await createValidatorAPIClient(config).getSigningWallet(bs58.encode(key.walletAddress));
      if (identity.case !== 'falcon') throw new Error('Provide the selected witness slots and variants for a policy fee quote');
      selected = identity.value.variant;
    }
    if (selected === undefined) return new Uint8Array(getSignatureSize(getKeyTypeFromPublicKey(getPublicKeyIdentifierFromBytes(key.single))));
    if (typeof selected === 'number') return new Uint8Array(falconSignatureSize(selected));
    if (!selected.length || selected.length > 64) throw new Error('Select 1 to 64 policy witnesses for the fee quote');
    let previous = -1;
    key.witnesses = selected.map(({ slot, variant }) => {
      if (!Number.isInteger(slot) || slot <= previous || slot >= 64) throw new Error('Invalid policy witness slots for fee quote');
      previous = slot;
      return create(WalletWitnessSchema, { slot, signature: new Uint8Array(falconSignatureSize(variant)) });
    });
    return new Uint8Array();
  }

  if (copy.$typeName === 'kal_txn.CoinTXN') {
    if (!copy.auth?.publicKey.length || layout.sponsor || base.feePayer) throw new Error('Coin fees require authorization inputs');
    if (layout.coin && layout.coin.length !== copy.auth.publicKey.length) throw new Error('Supply a proof layout for each Coin authorization');
    copy.auth.signature = await Promise.all(copy.auth.publicKey.map((key, i) => placeholder(key, layout.coin?.[i])));
  } else {
    const registrationVariant = copy.$typeName === 'kal_txn.WalletRegistration' && copy.identity.case === 'falcon'
      ? copy.identity.value.variant : undefined;
    const owner = await placeholder(base.publicKey, layout.owner ?? registrationVariant);
    if (owner.length) base.signature = owner;
    else delete base.signature;
    if (layout.sponsor) {
      const { address, nonce, variant } = layout.sponsor;
      if (!allowsFeePayer(copy.$typeName) || !base.publicKey?.walletAddress || bs58.encode(base.publicKey.walletAddress) === address ||
          nonce <= 0n || nonce > 0xffffffffffffffffn) throw new Error('Invalid sponsor for the fee quote');
      base.feePayer = create(FeePayerSchema, { publicKey: { walletAddress: decodeWalletAddress(address) }, nonce,
        signature: new Uint8Array(falconSignatureSize(variant)) });
    }
    if (copy.$typeName === 'kal_txn.ValidatorRegistration' && copy.register && copy.generatedPublicKey) {
      copy.generatedSignature = await placeholder(copy.generatedPublicKey, layout.operator);
    }
  }
  return { copy, schema };
}
