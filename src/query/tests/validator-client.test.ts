/**
 * ValidatorQueryClient tests against an in-memory ConnectRPC router.
 * Opts out of the global `@connectrpc/connect` mock from `vitest.setup.ts`.
 */
import { clone, create, toBinary } from '@bufbuild/protobuf';
import { Code, ConnectError, createRouterTransport, type ServiceImpl } from '@connectrpc/connect';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ed448 } from '@noble/curves/ed448.js';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  CheckpointInfoRequestSchema,
  ValidatorService,
  ValidatorSyncRequestSchema,
  type CheckpointInfoRequest,
  type ValidatorSyncRequest
} from '../../../proto/generated/validator_pb.js';
import { KalvoraRpcError } from '../../grpc/errors.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { KeyPairSigner, type KalvoraSigner } from '../../sign/signer.js';
import { ED25519_TEST_KEYS, ED448_TEST_KEYS } from '../../test-utils/index.js';
import { KEY_TYPE, createWallet, generateMnemonicPhrase } from '../../wallet-creation/index.js';
import { ValidatorQueryClient, createValidatorQueryClient } from '../validator-client.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const ALICE = ED25519_TEST_KEYS.alice;
const ALICE448 = ED448_TEST_KEYS.alice;

function client(impl: Partial<ServiceImpl<typeof ValidatorService>>): ValidatorQueryClient {
  const transport = createRouterTransport(({ service }) => {
    service(ValidatorService, impl);
  });
  return createValidatorQueryClient({ transport });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected promise to reject');
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, ch => ch.charCodeAt(0));
}

/** Split `PublicKey.single` (`"<prefix>_" + raw key`) into prefix and raw key bytes. */
function splitKey(single: Uint8Array): { prefix: string; raw: Uint8Array } {
  const underscore = single.lastIndexOf(0x5f, 3); // prefix is "A_" / "B_" / "r_A_"
  return {
    prefix: String.fromCharCode(...single.subarray(0, underscore + 1)),
    raw: single.subarray(underscore + 1)
  };
}

/** Server-side signature verification: sig over toBinary(request with signature cleared). */
function verifySigned(
  schema: typeof CheckpointInfoRequestSchema | typeof ValidatorSyncRequestSchema,
  request: CheckpointInfoRequest | ValidatorSyncRequest
): boolean {
  const unsigned = clone(schema as typeof CheckpointInfoRequestSchema, request as CheckpointInfoRequest);
  unsigned.signature = new Uint8Array(0);
  const message = toBinary(schema as typeof CheckpointInfoRequestSchema, unsigned);
  const { prefix, raw } = splitKey(request.publicKey?.single ?? new Uint8Array(0));
  if (prefix === 'A_') return ed25519.verify(request.signature, message, raw);
  if (prefix === 'B_') return ed448.verify(request.signature, message, raw);
  throw new Error(`unexpected key prefix ${prefix}`);
}

describe('ValidatorQueryClient', () => {
  it('createValidatorQueryClient returns an instance', () => {
    expect(createValidatorQueryClient({ transport: createRouterTransport(() => undefined) })).toBeInstanceOf(ValidatorQueryClient);
  });

  describe('getNonce', () => {
    it('maps the address to bytes and returns the nonce', async () => {
      let request: unknown;
      const query = client({
        nonce: req => {
          request = req;
          return { nonce: 17n };
        }
      });
      expect(await query.getNonce(ALICE.address)).toBe(17n);
      expect(request).toMatchObject({ walletAddress: new Uint8Array(bs58.decode(ALICE.address)) });
    });

    it('surfaces the validator error for unknown wallets', async () => {
      const query = client({ nonce: () => { throw new ConnectError('Wallet address does not exist.', Code.Canceled); } });
      const rpc = (await rejection(query.getNonce(ALICE.address))) as KalvoraRpcError;
      expect(rpc).toBeInstanceOf(KalvoraRpcError);
      expect(rpc.codeName).toBe('CANCELED');
      expect(rpc.method).toBe('Nonce');
      expect(rpc.service).toBe('zera_validator.ValidatorService');
      expect(rpc.detail).toBe('Wallet address does not exist.');
    });

    it('validates the address', async () => {
      await expect(client({}).getNonce('')).rejects.toThrow('address must be a non-empty base58 address');
      await expect(client({}).getNonce('0O0O')).rejects.toThrow('address is not a valid base58 address');
    });
  });

  describe('getBalance', () => {
    it('maps request and parses the balance string', async () => {
      let request: unknown;
      const query = client({
        balance: req => {
          request = req;
          return { balance: '1000000000000000000000' };
        }
      });
      expect(await query.getBalance(ALICE.address, KALVORA_NATIVE_TOKEN)).toBe(10n ** 21n);
      expect(request).toMatchObject({
        walletAddress: new Uint8Array(bs58.decode(ALICE.address)),
        contractId: KALVORA_NATIVE_TOKEN,
        encoded: false
      });
    });

    it('returns 0n for an empty balance', async () => {
      expect(await client({ balance: () => ({}) }).getBalance(ALICE.address, KALVORA_NATIVE_TOKEN)).toBe(0n);
    });

    it('validates inputs and response', async () => {
      const handler = vi.fn(() => ({ balance: 'x' }));
      const query = client({ balance: handler });
      await expect(query.getBalance(ALICE.address, 'bad id')).rejects.toThrow('contractId must be a Kalvora mint ID');
      expect(handler).not.toHaveBeenCalled();
      await expect(query.getBalance(ALICE.address, KALVORA_NATIVE_TOKEN)).rejects.toThrow('balance is not an unsigned integer');
    });
  });

  describe('getCheckpointInfo (signed)', () => {
    const response = {
      version: 'v100002',
      blockHeight: 123_456n,
      blockHash: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      totalSize: 987_654_321n,
      createdAt: { seconds: 1_750_000_000n, nanos: 42_999_999 }
    };

    function capturing() {
      const requests: CheckpointInfoRequest[] = [];
      const query = client({
        getCheckpointInfo: req => {
          requests.push(req);
          return response;
        }
      });
      return { requests, query };
    }

    it('signs toBinary(request with signature unset) with an Ed25519 key', async () => {
      const { requests, query } = capturing();
      const signer = new KeyPairSigner(ALICE.publicKey, ALICE.privateKey);
      const now = new Date(1_700_000_000_123);
      const info = await query.getCheckpointInfo(signer, now);

      const req = requests[0]!;
      expect(req.publicKey?.single).toEqual(new Uint8Array([...ascii('A_'), ...bs58.decode(ALICE.address)]));
      expect(req.timestamp).toMatchObject({ seconds: 1_700_000_000n, nanos: 123_000_000 });
      expect(req.signature).toHaveLength(64);
      expect(verifySigned(CheckpointInfoRequestSchema, req)).toBe(true);

      // Negative controls: tampering with the timestamp or signing the full message fails.
      const tampered = clone(CheckpointInfoRequestSchema, req);
      tampered.timestamp!.nanos += 1_000_000;
      expect(verifySigned(CheckpointInfoRequestSchema, tampered)).toBe(false);
      expect(ed25519.verify(req.signature, toBinary(CheckpointInfoRequestSchema, req), splitKey(req.publicKey!.single).raw)).toBe(false);

      expect(info).toEqual({
        version: 'v100002',
        blockHeight: 123_456n,
        blockHash: 'deadbeef',
        totalSize: 987_654_321n,
        createdAt: new Date(1_750_000_000_042)
      });
    });

    it('signs with an Ed448 key', async () => {
      const { requests, query } = capturing();
      await query.getCheckpointInfo(new KeyPairSigner(ALICE448.publicKey, ALICE448.privateKey), new Date(1_700_000_000_000));
      const req = requests[0]!;
      expect(req.publicKey?.single).toEqual(new Uint8Array([...ascii('B_'), ...bs58.decode(ALICE448.address)]));
      expect(req.signature).toHaveLength(114);
      expect(verifySigned(CheckpointInfoRequestSchema, req)).toBe(true);
    });

    it('signs with a freshly generated HD wallet', async () => {
      const wallet = await createWallet({ keyType: KEY_TYPE.ED25519, mnemonic: generateMnemonicPhrase(12) });
      const { requests, query } = capturing();
      await query.getCheckpointInfo(new KeyPairSigner(wallet.publicKey, wallet.privateKey));
      expect(verifySigned(CheckpointInfoRequestSchema, requests[0]!)).toBe(true);
    });

    it('passes exactly the unsigned bytes to a custom signer', async () => {
      const { requests, query } = capturing();
      const seen: Uint8Array[] = [];
      const signer: KalvoraSigner = {
        publicKey: ALICE.publicKey,
        sign: async data => {
          seen.push(data);
          return new Uint8Array([9, 9, 9]);
        }
      };
      await query.getCheckpointInfo(signer, new Date(0));
      const req = requests[0]!;
      expect(req.signature).toEqual(new Uint8Array([9, 9, 9]));
      const unsigned = clone(CheckpointInfoRequestSchema, req);
      unsigned.signature = new Uint8Array(0);
      expect(seen).toEqual([toBinary(CheckpointInfoRequestSchema, unsigned)]);
    });

    it('uses the current time by default', async () => {
      const { requests, query } = capturing();
      const before = Math.floor(Date.now() / 1000);
      await query.getCheckpointInfo(new KeyPairSigner(ALICE.publicKey, ALICE.privateKey));
      const seconds = Number(requests[0]!.timestamp!.seconds);
      expect(seconds).toBeGreaterThanOrEqual(before);
      expect(seconds).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    });

    it('maps a missing createdAt to undefined', async () => {
      const query = client({ getCheckpointInfo: () => ({ version: 'v1' }) });
      const info = await query.getCheckpointInfo(new KeyPairSigner(ALICE.publicKey, ALICE.privateKey));
      expect(info).toEqual({ version: 'v1', blockHeight: 0n, blockHash: '', totalSize: 0n, createdAt: undefined });
    });

    it('rejects an invalid date before signing', async () => {
      const sign = vi.fn(async () => new Uint8Array());
      await expect(client({}).getCheckpointInfo({ publicKey: ALICE.publicKey, sign }, new Date(Number.NaN)))
        .rejects.toThrow('now must be a valid Date');
      expect(sign).not.toHaveBeenCalled();
    });

    it.each([
      [Code.NotFound, 'NOT_FOUND'],
      [Code.Unauthenticated, 'UNAUTHENTICATED'],
      [Code.InvalidArgument, 'INVALID_ARGUMENT']
    ])('normalises server error %i (%s)', async (code, name) => {
      const query = client({ getCheckpointInfo: () => { throw new ConnectError('nope', code); } });
      const rpc = (await rejection(query.getCheckpointInfo(new KeyPairSigner(ALICE.publicKey, ALICE.privateKey)))) as KalvoraRpcError;
      expect(rpc).toBeInstanceOf(KalvoraRpcError);
      expect(rpc.codeName).toBe(name);
      expect(rpc.method).toBe('GetCheckpointInfo');
    });
  });

  describe('syncValidatorList (signed)', () => {
    it('signs toBinary(request with signature unset) and returns validators', async () => {
      const requests: ValidatorSyncRequest[] = [];
      const query = client({
        syncValidatorList: req => {
          requests.push(req);
          return {
            validators: [
              { host: '10.0.0.1', clientPort: '50053', validatorPort: '50051', online: true, version: 100_002 },
              { host: '10.0.0.2', lite: true }
            ]
          };
        }
      });
      const validators = await query.syncValidatorList(new KeyPairSigner(ALICE.publicKey, ALICE.privateKey));
      const req = requests[0]!;
      expect(req.publicKey?.single).toEqual(new Uint8Array([...ascii('A_'), ...bs58.decode(ALICE.address)]));
      expect(verifySigned(ValidatorSyncRequestSchema, req)).toBe(true);
      expect(validators).toHaveLength(2);
      expect(validators[0]).toMatchObject({ host: '10.0.0.1', clientPort: '50053', validatorPort: '50051', online: true, version: 100_002 });
      expect(validators[1]).toMatchObject({ host: '10.0.0.2', lite: true, online: false });
    });

    it('surfaces UNIMPLEMENTED from gateways', async () => {
      const query = client({});
      const rpc = (await rejection(query.syncValidatorList(new KeyPairSigner(ALICE.publicKey, ALICE.privateKey)))) as KalvoraRpcError;
      expect(rpc.isUnimplemented).toBe(true);
      expect(rpc.method).toBe('SyncValidatorList');
    });

    it('rejects a signer with a malformed public key', async () => {
      await expect(client({}).syncValidatorList({ publicKey: 'nounderscore', sign: async () => new Uint8Array() }))
        .rejects.toThrow('Invalid public key identifier');
    });
  });
});
