import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { createRouterTransport } from '@connectrpc/connect';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  BaseTXNSchema,
  ValidatorHeartbeatSchema,
  ValidatorRegistrationSchema,
  type ValidatorHeartbeat,
  type ValidatorRegistration
} from '../../../proto/generated/txn_pb.js';
import { ValidatorService } from '../../../proto/generated/validator_pb.js';
import { getPublicKeyBytes } from '../../shared/crypto/address-utils.js';
import { bytesToHex } from '../../shared/utils/byte-utils.js';
import { signWithKey } from '../../sign/finalize.js';
import { ED25519_TEST_KEYS, ED448_TEST_KEYS } from '../../test-utils/keys.test.js';
import {
  attachGeneratedSignature,
  buildValidatorHeartbeatTXN,
  buildValidatorRegistrationTXN,
  createValidatorHeartbeatTXN,
  createValidatorRegistrationTXN,
  sendValidatorHeartbeatTXN,
  sendValidatorRegistrationTXN,
  type ValidatorHeartbeatInput,
  type ValidatorRegistrationInput
} from '../index.js';

// vitest.setup.ts stubs ConnectRPC globally; use the real implementation so
// createRouterTransport can exercise the actual ValidatorService client.
vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const { alice: operator, bob: node, charlie } = ED25519_TEST_KEYS;
const KALX = 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao';
const OPTIONS = {
  nonce: 9,
  feeAmountParts: '100',
  timestamp: new Date('2026-07-25T09:22:00.000Z')
};
const RECORD_TIME = new Date('2026-07-25T09:21:30.500Z');
const REG_INPUT: ValidatorRegistrationInput = {
  publicKey: operator.publicKey,
  generatedPublicKey: node.publicKey,
  register: true,
  validator: {
    host: 'node1.example.com',
    clientPort: '50052',
    validatorPort: 50051,
    stakedContractIds: [KALX, 'USDX0001'],
    benchmark: '123456789012',
    timestamp: RECORD_TIME,
    lite: true,
    online: true,
    version: 100,
    lastHeartbeat: 42n
  }
};
const HB_INPUT: ValidatorHeartbeatInput = { publicKey: operator.publicKey, online: true, version: 101 };

function rawEd25519PublicKey(identifier: string): Uint8Array {
  return bs58.decode(identifier.slice(identifier.lastIndexOf('_') + 1));
}

function withValidator(override: Record<string, unknown>): ValidatorRegistrationInput {
  return { ...REG_INPUT, validator: { ...REG_INPUT.validator, ...override } } as ValidatorRegistrationInput;
}

describe('ValidatorRegistration', () => {
  it('maps input fields onto an unsigned ValidatorRegistration', async () => {
    const txn = await buildValidatorRegistrationTXN(REG_INPUT, { ...OPTIONS, memo: 'hello' });

    expect(txn.$typeName).toBe('zera_txn.ValidatorRegistration');
    expect(txn.register).toBe(true);
    expect(txn.generatedPublicKey?.single).toEqual(getPublicKeyBytes(node.publicKey));
    expect(txn.generatedSignature).toEqual(new Uint8Array(0));

    const v = txn.validator;
    expect(v?.publicKey?.single).toEqual(getPublicKeyBytes(operator.publicKey));
    expect(v?.host).toBe('node1.example.com');
    expect(v?.clientPort).toBe('50052');
    expect(v?.validatorPort).toBe('50051');
    expect(v?.stakedContractIds).toEqual([KALX, 'USDX0001']);
    expect(v?.benchmark).toBe(123456789012n);
    expect(v?.timestamp?.seconds).toBe(BigInt(Math.floor(RECORD_TIME.getTime() / 1000)));
    expect(v?.timestamp?.nanos).toBe(500_000_000);
    expect(v?.lite).toBe(true);
    expect(v?.online).toBe(true);
    expect(v?.version).toBe(100);
    expect(v?.lastHeartbeat).toBe(42n);

    expect(txn.base?.publicKey?.single).toEqual(getPublicKeyBytes(operator.publicKey));
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
        publicKey: operator.publicKey,
        generatedPublicKey: node.publicKey,
        register: false,
        validator: { publicKey: charlie.publicKey, host: '10.0.0.5', clientPort: 1, validatorPort: '65535' }
      },
      OPTIONS
    );
    const v = txn.validator;
    expect(txn.register).toBe(false);
    expect(v?.publicKey?.single).toEqual(getPublicKeyBytes(charlie.publicKey));
    expect(v?.clientPort).toBe('1');
    expect(v?.validatorPort).toBe('65535');
    expect(v?.stakedContractIds).toEqual([]);
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
    [withValidator({ stakedContractIds: [KALX, KALX] }), /duplicate contract ID/],
    [withValidator({ stakedContractIds: ['bad id'] }), /stakedContractIds\[0\] must be a Kalvora mint ID/],
    [withValidator({ stakedContractIds: 'KALX' }), /must be an array/],
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

  it('signs with the operator key and co-signs base.hash with the generated key', async () => {
    const txn = await createValidatorRegistrationTXN(
      { ...REG_INPUT, generatedPublicKey: undefined },
      operator.privateKey,
      { publicKey: node.publicKey, privateKey: node.privateKey },
      OPTIONS
    );
    const base = txn.base;
    expect(base?.signature?.length).toBe(64);
    expect(base?.hash?.length).toBe(32);
    expect(txn.generatedPublicKey?.single).toEqual(getPublicKeyBytes(node.publicKey));
    expect(txn.generatedSignature.length).toBe(64);

    // generated_signature is an Ed25519 signature over base.hash by the generated key
    expect(ed25519.verify(txn.generatedSignature, base!.hash!, rawEd25519PublicKey(node.publicKey))).toBe(true);
    expect(ed25519.verify(txn.generatedSignature, base!.hash!, rawEd25519PublicKey(operator.publicKey))).toBe(false);

    // Operator signature covers the txn with signature/hash/generated_signature cleared
    const unsigned = fromBinary(ValidatorRegistrationSchema, toBinary(ValidatorRegistrationSchema, txn));
    unsigned.generatedSignature = new Uint8Array(0);
    unsigned.base = create(BaseTXNSchema, { ...unsigned.base, signature: undefined, hash: undefined });
    const unsignedBytes = toBinary(ValidatorRegistrationSchema, unsigned);
    expect(ed25519.verify(base!.signature!, unsignedBytes, rawEd25519PublicKey(operator.publicKey))).toBe(true);

    // base.hash = SHA3-256(txn with operator signature, before generated_signature)
    unsigned.base.signature = base!.signature!;
    expect(base!.hash).toEqual(sha3_256(toBinary(ValidatorRegistrationSchema, unsigned)));
  });

  it('matches the manual build → signWithKey → attachGeneratedSignature pipeline', async () => {
    const auto = await createValidatorRegistrationTXN(REG_INPUT, operator.privateKey, node, OPTIONS);
    const manual = await buildValidatorRegistrationTXN(REG_INPUT, OPTIONS);
    signWithKey(manual, operator.privateKey, operator.publicKey);
    attachGeneratedSignature(manual, node.privateKey, node.publicKey);
    expect(toBinary(ValidatorRegistrationSchema, manual)).toEqual(toBinary(ValidatorRegistrationSchema, auto));
  });

  it('supports an Ed448 generated key and rejects a mismatched generatedPublicKey', async () => {
    const ed448Node = ED448_TEST_KEYS.alice;
    const txn = await createValidatorRegistrationTXN(REG_INPUT, operator.privateKey, ed448Node, {
      ...OPTIONS
    }).catch(error => error as Error);
    // REG_INPUT.generatedPublicKey is the Ed25519 node key, so it must be rejected
    expect(txn).toBeInstanceOf(Error);
    expect((txn as Error).message).toMatch(/does not match generatedKeyPair\.publicKey/);

    const ok = await createValidatorRegistrationTXN(
      { ...REG_INPUT, generatedPublicKey: undefined },
      operator.privateKey,
      ed448Node,
      OPTIONS
    );
    expect(ok.generatedSignature.length).toBe(114);
  });

  it('round-trips through binary and is deterministic', async () => {
    const a = await createValidatorRegistrationTXN(REG_INPUT, operator.privateKey, node, OPTIONS);
    const b = await createValidatorRegistrationTXN(REG_INPUT, operator.privateKey, node, OPTIONS);
    const bytes = toBinary(ValidatorRegistrationSchema, a);
    expect(fromBinary(ValidatorRegistrationSchema, bytes)).toEqual(a);
    expect(toBinary(ValidatorRegistrationSchema, b)).toEqual(bytes);
  });

  it('createValidatorRegistrationTXN requires keys', async () => {
    await expect(createValidatorRegistrationTXN(REG_INPUT, '', node, OPTIONS)).rejects.toThrow(/operatorPrivateKey is required/);
    await expect(createValidatorRegistrationTXN(REG_INPUT, operator.privateKey, undefined as never, OPTIONS))
      .rejects.toThrow(/generatedKeyPair is required/);
    await expect(createValidatorRegistrationTXN(REG_INPUT, operator.privateKey, { ...node, privateKey: '' }, OPTIONS))
      .rejects.toThrow(/generatedKeyPair\.privateKey is required/);
  });

  it('attachGeneratedSignature requires an operator-signed txn and a matching key', async () => {
    const txn = await buildValidatorRegistrationTXN(REG_INPUT, OPTIONS);
    expect(() => attachGeneratedSignature(txn, node.privateKey, node.publicKey)).toThrow(/signed by the operator first/);
    signWithKey(txn, operator.privateKey, operator.publicKey);
    expect(() => attachGeneratedSignature(txn, charlie.privateKey, charlie.publicKey)).toThrow(/does not match/);
    expect(() => attachGeneratedSignature(txn, '', node.publicKey)).toThrow(/generatedPrivateKey is required/);
    attachGeneratedSignature(txn, node.privateKey, node.publicKey);
    expect(txn.generatedSignature.length).toBe(64);
  });

  it('sendValidatorRegistrationTXN rejects unsigned or partially signed txns', async () => {
    const txn = await buildValidatorRegistrationTXN(REG_INPUT, OPTIONS);
    await expect(sendValidatorRegistrationTXN(txn)).rejects.toThrow(/must be signed/);
    signWithKey(txn, operator.privateKey, operator.publicKey);
    await expect(sendValidatorRegistrationTXN(txn)).rejects.toThrow(/missing generated_signature/);
  });

  it('sendValidatorRegistrationTXN routes to ValidatorService.ValidatorRegistration', async () => {
    const signed = await createValidatorRegistrationTXN(REG_INPUT, operator.privateKey, node, OPTIONS);
    const received: ValidatorRegistration[] = [];
    const heartbeat = vi.fn(() => ({}));
    const transport = createRouterTransport(({ service }) => {
      service(ValidatorService, {
        validatorRegistration: (req: ValidatorRegistration) => {
          received.push(req);
          return {};
        },
        validatorHeartbeat: heartbeat
      });
    });

    const hash = await sendValidatorRegistrationTXN(signed, { transport });
    expect(hash).toBe(bytesToHex(signed.base!.hash!));
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(received).toHaveLength(1);
    expect(toBinary(ValidatorRegistrationSchema, received[0]!)).toEqual(toBinary(ValidatorRegistrationSchema, signed));
    expect(heartbeat).not.toHaveBeenCalled();
  });
});

describe('ValidatorHeartbeat', () => {
  it('maps input fields onto an unsigned ValidatorHeartbeat', async () => {
    const txn = await buildValidatorHeartbeatTXN(HB_INPUT, OPTIONS);
    expect(txn.$typeName).toBe('zera_txn.ValidatorHeartbeat');
    expect(txn.online).toBe(true);
    expect(txn.version).toBe(101);
    expect(txn.base?.nonce).toBe(9n);
    expect(txn.base?.feeAmount).toBe('100');
    expect(txn.base?.publicKey?.single).toEqual(getPublicKeyBytes(operator.publicKey));
    expect(txn.base?.signature).toBeUndefined();
    expect(txn.base?.hash).toBeUndefined();

    const offline = await buildValidatorHeartbeatTXN({ ...HB_INPUT, online: false, version: 0xFFFF_FFFF }, OPTIONS);
    expect(offline.online).toBe(false);
    expect(offline.version).toBe(0xFFFF_FFFF);
  });

  it.each([
    [{ online: 'true' }, /online must be a boolean/],
    [{ online: undefined }, /online must be a boolean/],
    [{ version: -1 }, /version must be an unsigned 32-bit integer/],
    [{ version: 2 ** 32 }, /version must be an unsigned 32-bit integer/],
    [{ version: '100' }, /version must be an unsigned 32-bit integer/],
    [{ publicKey: '' }, /publicKey identifier is required/]
  ])('rejects invalid input %j', async (override, message) => {
    await expect(buildValidatorHeartbeatTXN({ ...HB_INPUT, ...override } as ValidatorHeartbeatInput, OPTIONS))
      .rejects.toThrow(message);
  });

  it('signs, verifies and round-trips through binary', async () => {
    const txn = await createValidatorHeartbeatTXN(HB_INPUT, operator.privateKey, OPTIONS);
    expect(txn.base?.signature?.length).toBe(64);
    expect(txn.base?.hash?.length).toBe(32);

    const unsigned = fromBinary(ValidatorHeartbeatSchema, toBinary(ValidatorHeartbeatSchema, txn));
    unsigned.base = create(BaseTXNSchema, { ...unsigned.base, signature: undefined, hash: undefined });
    expect(ed25519.verify(
      txn.base!.signature!,
      toBinary(ValidatorHeartbeatSchema, unsigned),
      rawEd25519PublicKey(operator.publicKey)
    )).toBe(true);

    expect(fromBinary(ValidatorHeartbeatSchema, toBinary(ValidatorHeartbeatSchema, txn))).toEqual(txn);
    await expect(createValidatorHeartbeatTXN(HB_INPUT, '', OPTIONS)).rejects.toThrow(/privateKey is required/);
  });

  it('sendValidatorHeartbeatTXN rejects unsigned transactions', async () => {
    const txn = await buildValidatorHeartbeatTXN(HB_INPUT, OPTIONS);
    await expect(sendValidatorHeartbeatTXN(txn)).rejects.toThrow(/must be signed/);
  });

  it('sendValidatorHeartbeatTXN routes to ValidatorService.ValidatorHeartbeat', async () => {
    const signed = await createValidatorHeartbeatTXN(HB_INPUT, operator.privateKey, OPTIONS);
    const received: ValidatorHeartbeat[] = [];
    const registration = vi.fn(() => ({}));
    const transport = createRouterTransport(({ service }) => {
      service(ValidatorService, {
        validatorHeartbeat: (req: ValidatorHeartbeat) => {
          received.push(req);
          return {};
        },
        validatorRegistration: registration
      });
    });

    const hash = await sendValidatorHeartbeatTXN(signed, { transport });
    expect(hash).toBe(bytesToHex(signed.base!.hash!));
    expect(received).toHaveLength(1);
    expect(received[0]?.online).toBe(true);
    expect(received[0]?.version).toBe(101);
    expect(toBinary(ValidatorHeartbeatSchema, received[0]!)).toEqual(toBinary(ValidatorHeartbeatSchema, signed));
    expect(registration).not.toHaveBeenCalled();
  });
});
