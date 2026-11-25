import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { sha3_256 } from '@noble/hashes/sha3.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import vectors from '../../../docs/kalvora-js-protocol-handoff-2026-11-25/tests/transactions/falcon_wallet_vectors.json';
import { WalletRegistrationSchema } from '../../../proto/generated/txn_pb.js';
import { validateBase58Address } from '../../shared/utils/validation.js';
import {
  decodeWalletAddress, deriveFalconAddress, FalconWallet, falconSignatureSize, FALCON_VARIANT,
  isWalletAddress, verifyFalconSignature, WALLET_HASH
} from '../falcon.js';

const pin = { networkName: 'kal_main', genesisHash: '47'.repeat(32) } as const;
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));

describe('Falcon interoperability', () => {
  it.each(vectors.single_wallets)('matches every address and saved registration for $variant', fixture => {
    const key = bytes(fixture.raw_public_key);
    for (const [name, id] of Object.entries(WALLET_HASH)) {
      const digest = deriveFalconAddress(key, id);
      expect(Buffer.from(digest).toString('hex')).toBe(fixture.addresses[name as keyof typeof fixture.addresses]);
      const display = bs58.encode(digest);
      expect(decodeWalletAddress(display)).toEqual(digest);
      expect(validateBase58Address(display).isValid).toBe(true);
    }
    const wire = bytes(fixture.signed_registration);
    const txn = fromBinary(WalletRegistrationSchema, wire);
    expect(toBinary(WalletRegistrationSchema, txn)).toEqual(wire);
    const base = txn.base!;
    const hash = base.hash;
    delete base.hash;
    expect(sha3_256(toBinary(WalletRegistrationSchema, txn))).toEqual(hash);
    if (base.feePayer) {
      const sponsorProof = base.feePayer.signature!;
      base.feePayer.signature = new Uint8Array();
      const sponsorKey = bytes(vectors.single_wallets[0]!.raw_public_key);
      expect(verifyFalconSignature(sponsorKey, toBinary(WalletRegistrationSchema, txn), sponsorProof)).toBe(true);
      delete base.feePayer;
    }
    const signature = base.signature!;
    delete base.signature;
    const preimage = toBinary(WalletRegistrationSchema, txn);
    expect(verifyFalconSignature(key, preimage, signature)).toBe(true);
    expect(verifyFalconSignature(key, wire, signature)).toBe(false);
  });

  it.each(Object.values(FALCON_VARIANT))('generates, backs up, restores and signs with variant %s', async variant => {
    const wallet = FalconWallet.generate({ ...pin, variant, walletHash: WALLET_HASH.BLAKE3_9001 });
    const backup = JSON.parse(JSON.stringify(wallet.exportBackup()));
    expect(JSON.stringify(wallet)).not.toContain(backup.secretKey);
    const restored = FalconWallet.restore(backup);
    expect(wallet.walletAddress).toBe(restored.walletAddress);
    expect(wallet.chainId).toEqual(restored.chainId);
    const data = Uint8Array.of(4, 0, 7);
    const signature = await wallet.sign(data);
    const second = await restored.sign(data);
    expect(signature).toHaveLength(falconSignatureSize(variant));
    expect(signature).not.toEqual(second);
    expect(verifyFalconSignature(wallet.rawPublicKey, data, second)).toBe(true);
    expect(() => FalconWallet.restore({ ...backup, walletHash: WALLET_HASH.SHA3_512 })).toThrow('address');
  });

  it('preserves leading zeroes and rejects unsupported widths, padding, key headers and hash IDs', () => {
    expect(decodeWalletAddress('1'.repeat(32))).toEqual(new Uint8Array(32));
    expect(isWalletAddress('1'.repeat(31))).toBe(false);
    const wide = new Uint8Array(1126);
    wide[1125] = 1;
    expect(isWalletAddress(bs58.encode(wide))).toBe(false);
    expect(() => deriveFalconAddress(new Uint8Array(897))).toThrow('header');
    const malformed = bytes(vectors.single_wallets[0]!.raw_public_key);
    malformed[1] = malformed[2] = 0xff;
    expect(() => deriveFalconAddress(malformed)).toThrow('coefficient');
    expect(() => deriveFalconAddress(bytes(vectors.single_wallets[0]!.raw_public_key), 0)).toThrow('hash');
  });
});
