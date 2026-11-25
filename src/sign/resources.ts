import { clone, fromBinary, isMessage, toBinary, type Message } from '@bufbuild/protobuf';

import {
  PublicKeySchema, type BaseTXN, type CoinTXN, type GovernanceProposal, type GovernanceTXN,
  type PublicKey, type ValidatorRegistration
} from '../../proto/generated/txn_pb.js';
import { getSchemaForTypeName } from '../adapter/serialization.js';
import { isWalletAddressBytes } from '../shared/crypto/falcon-address.js';
import { createTransactionHash } from '../shared/crypto/signature-utils.js';

const sponsorTypes = new Set([
  'GovernanceVote', 'GovernanceProposal', 'ProposalCancelTXN', 'WalletRegistration', 'DelegatedTXN',
  'NFTTXN', 'MintTXN', 'ItemizedMintTXN', 'BurnSBTTXN', 'InstrumentContract', 'ContractUpdateTXN',
  'ExpenseRatioTXN', 'RevokeTXN', 'ComplianceTXN', 'AllowanceTXN', 'SmartContractTXN',
  'SmartContractInstantiateTXN', 'SmartContractExecuteTXN'
].map(name => `kal_txn.${name}`));

export function allowsFeePayer(typeName: string): boolean {
  return sponsorTypes.has(typeName);
}

function registeredAddress(key?: PublicKey): Uint8Array {
  if (!key?.walletAddress || !isWalletAddressBytes(key.walletAddress) || key.single.length || key.multi ||
      key.smartContractAuth !== undefined || key.governanceAuth !== undefined || key.parentContract !== undefined) {
    throw new Error('Fresh-genesis submission requires registered wallet addresses');
  }
  return key.walletAddress;
}

function checkProof(key: PublicKey | undefined, signature: Uint8Array | undefined) {
  registeredAddress(key);
  const padded = (s?: Uint8Array) => s?.length === 666 || s?.length === 1280;
  if (key?.witnesses.length) {
    if (signature?.length) throw new Error('Policy authorization must contain only witnesses');
    let previous = -1;
    for (const { slot, signature: witness } of key.witnesses) {
      if (slot <= previous || slot >= 64 || !padded(witness)) throw new Error('Invalid policy witness');
      previous = slot;
    }
  } else if (!padded(signature)) throw new Error('Missing padded Falcon proof');
}

/** Verify the signed envelope before passing it to a fresh-genesis RPC. */
export function assertRegisteredSubmission(txn: Message & { base?: BaseTXN }): void {
  const base = txn.base;
  if (!base?.hash || base.hash.length !== 32) throw new Error('Expected a signed 32-byte transaction hash');
  const owner = registeredAddress(base.publicKey);
  if (txn.$typeName === 'kal_txn.CoinTXN') {
    if (base.signature !== undefined || base.feePayer || base.publicKey?.witnesses.length) throw new Error('Coin proofs belong in authorization slots');
    const auth = (txn as CoinTXN).auth;
    if (!auth || auth.signature.length !== auth.publicKey.length) throw new Error('Coin requires one proof slot per authorization');
    auth.publicKey.forEach((key, i) => checkProof(key, auth.signature[i]));
  } else {
    checkProof(base.publicKey, base.signature);
    if (base.publicKey?.witnesses.length && base.signature !== undefined) throw new Error('Policy base signature must be absent');
    if (base.feePayer) {
      const sponsor = registeredAddress(base.feePayer.publicKey);
      if (!allowsFeePayer(txn.$typeName) || base.feePayer.publicKey?.witnesses.length || base.feePayer.nonce <= 0n ||
          (owner.length === sponsor.length && owner.every((byte, i) => byte === sponsor[i]))) throw new Error('Invalid registered sponsor');
      checkProof(base.feePayer.publicKey, base.feePayer.signature);
    }
  }
  assertAuthenticationBudget(txn);
  const schema = getSchemaForTypeName(txn.$typeName);
  if (!schema) throw new Error('Unsupported transaction type');
  const copy = clone(schema, txn) as Message & { base?: BaseTXN };
  if (!copy.base) throw new Error('Missing transaction base');
  delete copy.base.hash;
  const digest = createTransactionHash(toBinary(schema, copy));
  if (base.hash.some((byte, i) => byte !== digest[i])) throw new Error('Signed transaction hash does not match its bytes');
}

// Only these transaction types can be serialized governance children.
const childTypes: Readonly<Record<number, string>> = {
  1: 'CoinTXN', 2: 'MintTXN', 3: 'ItemizedMintTXN', 4: 'InstrumentContract', 5: 'GovernanceVote',
  7: 'SmartContractTXN', 8: 'SmartContractExecuteTXN', 9: 'ExpenseRatioTXN', 10: 'NFTTXN',
  11: 'ContractUpdateTXN', 15: 'DelegatedTXN', 16: 'RevokeTXN', 19: 'ComplianceTXN',
  20: 'BurnSBTTXN', 21: 'RequiredVersion', 22: 'SmartContractInstantiateTXN', 23: 'AllowanceTXN', 24: 'ProposalCancelTXN'
};

export function governanceChildSchema(txnType: number) {
  const schema = getSchemaForTypeName(`kal_txn.${childTypes[txnType]}`);
  if (!schema) throw new Error('Unsupported serialized governance child');
  return schema;
}

/** Check the validator's aggregate authentication budgets, including every proposal option. */
export function assertAuthenticationBudget(txn: Message & { base?: BaseTXN }): void {
  let authBytes = 0;
  let verifications = 0;
  let verificationBytes = 0;

  function material(message: Message): void {
    if (isMessage(message, PublicKeySchema)) {
      authBytes += toBinary(PublicKeySchema, message).length;
      return;
    }
    if (message.$typeName === 'kal_txn.FalconPublicKey' || message.$typeName === 'kal_txn.WalletPolicy') {
      const schema = getSchemaForTypeName(message.$typeName);
      if (schema) authBytes += toBinary(schema, message).length;
      return;
    }
    for (const value of Object.values(message) as unknown[]) {
      if (isMessage(value)) material(value);
      else if (Array.isArray(value)) value.forEach(item => { if (isMessage(item)) material(item); });
      else if (value && typeof value === 'object' && 'case' in value && 'value' in value && isMessage(value.value)) material(value.value);
    }
  }

  function inspect(message: Message & { base?: BaseTXN }): void {
    const schema = getSchemaForTypeName(message.$typeName);
    if (!schema) throw new Error('Unknown transaction in authentication budget');
    const base = message.base;
    const isCoin = message.$typeName === 'kal_txn.CoinTXN';
    let checks = 0;
    function proof(key?: PublicKey, signature?: Uint8Array, consumed = true) {
      authBytes += signature?.length ?? 0;
      if (consumed) checks += (signature?.length ? 1 : 0) + (key?.witnesses.length ?? 0);
    }
    material(message);
    proof(base?.publicKey, base?.signature, !isCoin);
    if (base?.feePayer) proof(base.feePayer.publicKey, base.feePayer.signature);
    if (isCoin) {
      const { auth, inputTransfers } = message as CoinTXN;
      if (!auth || !auth.publicKey.length || auth.publicKey.length > 64 || auth.publicKey.length !== auth.nonce.length ||
          (auth.signature.length !== 0 && auth.signature.length !== auth.publicKey.length) ||
          (auth.allowanceAddress.length ? (auth.publicKey.length !== 1 || auth.allowanceAddress.length !== inputTransfers.length) :
            auth.publicKey.length !== inputTransfers.length) || auth.allowanceAddress.length !== auth.allowanceNonce.length) {
        throw new Error('Invalid Coin authorization, allowance, or nonce slot count');
      }
      auth.publicKey.forEach((key, i) => proof(key, auth.signature[i]));
    }
    if (message.$typeName === 'kal_txn.ValidatorRegistration') {
      const reg = message as ValidatorRegistration;
      proof(undefined, reg.generatedSignature, reg.register);
    }
    verifications += checks;
    verificationBytes += checks * toBinary(schema, message).length;
    if (authBytes > 256 * 1024 || verifications > 64 || verificationBytes > 8 * 1024 * 1024) {
      throw new Error('Transaction exceeds validator authentication budget');
    }
    if (message.$typeName === 'kal_txn.GovernanceProposal') {
      const proposal = message as GovernanceProposal;
      const children = [...proposal.governanceTxn, ...proposal.governanceOptionTxns.flatMap(option => option.governanceTxn)];
      if (children.length > 256) throw new Error('Proposal exceeds 256 governance actions');
      children.forEach((child: GovernanceTXN) => {
        inspect(fromBinary(governanceChildSchema(child.txnType), child.serializedTxn));
      });
    }
  }
  inspect(txn);
}
