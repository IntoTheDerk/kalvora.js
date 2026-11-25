import { toBinary } from '@bufbuild/protobuf';
import bs58 from 'bs58';

import { WalletHash, WalletPolicySchema, type WalletPolicy } from '../../proto/generated/txn_pb.js';
import { decodeWalletAddress, deriveFalconAddress, hashWalletIdentity } from '../shared/crypto/falcon-address.js';

/** Encode the permanent, ordered membership and thresholds independently of protobuf. */
export function encodePolicyDescriptor(policy: WalletPolicy, walletHash: WalletHash = WalletHash.BLAKE3_256): Uint8Array {
  if (walletHash < 1 || walletHash > 11 || !Number.isInteger(walletHash)) throw new Error('Unknown wallet hash');
  if (!policy.members.length || policy.members.length > 64 || !policy.patterns.length || policy.patterns.length > 64) {
    throw new Error('A policy requires 1 to 64 members and 1 to 64 patterns');
  }
  const limit = 128 * 1024;
  if (toBinary(WalletPolicySchema, policy).length > limit) throw new Error('Policy exceeds 128 KiB');
  const bytes = [...new TextEncoder().encode('KAL_WALLET_MULTISIG_V1')];
  const u32 = (n: number) => {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('Expected an unsigned 32-bit policy integer');
    bytes.push(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  };
  u32(1);
  u32(walletHash);
  u32(policy.members.length);
  const counts = new Map<number, number>();
  const addresses = new Set<string>();
  for (const { classId, walletAddress } of policy.members) {
    const address = bs58.encode(walletAddress);
    decodeWalletAddress(address);
    if (addresses.has(address)) throw new Error('Duplicate policy member address');
    addresses.add(address);
    counts.set(classId, (counts.get(classId) ?? 0) + 1);
    u32(classId);
    u32(walletAddress.length);
    bytes.push(...walletAddress);
  }
  u32(policy.patterns.length);
  for (const { thresholds } of policy.patterns) {
    if (thresholds.length > 64 || !thresholds.some(t => t.required > 0)) throw new Error('Invalid policy threshold count');
    u32(thresholds.length);
    const seen = new Set<number>();
    for (const { classId, required } of thresholds) {
      const members = counts.get(classId);
      if (seen.has(classId) || members === undefined || required > members) throw new Error('Unsatisfiable or repeated class threshold');
      seen.add(classId);
      u32(classId);
      u32(required);
    }
  }
  if (bytes.length > limit) throw new Error('Policy descriptor exceeds 128 KiB');
  return Uint8Array.from(bytes);
}

export function derivePolicyAddress(policy: WalletPolicy, walletHash = WalletHash.BLAKE3_256): Uint8Array {
  return hashWalletIdentity(encodePolicyDescriptor(policy, walletHash), walletHash);
}

export interface PolicyMemberKey {
  rawPublicKey: Uint8Array;
  walletHash: WalletHash;
}

/** Check all registered member records in slot order, including aliases with different hashes. */
export function validatePolicyMemberKeys(policy: WalletPolicy, keys: readonly PolicyMemberKey[]): void {
  if (keys.length !== policy.members.length) throw new Error('Supply one registered single-key identity per policy member');
  const seen = new Set<string>();
  keys.forEach(({ rawPublicKey, walletHash }, slot) => {
    const key = bs58.encode(rawPublicKey);
    if (seen.has(key)) throw new Error('Policy members must control distinct Falcon keys');
    seen.add(key);
    const member = policy.members[slot];
    if (!member || bs58.encode(deriveFalconAddress(rawPublicKey, walletHash)) !== bs58.encode(member.walletAddress)) {
      throw new Error(`Falcon key does not derive the address at policy slot ${slot}`);
    }
  });
}
