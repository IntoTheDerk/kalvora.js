import { clone, fromBinary, toBinary } from '@bufbuild/protobuf';
import { createRouterTransport } from '@connectrpc/connect';
import { sha3_256 } from '@noble/hashes/sha3.js';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import { ValidatorHeartbeatSchema, ValidatorRegistrationSchema } from '../../../proto/generated/txn_pb.js';
import { ValidatorService } from '../../../proto/generated/validator_pb.js';
import { bytesToHex } from '../../shared/utils/byte-utils.js';
import { getTransactionSigningBytes, signAndFinalize } from '../../sign/finalize.js';
import { decodeWalletAddress, deriveFalconAddress, FalconWallet, verifyFalconSignature } from '../../wallet-creation/falcon.js';
import {
  attachGeneratedSignature, buildValidatorHeartbeatTXN, buildValidatorRegistrationTXN,
  createValidatorHeartbeatTXN, createValidatorRegistrationTXN, sendValidatorHeartbeatTXN, sendValidatorRegistrationTXN,
  type ValidatorHeartbeatInput, type ValidatorRegistrationInput
} from '../index.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const network = { networkName: 'kal_main', genesisHash: '47'.repeat(32) } as const;
const owner = FalconWallet.generate(network);
const operator = FalconWallet.generate({ ...network, variant: 2 });

const KALX = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
const OPTIONS = {
  nonce: 9,
  feeAmountParts: '100',
  timestamp: new Date('2026-07-25T09:22:00.000Z')
};
const RECORD_TIME = new Date('2026-07-25T09:21:30.500Z');
const REG_INPUT: ValidatorRegistrationInput = {
  publicKey: owner.walletAddress,
  generatedPublicKey: operator.walletAddress,
  register: true,
  validator: {
    host: 'node1.example.com',
    clientPort: '50052',
    validatorPort: 50051,
    benchmark: '123456789012',
    timestamp: RECORD_TIME,
    lite: true,
    online: true,
    version: 100,
    lastHeartbeat: 42n
  }
};
const HB_INPUT: ValidatorHeartbeatInput = { publicKey: operator.walletAddress, ownerAddress: owner.walletAddress, online: true, version: 101 };


function withValidator(override: Record<string, unknown>): ValidatorRegistrationInput {
  return { ...REG_INPUT, validator: { ...REG_INPUT.validator, ...override } } as ValidatorRegistrationInput;
}

describe('ValidatorRegistration', () => {
  it('carries the attestation key and proof without using client-supplied liveness time', async () => {
    const attestationKey = {
      version: 1n,
      publicKey: new Uint8Array(48).fill(2),
      proofOfPossession: new Uint8Array(96).fill(3)
    };
    const txn = await buildValidatorRegistrationTXN(withValidator({ attestationKey }), OPTIONS);
    expect(txn.validator?.attestationKey).toMatchObject(attestationKey);
    const decoded = fromBinary(ValidatorRegistrationSchema, toBinary(ValidatorRegistrationSchema, txn));
    expect(decoded.validator?.attestationKey).toMatchObject(attestationKey);
    expect(decoded.validator?.lastHeartbeatTimeSeconds).toBe(0n);
    attestationKey.publicKey.fill(9);
    expect(txn.validator?.attestationKey?.publicKey[0]).toBe(2);
  });

  it.each([
    { version: 1, publicKey: new Uint8Array(47), proofOfPossession: new Uint8Array(96) },
    { version: 1, publicKey: new Uint8Array(48), proofOfPossession: new Uint8Array(95) },
    { version: -1, publicKey: new Uint8Array(48), proofOfPossession: new Uint8Array(96) }
  ])('rejects malformed attestation key material %#', async attestationKey => {
    await expect(buildValidatorRegistrationTXN(withValidator({ attestationKey }), OPTIONS))
      .rejects.toThrow(/validator.attestationKey/u);
  });

  it('maps input fields onto an unsigned ValidatorRegistration', async () => {
    const txn = await buildValidatorRegistrationTXN(REG_INPUT, { ...OPTIONS, memo: 'hello' });

    expect(txn.$typeName).toBe('kal_txn.ValidatorRegistration');
    expect(txn.register).toBe(true);
    expect(txn.generatedPublicKey?.walletAddress).toEqual(decodeWalletAddress(operator.walletAddress));
    expect(txn.generatedSignature).toEqual(new Uint8Array(0));

    const v = txn.validator;
    expect(v?.publicKey?.walletAddress).toEqual(decodeWalletAddress(owner.walletAddress));
    expect(v?.host).toBe('node1.example.com');
    expect(v?.clientPort).toBe('50052');
    expect(v?.validatorPort).toBe('50051');
    expect(v && 'stakedContractIds' in v).toBe(false);
    expect(v?.benchmark).toBe(123456789012n);
    expect(v?.timestamp?.seconds).toBe(BigInt(Math.floor(RECORD_TIME.getTime() / 1000)));
    expect(v?.timestamp?.nanos).toBe(500_000_000);
    expect(v?.lite).toBe(true);
    expect(v?.online).toBe(true);
    expect(v?.version).toBe(100);
    expect(v?.lastHeartbeat).toBe(42n);

    expect(txn.base?.publicKey?.walletAddress).toEqual(decodeWalletAddress(owner.walletAddress));
    expect(txn.base?.nonce).toBe(9n);
    expect(txn.base?.feeAmount).toBe('100');
    expect(txn.base?.feeId).toBe(KALX);
    expect(txn.base?.memo).toBe('hello');
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.hash).toBeUndefined();
  });

  it('applies defaults for optional validator fields', async () => {
    const before = Date.now();
    const txn = await buildValidatorRegistrationTXN(
      {
        publicKey: owner.walletAddress,
        register: false,
        validator: { publicKey: owner.walletAddress, host: '10.0.0.5', clientPort: 1, validatorPort: '65535' }
      },
      OPTIONS
    );
    const v = txn.validator;
    expect(txn.register).toBe(false);
    expect(txn.generatedPublicKey).toBeUndefined();
    expect(txn.generatedSignature).toHaveLength(0);
    expect(v?.publicKey?.walletAddress).toEqual(decodeWalletAddress(owner.walletAddress));
    expect(v?.clientPort).toBe('1');
    expect(v?.validatorPort).toBe('65535');
    expect(v?.benchmark).toBe(0n);
    expect(v?.lite).toBe(false);
    expect(v?.online).toBe(false);
    expect(v?.version).toBe(0);
    expect(v?.lastHeartbeat).toBe(0n);
    const seconds = Number(v?.timestamp?.seconds);
    expect(seconds).toBeGreaterThanOrEqual(Math.floor(before / 1000));
    expect(seconds).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000));
  });

  it.each([
    [withValidator({ host: '' }), /validator\.host must be a non-empty string/],
    [withValidator({ host: 'bad host' }), /validator\.host must be a non-empty string/],
    [withValidator({ host: 5 }), /validator\.host must be a non-empty string/],
    [withValidator({ clientPort: '0' }), /validator\.clientPort must be a port number/],
    [withValidator({ clientPort: '65536' }), /validator\.clientPort must be a port number/],
    [withValidator({ clientPort: 'abc' }), /validator\.clientPort must be a port number/],
    [withValidator({ clientPort: '' }), /validator\.clientPort must be a port number/],
    [withValidator({ validatorPort: 80.5 }), /validator\.validatorPort must be a port number/],
    [withValidator({ validatorPort: -1 }), /validator\.validatorPort must be a port number/],
    [withValidator({ stakedContractIds: [KALX] }), /stakedContractIds is no longer part of the Kalvora protocol/],
    [withValidator({ stakedContractIds: [] }), /stakedContractIds is no longer part of the Kalvora protocol/],
    [withValidator({ version: -1 }), /validator\.version must be an unsigned 32-bit integer/],
    [withValidator({ version: 2 ** 32 }), /validator\.version must be an unsigned 32-bit integer/],
    [withValidator({ version: 1.5 }), /validator\.version must be an unsigned 32-bit integer/],
    [withValidator({ benchmark: '-1' }), /validator\.benchmark must be an unsigned 64-bit integer/],
    [withValidator({ benchmark: (2n ** 64n).toString() }), /validator\.benchmark must be an unsigned 64-bit integer/],
    [withValidator({ lastHeartbeat: 'x' }), /validator\.lastHeartbeat must be an unsigned 64-bit integer/],
    [withValidator({ lite: 'yes' }), /validator\.lite must be a boolean/],
    [withValidator({ timestamp: new Date('nope') }), /validator\.timestamp must be a valid Date/],
    [withValidator({ publicKey: 'nope' }), /validator\.publicKey is not a valid/],
    [{ ...REG_INPUT, validator: undefined }, /validator object is required/],
    [{ ...REG_INPUT, register: 'true' }, /register must be a boolean/],
    [{ ...REG_INPUT, publicKey: '' }, /publicKey identifier is required/],
    [{ ...REG_INPUT, generatedPublicKey: undefined }, /generatedPublicKey identifier is required/],
    [{ ...REG_INPUT, generatedPublicKey: 'garbage' }, /generatedPublicKey is not a valid/]
  ])('rejects invalid input #%#', async (input, message) => {
    await expect(buildValidatorRegistrationTXN(input as ValidatorRegistrationInput, OPTIONS)).rejects.toThrow(message);
  });

  it('rejects a missing input object and invalid shared options', async () => {
    await expect(buildValidatorRegistrationTXN(undefined as unknown as ValidatorRegistrationInput, OPTIONS))
      .rejects.toThrow(/input object is required/);
    await expect(buildValidatorRegistrationTXN(REG_INPUT, { ...OPTIONS, feeId: 'bad id' })).rejects.toThrow(/feeId/);
  });

  it('binds the same assignment bytes to two independent Falcon proofs and hashes both', async () => {
    const txn = await createValidatorRegistrationTXN(REG_INPUT, owner, operator, OPTIONS);
    const bytes = getTransactionSigningBytes(txn, { chainId: owner.chainId });
    expect(verifyFalconSignature(owner.rawPublicKey, bytes, txn.base!.signature!)).toBe(true);
    expect(verifyFalconSignature(operator.rawPublicKey, bytes, txn.generatedSignature)).toBe(true);
    expect(txn.generatedSignature).toHaveLength(1280);
    const copy = clone(ValidatorRegistrationSchema, txn);
    delete copy.base!.hash;
    expect(txn.base!.hash).toEqual(sha3_256(toBinary(ValidatorRegistrationSchema, copy)));
  });

  it('refuses mismatched owner, same-key alias, and cross-chain operator', async () => {
    await expect(buildValidatorRegistrationTXN(withValidator({ publicKey: operator.walletAddress }), OPTIONS)).rejects.toThrow('owner');
    const alias = { ...operator, chainId: owner.chainId, rawPublicKey: owner.rawPublicKey, sign: owner.sign.bind(owner),
      walletHash: 2, walletAddress: bs58.encode(deriveFalconAddress(owner.rawPublicKey, 2)) };
    await expect(createValidatorRegistrationTXN({ ...REG_INPUT, generatedPublicKey: alias.walletAddress }, owner, alias, OPTIONS)).rejects.toThrow('distinct underlying keys');
    const other = FalconWallet.generate({ ...network, genesisHash: '77'.repeat(32) });
    await expect(createValidatorRegistrationTXN({ ...REG_INPUT, generatedPublicKey: other.walletAddress }, owner, other, OPTIONS)).rejects.toThrow('trusted target chain');
  });

  it('rejects changes to the owner-approved assignment before the operator signs', async () => {
    const txn = await buildValidatorRegistrationTXN(REG_INPUT, { ...OPTIONS, grpcConfig: { transactionContext: { chainId: owner.chainId } } });
    await signAndFinalize(txn, owner);
    txn.validator!.host = 'changed.test';
    await expect(attachGeneratedSignature(txn, owner, operator)).rejects.toThrow('Invalid owner signature');
    expect(txn.generatedSignature).toHaveLength(0);
  });

  it('routes owner-only deregistration and the operational heartbeat to ValidatorService', async () => {
    const deregistration = await createValidatorRegistrationTXN({ publicKey: owner.walletAddress, register: false, validator: REG_INPUT.validator }, owner, undefined, OPTIONS);
    expect(deregistration.generatedPublicKey).toBeUndefined();
    expect(deregistration.generatedSignature).toHaveLength(0);
    const registrationRpc = vi.fn(() => ({}));
    const heartbeatRpc = vi.fn(() => ({}));
    const transport = createRouterTransport(router => router.service(ValidatorService, {
      validatorRegistration: registrationRpc, validatorHeartbeat: heartbeatRpc
    }));
    expect(await sendValidatorRegistrationTXN(deregistration, { transport })).toBe(bytesToHex(deregistration.base!.hash!));
    const hb = await createValidatorHeartbeatTXN(HB_INPUT, operator, OPTIONS);
    expect(hb.base?.publicKey?.walletAddress).toEqual(decodeWalletAddress(operator.walletAddress));
    expect(hb.base?.nonce).toBe(9n);
    expect(verifyFalconSignature(operator.rawPublicKey, getTransactionSigningBytes(hb, { chainId: operator.chainId }), hb.base!.signature!)).toBe(true);
    expect(await sendValidatorHeartbeatTXN(hb, { transport })).toBe(bytesToHex(hb.base!.hash!));
    expect(registrationRpc).toHaveBeenCalledOnce();
    expect(heartbeatRpc).toHaveBeenCalledOnce();
  });

  it('enforces the heartbeat memo, fee-field and signed size limits', async () => {
    await expect(buildValidatorHeartbeatTXN(HB_INPUT, { ...OPTIONS, memo: 'é'.repeat(33) })).rejects.toThrow('64 bytes');
    await expect(buildValidatorHeartbeatTXN(HB_INPUT, { ...OPTIONS, interfaceFee: '0' })).rejects.toThrow('interface fee');
    const txn = await createValidatorHeartbeatTXN(HB_INPUT, operator, { ...OPTIONS, memo: 'é'.repeat(32) });
    expect(toBinary(ValidatorHeartbeatSchema, txn).length).toBeLessThanOrEqual(4096);
    txn.base!.signature = new Uint8Array(4100);
    await expect(sendValidatorHeartbeatTXN(txn)).rejects.toThrow('signed size');
  });

  it('checks detached owner metadata and requires single-key owner and operator identities', async () => {
    const grpcConfig = { transactionContext: { chainId: owner.chainId } };
    const txn = await buildValidatorRegistrationTXN(REG_INPUT, { ...OPTIONS, grpcConfig });
    await signAndFinalize(txn, owner);
    const badMetadata = { walletAddress: owner.walletAddress, walletHash: owner.walletHash, rawPublicKey: owner.rawPublicKey,
      chainId: owner.chainId, variant: operator.variant };
    await expect(attachGeneratedSignature(txn, badMetadata, operator)).rejects.toThrow('metadata');
    txn.generatedPublicKey!.single = Uint8Array.of(1);
    await expect(attachGeneratedSignature(txn, owner, operator)).rejects.toThrow('single-key');
    expect(txn.generatedSignature).toHaveLength(0);
  });

  it('checks the completed hash, both role identities and proof widths before validator RPCs', async () => {
    const register = vi.fn(() => ({}));
    const heartbeat = vi.fn(() => ({}));
    const transport = createRouterTransport(router => router.service(ValidatorService, {
      validatorRegistration: register, validatorHeartbeat: heartbeat
    }));
    const config = { transactionContext: { chainId: owner.chainId }, transport };
    const valid = await createValidatorRegistrationTXN(REG_INPUT, owner, operator, OPTIONS);
    expect(await sendValidatorRegistrationTXN(valid, config)).toBe(bytesToHex(valid.base!.hash!));
    const altered = clone(ValidatorRegistrationSchema, valid);
    altered.validator!.host = 'altered.test';
    await expect(sendValidatorRegistrationTXN(altered, config)).rejects.toThrow('hash does not match');
    altered.validator!.publicKey = altered.generatedPublicKey;
    await expect(sendValidatorRegistrationTXN(altered, config)).rejects.toThrow('owner identities');
    const truncated = clone(ValidatorRegistrationSchema, valid);
    truncated.generatedSignature = truncated.generatedSignature.subarray(1);
    await expect(sendValidatorRegistrationTXN(truncated, config)).rejects.toThrow('padded operational');
    expect(register).toHaveBeenCalledOnce();
    const hb = await createValidatorHeartbeatTXN(HB_INPUT, operator, OPTIONS);
    hb.online = !hb.online;
    await expect(sendValidatorHeartbeatTXN(hb, config)).rejects.toThrow('hash does not match');
    delete hb.base!.publicKey!.walletAddress;
    hb.base!.publicKey!.single = Uint8Array.of(1);
    await expect(sendValidatorHeartbeatTXN(hb, config)).rejects.toThrow('single-key');
    expect(heartbeat).not.toHaveBeenCalled();
  });
});
