/**
 * KalvoraQueryClient tests against an in-memory ConnectRPC router.
 *
 * `vitest.setup.ts` globally mocks `@connectrpc/connect` (stubbing
 * `createClient`) and `@connectrpc/connect-web`; this file opts out so the
 * real client, transport and error normalisation are exercised.
 */
import { create, toBinary } from '@bufbuild/protobuf';
import { Code, ConnectError, createRouterTransport, type ServiceImpl } from '@connectrpc/connect';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  APIService,
  BlockRequest,
  DATABASE_TYPE,
  NonceResponseSchema,
  PROPOSAL_TYPE
} from '../../../proto/generated/api_pb.js';
import { CONTRACT_FEE_TYPE, PublicKeySchema, TRANSACTION_TYPE, TXN_STATUS } from '../../../proto/generated/txn_pb.js';
import { BlockSchema, type Block } from '../../../proto/generated/validator_pb.js';
import { KalvoraRpcError, isKalvoraRpcError } from '../../grpc/errors.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { ED25519_TEST_KEYS, ED448_TEST_KEYS } from '../../test-utils/index.js';
import { KalvoraQueryClient, createQueryClient } from '../api-client.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

const ALICE = ED25519_TEST_KEYS.alice;
const BOB448 = ED448_TEST_KEYS.bob;
const OTHER_TOKEN = 'KALother.token-1';

function client(impl: Partial<ServiceImpl<typeof APIService>>): KalvoraQueryClient {
  const transport = createRouterTransport(({ service }) => {
    service(APIService, impl);
  });
  return createQueryClient({ transport });
}

function notFound(message = 'not found'): ConnectError {
  return new ConnectError(message, Code.NotFound);
}

function hash32(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function hex32(fill: number): string {
  return fill.toString(16).padStart(2, '0').repeat(32);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, ch => ch.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function requestedHeight(req: BlockRequest): bigint {
  if (req.payload.case !== 'blockHeight') throw new ConnectError('expected height', Code.InvalidArgument);
  return req.payload.value;
}

/**
 * Simulated chain with blocks 0..tip (tip = -1 → empty). Records every
 * requested height.
 */
function chain(tip: number, blockFor: (height: bigint) => Block = h => create(BlockSchema, { blockHeader: { blockHeight: h } })) {
  const calls: bigint[] = [];
  const impl: Partial<ServiceImpl<typeof APIService>> = {
    block: req => {
      const height = requestedHeight(req);
      calls.push(height);
      if (height > BigInt(tip)) throw notFound('Block not found');
      return { block: blockFor(height) };
    }
  };
  return { calls, query: client(impl) };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected promise to reject');
}

// ----------------------------------------------------------------------------
// transport wiring & error normalisation
// ----------------------------------------------------------------------------

describe('KalvoraQueryClient transport', () => {
  it('uses the real ConnectRPC client with a caller-supplied transport', async () => {
    const handler = vi.fn(() => ({ nonce: 3n }));
    const query = client({ nonce: handler });
    expect(await query.getNonce(ALICE.address)).toBe(3n);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('normalises ConnectError into KalvoraRpcError with the real code', async () => {
    const query = client({ balance: () => { throw notFound('No balance'); } });
    const error = await rejection(query.getBalance(ALICE.address, KALVORA_NATIVE_TOKEN));
    expect(error).toBeInstanceOf(KalvoraRpcError);
    expect(isKalvoraRpcError(error)).toBe(true);
    const rpc = error as KalvoraRpcError;
    expect(rpc.code).toBe(5);
    expect(rpc.codeName).toBe('NOT_FOUND');
    expect(rpc.method).toBe('Balance');
    expect(rpc.service).toBe('zera_api.APIService');
    expect(rpc.detail).toBe('No balance');
    expect(rpc.isNotFound).toBe(true);
    expect(rpc.isRetryable).toBe(false);
    expect(rpc.message).toBe('gRPC Balance failed: [5] No balance');
    expect((rpc as Error & { cause?: unknown }).cause).toBeInstanceOf(ConnectError);
  });

  it.each([
    [Code.Unavailable, 'UNAVAILABLE', true],
    [Code.Unimplemented, 'UNIMPLEMENTED', false],
    [Code.PermissionDenied, 'PERMISSION_DENIED', false]
  ])('maps code %i → %s', async (code, name, retryable) => {
    const query = client({ getTokenFeeInfo: () => { throw new ConnectError('x', code); } });
    const rpc = (await rejection(query.getTokenFeeInfo([KALVORA_NATIVE_TOKEN]))) as KalvoraRpcError;
    expect(rpc.code).toBe(code);
    expect(rpc.codeName).toBe(name);
    expect(rpc.method).toBe('GetTokenFeeInfo');
    expect(rpc.isRetryable).toBe(retryable);
    expect(rpc.isUnimplemented).toBe(code === Code.Unimplemented);
  });

  it('reports methods the router does not implement as UNIMPLEMENTED', async () => {
    const rpc = (await rejection(client({}).getAuthorizedFeeTokens())) as KalvoraRpcError;
    expect(rpc).toBeInstanceOf(KalvoraRpcError);
    expect(rpc.codeName).toBe('UNIMPLEMENTED');
    expect(rpc.method).toBe('GetAllAuthorizedFees');
  });

  it('normalises errors on the .raw client as well', async () => {
    const query = client({ denomination: () => { throw notFound(); } });
    const rpc = (await rejection(query.raw.denomination({ contractId: 'X' }))) as KalvoraRpcError;
    expect(rpc.method).toBe('Denomination');
    expect(rpc.isNotFound).toBe(true);
  });

  describe('default (gRPC-web) transport with a custom fetch', () => {
    function grpcWebFrame(flag: number, payload: Uint8Array): Uint8Array {
      const header = new Uint8Array(5);
      header[0] = flag;
      new DataView(header.buffer).setUint32(1, payload.length);
      return concat(header, payload);
    }

    it('routes to the /api/<Method> path and decodes the response', async () => {
      const fetchMock = vi.fn(async () => new Response(
        concat(
          grpcWebFrame(0x00, toBinary(NonceResponseSchema, create(NonceResponseSchema, { nonce: 9n }))),
          grpcWebFrame(0x80, ascii('grpc-status: 0\r\n'))
        ),
        { status: 200, headers: { 'content-type': 'application/grpc-web+proto' } }
      ));
      const query = createQueryClient({ endpoint: 'https://node.example/api/', fetch: fetchMock as typeof fetch });
      expect(await query.getNextNonce(ALICE.address)).toBe(10n);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('https://node.example/api/Nonce');
    });

    it('normalises a trailers-only NOT_FOUND into KalvoraRpcError', async () => {
      const fetchMock = vi.fn(async () => new Response(null, {
        status: 200,
        headers: {
          'content-type': 'application/grpc-web+proto',
          'grpc-status': '5',
          'grpc-message': 'Block%20not%20found'
        }
      }));
      const query = createQueryClient({ endpoint: 'https://node.example', fetch: fetchMock as typeof fetch });
      const rpc = (await rejection(query.getBlock({ height: 1 }))) as KalvoraRpcError;
      expect(rpc).toBeInstanceOf(KalvoraRpcError);
      expect(rpc.code).toBe(Code.NotFound);
      expect(rpc.method).toBe('Block');
      expect(rpc.detail).toBe('Block not found');
      expect(await query.hasBlock(1)).toBe(false);
    });
  });
});

// ----------------------------------------------------------------------------
// wallets
// ----------------------------------------------------------------------------

describe('wallet queries', () => {
  const addressBytes = new Uint8Array(bs58.decode(ALICE.address));

  it('getNonce / getNextNonce map the address to bytes', async () => {
    const seen: unknown[] = [];
    const query = client({
      nonce: req => {
        seen.push(req);
        return { nonce: 41n };
      }
    });
    expect(await query.getNonce(ALICE.address)).toBe(41n);
    expect(await query.getNextNonce(` ${ALICE.address} `)).toBe(42n);
    expect(seen).toHaveLength(2);
    for (const req of seen) {
      expect(req).toMatchObject({ walletAddress: addressBytes, encoded: false });
    }
  });

  it('getNonce returns 0n for the proto default', async () => {
    expect(await client({ nonce: () => ({}) }).getNonce(ALICE.address)).toBe(0n);
  });

  it.each([
    ['', 'address must be a non-empty base58 address'],
    ['   ', 'address must be a non-empty base58 address'],
    ['0OIl', 'address is not a valid base58 address'],
    [123 as unknown as string, 'address must be a non-empty base58 address']
  ])('rejects invalid address %j without calling the node', async (address, message) => {
    const handler = vi.fn(() => ({}));
    const query = client({ nonce: handler, balance: handler, items: handler, totalBalance: handler });
    await expect(query.getNonce(address)).rejects.toThrow(message);
    await expect(query.getBalance(address, KALVORA_NATIVE_TOKEN)).rejects.toThrow(message);
    await expect(query.getItems(address)).rejects.toThrow(message);
    await expect(query.getAllBalances(address)).rejects.toThrow(message);
    expect(handler).not.toHaveBeenCalled();
  });

  it('getBalance maps request and string amounts', async () => {
    let request: unknown;
    const query = client({
      balance: req => {
        request = req;
        return { balance: '123456789012345678901234567890', denomination: '1000000000', rate: '' };
      }
    });
    expect(await query.getBalance(ALICE.address, KALVORA_NATIVE_TOKEN)).toEqual({
      balance: 123456789012345678901234567890n,
      denomination: 1_000_000_000n,
      rate: 0n
    });
    expect(request).toMatchObject({ walletAddress: addressBytes, contractId: KALVORA_NATIVE_TOKEN, encoded: false });
  });

  it.each(['', ' KAL', 'has space', '#bad', 'x'.repeat(513)])('getBalance rejects contractId %j', async contractId => {
    const handler = vi.fn(() => ({}));
    await expect(client({ balance: handler }).getBalance(ALICE.address, contractId)).rejects.toThrow('contractId must be a Kalvora mint ID');
    expect(handler).not.toHaveBeenCalled();
  });

  it('getBalance accepts bridged mint IDs', async () => {
    const query = client({ balance: req => ({ balance: req.contractId === '$sol-USDC+0000' ? '5' : '0' }) });
    expect((await query.getBalance(ALICE.address, '$sol-USDC+0000')).balance).toBe(5n);
  });

  it('getBalance surfaces malformed amounts', async () => {
    const query = client({ balance: () => ({ balance: '-5' }) });
    await expect(query.getBalance(ALICE.address, KALVORA_NATIVE_TOKEN)).rejects.toThrow('balance is not an unsigned integer');
  });

  describe('getBalanceOrZero', () => {
    it('returns the balance when present', async () => {
      const denomination = vi.fn(() => ({ denomination: '1' }));
      const query = client({ balance: () => ({ balance: '7', denomination: '10', rate: '2' }), denomination });
      expect(await query.getBalanceOrZero(ALICE.address, OTHER_TOKEN)).toEqual({ balance: 7n, denomination: 10n, rate: 2n });
      expect(denomination).not.toHaveBeenCalled();
    });

    it('falls back to 0n with the token denomination on NOT_FOUND', async () => {
      let denomRequest: unknown;
      const query = client({
        balance: () => { throw notFound(); },
        denomination: req => {
          denomRequest = req;
          return { denomination: '1000000000' };
        }
      });
      expect(await query.getBalanceOrZero(ALICE.address, KALVORA_NATIVE_TOKEN)).toEqual({
        balance: 0n,
        denomination: 1_000_000_000n,
        rate: 0n
      });
      expect(denomRequest).toMatchObject({ contractId: KALVORA_NATIVE_TOKEN });
    });

    it('propagates non-NOT_FOUND errors', async () => {
      const denomination = vi.fn(() => ({ denomination: '1' }));
      const query = client({ balance: () => { throw new ConnectError('down', Code.Unavailable); }, denomination });
      const rpc = (await rejection(query.getBalanceOrZero(ALICE.address, KALVORA_NATIVE_TOKEN))) as KalvoraRpcError;
      expect(rpc.codeName).toBe('UNAVAILABLE');
      expect(denomination).not.toHaveBeenCalled();
    });

    it('propagates a NOT_FOUND from the denomination lookup', async () => {
      const query = client({ balance: () => { throw notFound(); }, denomination: () => { throw notFound('no token'); } });
      const rpc = (await rejection(query.getBalanceOrZero(ALICE.address, OTHER_TOKEN))) as KalvoraRpcError;
      expect(rpc.method).toBe('Denomination');
    });

    it('does not swallow validation errors', async () => {
      await expect(client({}).getBalanceOrZero(ALICE.address, '')).rejects.toThrow('contractId must be');
    });
  });

  it('getAllBalances maps each entry', async () => {
    let request: unknown;
    const query = client({
      totalBalance: req => {
        request = req;
        return { balances: [{ balance: '1', denomination: '10', rate: '3' }, { balance: '', denomination: '', rate: '' }] };
      }
    });
    expect(await query.getAllBalances(ALICE.address)).toEqual([
      { balance: 1n, denomination: 10n, rate: 3n },
      { balance: 0n, denomination: 0n, rate: 0n }
    ]);
    expect(request).toMatchObject({ walletAddress: addressBytes, encoded: false });
  });

  it('getItems maps items', async () => {
    const query = client({
      items: () => ({ items: [{ contractId: 'NFT1', itemId: '1' }, { contractId: 'NFT2', itemId: 'abc' }] })
    });
    expect(await query.getItems(ALICE.address)).toEqual([
      { contractId: 'NFT1', itemId: '1' },
      { contractId: 'NFT2', itemId: 'abc' }
    ]);
  });
});

// ----------------------------------------------------------------------------
// contracts & fees
// ----------------------------------------------------------------------------

describe('contract & fee queries', () => {
  it('getContract maps timestamp, key and signature', async () => {
    let request: unknown;
    const query = client({
      contract: req => {
        request = req;
        return {
          contract: { symbol: 'KALV', name: 'Kalvora', maxSupply: '500000000000000000' },
          timestamp: { seconds: 1_700_000_000n, nanos: 5_999_999 },
          publicKey: { single: ascii('A_validator') },
          signature: new Uint8Array([1, 2, 3])
        };
      }
    });
    const info = await query.getContract(KALVORA_NATIVE_TOKEN);
    expect(request).toMatchObject({ contractId: KALVORA_NATIVE_TOKEN });
    expect(info.contract.symbol).toBe('KALV');
    expect(info.contract.maxSupply).toBe('500000000000000000');
    expect(info.timestamp).toEqual(new Date(1_700_000_000_005));
    expect(info.validatorPublicKey?.single).toEqual(ascii('A_validator'));
    expect(info.signature).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('getContract without timestamp/key', async () => {
    const info = await client({ contract: () => ({ contract: { symbol: 'X' } }) }).getContract('X');
    expect(info.timestamp).toBeUndefined();
    expect(info.validatorPublicKey).toBeUndefined();
    expect(info.signature).toEqual(new Uint8Array(0));
  });

  it('getContract throws on an empty definition', async () => {
    await expect(client({ contract: () => ({}) }).getContract('X')).rejects.toThrow('Contract X returned an empty definition');
  });

  it('getContract validates the contract ID', async () => {
    await expect(client({}).getContract('bad id')).rejects.toThrow('contractId must be a Kalvora mint ID');
  });

  it('getDenomination', async () => {
    const query = client({ denomination: () => ({ denomination: '1000000000' }) });
    expect(await query.getDenomination(KALVORA_NATIVE_TOKEN)).toBe(1_000_000_000n);
    await expect(query.getDenomination('')).rejects.toThrow('contractId must be');
  });

  it('getContractFee maps type, instruments and fee', async () => {
    let request: unknown;
    const query = client({
      contractFee: req => {
        request = req;
        return {
          contractFeeType: CONTRACT_FEE_TYPE.PERCENTAGE,
          allowedFeeInstrument: [KALVORA_NATIVE_TOKEN, OTHER_TOKEN],
          fee: '5000000000000000'
        };
      }
    });
    expect(await query.getContractFee(OTHER_TOKEN)).toEqual({
      type: CONTRACT_FEE_TYPE.PERCENTAGE,
      allowedFeeInstruments: [KALVORA_NATIVE_TOKEN, OTHER_TOKEN],
      fee: 5_000_000_000_000_000n
    });
    expect(request).toMatchObject({ contractId: OTHER_TOKEN });
  });

  describe('getBaseFee', () => {
    const response = { keyFee: '20000000000000000', byteFee: '100000000000000', newWalletFee: '' };

    it('maps an Ed25519 identifier to PublicKey.single = "A_" + raw key', async () => {
      let request: unknown;
      const query = client({
        baseFee: req => {
          request = req;
          return response;
        }
      });
      expect(await query.getBaseFee(TRANSACTION_TYPE.COIN_TYPE, ALICE.publicKey)).toEqual({
        keyFee: 20_000_000_000_000_000n,
        byteFee: 100_000_000_000_000n,
        newWalletFee: 0n
      });
      expect(request).toMatchObject({
        txnType: TRANSACTION_TYPE.COIN_TYPE,
        publicKey: { single: concat(ascii('A_'), bs58.decode(ALICE.address)) }
      });
    });

    it('maps an Ed448 identifier', async () => {
      let request: unknown;
      const query = client({
        baseFee: req => {
          request = req;
          return response;
        }
      });
      await query.getBaseFee(TRANSACTION_TYPE.SMART_CONTRACT_EXECUTE_TYPE, BOB448.publicKey);
      expect(request).toMatchObject({
        txnType: TRANSACTION_TYPE.SMART_CONTRACT_EXECUTE_TYPE,
        publicKey: { single: concat(ascii('B_'), bs58.decode(BOB448.address)) }
      });
    });

    it('passes a PublicKey message through unchanged', async () => {
      let request: unknown;
      const query = client({
        baseFee: req => {
          request = req;
          return response;
        }
      });
      const governanceAuth = ascii('gov_KALX');
      await query.getBaseFee(TRANSACTION_TYPE.MINT_TYPE, create(PublicKeySchema, { governanceAuth }));
      expect(request).toMatchObject({ txnType: TRANSACTION_TYPE.MINT_TYPE, publicKey: { governanceAuth } });
    });

    it('rejects a malformed identifier', async () => {
      await expect(client({}).getBaseFee(TRANSACTION_TYPE.COIN_TYPE, 'nounderscore')).rejects.toThrow('Invalid public key identifier');
    });
  });

  describe('getTokenFeeInfo', () => {
    it('maps tokens (with and without contract fees)', async () => {
      let request: unknown;
      const query = client({
        getTokenFeeInfo: req => {
          request = req;
          return {
            tokens: [
              {
                contractId: KALVORA_NATIVE_TOKEN,
                rate: '1000000000000000000',
                authorized: true,
                denomination: '1000000000',
                allowedFees: 'MAX',
                usedFees: ''
              },
              {
                contractId: OTHER_TOKEN,
                rate: '',
                authorized: false,
                denomination: '100',
                contractFees: { fee: '10', burn: '5' },
                allowedFees: '1000',
                usedFees: '999'
              }
            ]
          };
        }
      });
      const tokens = await query.getTokenFeeInfo([KALVORA_NATIVE_TOKEN, OTHER_TOKEN]);
      expect(request).toMatchObject({ contractIds: [KALVORA_NATIVE_TOKEN, OTHER_TOKEN] });
      expect(tokens[0]).toEqual({
        contractId: KALVORA_NATIVE_TOKEN,
        rate: 10n ** 18n,
        authorized: true,
        denomination: 1_000_000_000n,
        allowedFees: 'MAX',
        usedFees: 0n
      });
      expect(tokens[0]).not.toHaveProperty('contractFees');
      expect(tokens[1]).toMatchObject({ rate: 0n, authorized: false, denomination: 100n, allowedFees: '1000', usedFees: 999n });
      expect(tokens[1]?.contractFees).toMatchObject({ fee: '10', burn: '5' });
    });

    it('validates input', async () => {
      const handler = vi.fn(() => ({}));
      const query = client({ getTokenFeeInfo: handler });
      await expect(query.getTokenFeeInfo([])).rejects.toThrow('contractIds must be a non-empty array');
      await expect(query.getTokenFeeInfo('KAL' as unknown as string[])).rejects.toThrow('contractIds must be a non-empty array');
      await expect(query.getTokenFeeInfo([KALVORA_NATIVE_TOKEN, 'bad id'])).rejects.toThrow('contractIds[1] must be a Kalvora mint ID');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  it('getAuthorizedFeeTokens', async () => {
    const query = client({
      getAllAuthorizedFees: () => ({
        authorizedFees: [
          { contractId: KALVORA_NATIVE_TOKEN, allowedFees: 'MAX', usedFees: '' },
          { contractId: OTHER_TOKEN, allowedFees: '100', usedFees: '42' }
        ]
      })
    });
    expect(await query.getAuthorizedFeeTokens()).toEqual([
      { contractId: KALVORA_NATIVE_TOKEN, allowedFees: 'MAX', usedFees: 0n },
      { contractId: OTHER_TOKEN, allowedFees: '100', usedFees: 42n }
    ]);
  });

  it('getCurrencyEquivalent reads the CURRENCY_EQUIVALENTS record', async () => {
    let request: unknown;
    const query = client({
      database: req => {
        request = req;
        return { value: '1250000000000000000' };
      }
    });
    expect(await query.getCurrencyEquivalent(KALVORA_NATIVE_TOKEN)).toBe(1_250_000_000_000_000_000n);
    expect(request).toMatchObject({ type: DATABASE_TYPE.CURRENCY_EQUIVALENTS, key: KALVORA_NATIVE_TOKEN });
  });

  it('getCurrencyEquivalent validates input and value', async () => {
    const handler = vi.fn(() => ({ value: 'n/a' }));
    const query = client({ database: handler });
    await expect(query.getCurrencyEquivalent('')).rejects.toThrow('contractId must be');
    expect(handler).not.toHaveBeenCalled();
    await expect(query.getCurrencyEquivalent(KALVORA_NATIVE_TOKEN)).rejects.toThrow('currencyEquivalent is not an unsigned integer');
  });

  it('getContractSupply decodes the binary CONTRACT_SUPPLY record', async () => {
    // field 1 = "500000000000000000", field 2 = "220000000000000"; binary → latin-1 string
    const max = ascii('500000000000000000');
    const current = ascii('220000000000000');
    const record = concat(new Uint8Array([0x0a, max.length]), max, new Uint8Array([0x12, current.length]), current);
    const value = String.fromCharCode(...record);
    let request: unknown;
    const query = client({
      database: req => {
        request = req;
        return { value };
      }
    });
    expect(await query.getContractSupply(KALVORA_NATIVE_TOKEN)).toEqual({
      maxSupply: 500_000_000_000_000_000n,
      currentSupply: 220_000_000_000_000n
    });
    expect(request).toMatchObject({ type: DATABASE_TYPE.CONTRACT_SUPPLY, key: KALVORA_NATIVE_TOKEN });
  });

  it('getContractSupply survives latin-1 bytes >= 0x80 over the wire', async () => {
    const digits = ascii('1'.repeat(150)); // length 150 → varint 0x96 0x01
    const record = concat(new Uint8Array([0x0a, 0x96, 0x01]), digits);
    const query = client({ database: () => ({ value: String.fromCharCode(...record) }) });
    expect((await query.getContractSupply(OTHER_TOKEN)).maxSupply).toBe(BigInt('1'.repeat(150)));
  });

  it('getDatabaseValue passes type and key through', async () => {
    let request: unknown;
    const query = client({
      database: req => {
        request = req;
        return { value: 'raw' };
      }
    });
    expect(await query.getDatabaseValue(DATABASE_TYPE.VALIDATORS, 'some-key')).toBe('raw');
    expect(request).toMatchObject({ type: DATABASE_TYPE.VALIDATORS, key: 'some-key' });
  });
});

// ----------------------------------------------------------------------------
// blocks
// ----------------------------------------------------------------------------

describe('block queries', () => {
  function capture() {
    const requests: BlockRequest[] = [];
    const query = client({
      block: req => {
        requests.push(req);
        return { block: { blockHeader: { blockHeight: 1n } } };
      }
    });
    return { requests, query };
  }

  it.each([
    [5n, 5n],
    [5, 5n],
    ['5', 5n],
    [' 7 ', 7n],
    [0, 0n],
    ['18446744073709551615', 18446744073709551615n]
  ])('getBlock({ height: %s }) sends blockHeight %s', async (height, expected) => {
    const { requests, query } = capture();
    await query.getBlock({ height });
    expect(requests[0]?.payload).toEqual({ case: 'blockHeight', value: expected });
    expect(requests[0]?.encoded).toBe(false);
  });

  it.each([
    ['ABCDEF', 'abcdef'],
    ['0xABCDEF', 'abcdef'],
    ['0XAbCdEf', 'abcdef'],
    [hex32(0x1f), hex32(0x1f)]
  ])('getBlock({ hash: %j }) sends blockHash %j', async (hash, expected) => {
    const { requests, query } = capture();
    await query.getBlock({ hash });
    expect(requests[0]?.payload).toEqual({ case: 'blockHash', value: expected });
  });

  it.each([-1, 1.5, '-1', 'abc', '18446744073709551616', Number.MAX_SAFE_INTEGER + 1])('getBlock rejects height %j', async height => {
    const { requests, query } = capture();
    await expect(query.getBlock({ height })).rejects.toThrow('height must be an unsigned 64-bit integer');
    expect(requests).toHaveLength(0);
  });

  it('getBlock returns the decoded block', async () => {
    const query = client({
      block: () => ({ block: { blockHeader: { blockHeight: 12n, hash: hash32(9) }, transactions: { coinTxns: [{}] } } })
    });
    const block = await query.getBlock({ height: 12 });
    expect(block.blockHeader?.blockHeight).toBe(12n);
    expect(block.blockHeader?.hash).toEqual(hash32(9));
    expect(block.transactions?.coinTxns).toHaveLength(1);
  });

  it('getBlock throws when the response has no block', async () => {
    await expect(client({ block: () => ({}) }).getBlock({ height: 1 })).rejects.toThrow('Block response did not contain a block');
  });

  it('getBlock surfaces NOT_FOUND as KalvoraRpcError', async () => {
    const rpc = (await rejection(chain(3).query.getBlock({ height: 4 }))) as KalvoraRpcError;
    expect(rpc.isNotFound).toBe(true);
    expect(rpc.method).toBe('Block');
  });

  it('hasBlock', async () => {
    const { query } = chain(3);
    expect(await query.hasBlock(0)).toBe(true);
    expect(await query.hasBlock(3n)).toBe(true);
    expect(await query.hasBlock('4')).toBe(false);
    const failing = client({ block: () => { throw new ConnectError('boom', Code.Internal); } });
    expect(((await rejection(failing.hasBlock(1))) as KalvoraRpcError).codeName).toBe('INTERNAL');
  });

  describe('getLatestBlockHeight', () => {
    const log2 = (n: number): number => Math.ceil(Math.log2(n + 2));

    it.each([0, 1, 2, 18, 1000, 65_537])('finds tip %i without a hint in O(log n) requests', async tip => {
      const { calls, query } = chain(tip);
      expect(await query.getLatestBlockHeight()).toBe(BigInt(tip));
      expect(calls.length).toBeLessThanOrEqual(2 * log2(tip) + 3);
    });

    it('uses an existing hint as the lower bound', async () => {
      const { calls, query } = chain(1000);
      expect(await query.getLatestBlockHeight(990)).toBe(1000n);
      expect(calls[0]).toBe(990n);
      expect(calls.every(h => h >= 990n)).toBe(true);
      expect(calls.length).toBeLessThanOrEqual(10);
    });

    it.each([1000n, '1000', 1000])('accepts the hint at the tip (%s)', async hint => {
      const { calls, query } = chain(1000);
      expect(await query.getLatestBlockHeight(hint)).toBe(1000n);
      expect(calls).toEqual([1000n, 1001n]);
    });

    it('falls back to a full search when the hint is beyond the tip', async () => {
      const { calls, query } = chain(18);
      expect(await query.getLatestBlockHeight(5000n)).toBe(18n);
      expect(calls[0]).toBe(5000n);
      expect(calls.length).toBeLessThanOrEqual(2 * log2(18) + 4);
    });

    it('throws on an empty chain', async () => {
      await expect(chain(-1).query.getLatestBlockHeight()).rejects.toThrow('Chain has no blocks');
    });

    it('throws on an empty chain even when a hint is given', async () => {
      await expect(chain(-1).query.getLatestBlockHeight(5)).rejects.toThrow('Chain has no blocks');
    });

    it('rejects an invalid hint', async () => {
      await expect(chain(3).query.getLatestBlockHeight(-1)).rejects.toThrow('hint must be an unsigned 64-bit integer');
    });

    it('propagates non-NOT_FOUND errors', async () => {
      const query = client({ block: () => { throw new ConnectError('down', Code.Unavailable); } });
      expect(((await rejection(query.getLatestBlockHeight())) as KalvoraRpcError).codeName).toBe('UNAVAILABLE');
    });
  });

  describe('transactions', () => {
    const TX = hex32(0x77);

    function blockWithResult(height: bigint, fill?: number, status = TXN_STATUS.OK): Block {
      return create(BlockSchema, {
        blockHeader: { blockHeight: height },
        transactions: fill === undefined
          ? {}
          : { txnFeesAndStatus: [{ txnHash: hash32(fill), status, baseFees: '100', baseContractId: KALVORA_NATIVE_TOKEN }] }
      });
    }

    it('getTransactionResult finds or misses the hash in a block', async () => {
      const { calls, query } = chain(10, h => blockWithResult(h, 0x77));
      expect(await query.getTransactionResult(`0x${TX.toUpperCase()}`, 4)).toMatchObject({ hash: TX, success: true, baseFees: 100n });
      expect(calls).toEqual([4n]);
      expect(await query.getTransactionResult(hex32(0x78), 4)).toBeUndefined();
    });

    it('waitForTransaction finds a transaction in an already-produced later block', async () => {
      const { calls, query } = chain(20, h => blockWithResult(h, h === 13n ? 0x77 : 0x01));
      const result = await query.waitForTransaction(TX, { fromHeight: 10, pollIntervalMs: 1, timeoutMs: 1000 });
      expect(result).toMatchObject({ hash: TX, blockHeight: 13n, success: true, statusName: 'OK' });
      expect(calls).toEqual([10n, 11n, 12n, 13n]);
    });

    it('waitForTransaction polls until the block containing the transaction is produced', async () => {
      let tip = 10n;
      const calls: bigint[] = [];
      const query = client({
        block: req => {
          const height = requestedHeight(req);
          calls.push(height);
          if (height > tip) {
            tip += 1n; // one new block per poll
            throw notFound();
          }
          return { block: blockWithResult(height, height === 13n ? 0x77 : undefined, TXN_STATUS.INSUFFICIENT_AMOUNT) };
        }
      });
      const result = await query.waitForTransaction(TX, { fromHeight: '11', pollIntervalMs: 2, timeoutMs: 5000 });
      expect(result).toMatchObject({ blockHeight: 13n, success: false, statusName: 'INSUFFICIENT_AMOUNT' });
      expect(calls).toEqual([11n, 11n, 12n, 12n, 13n, 13n]);
    });

    it('waitForTransaction times out', async () => {
      const { query } = chain(5, h => blockWithResult(h));
      const started = Date.now();
      await expect(query.waitForTransaction(TX, { fromHeight: 3, pollIntervalMs: 5, timeoutMs: 40 }))
        .rejects.toThrow(`Timed out after 40 ms waiting for transaction ${TX} (searched up to height 5)`);
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it('waitForTransaction times out immediately when the interval exceeds the timeout', async () => {
      const { calls, query } = chain(-1);
      await expect(query.waitForTransaction(TX, { fromHeight: 1, pollIntervalMs: 60_000, timeoutMs: 1000 }))
        .rejects.toThrow('Timed out after 1000 ms');
      expect(calls).toEqual([1n]);
    });

    it('waitForTransaction times out with fake timers (default intervals)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        const { calls, query } = chain(0);
        const pending = query.waitForTransaction(TX, { fromHeight: 1 });
        const outcome = pending.then(() => 'resolved', (error: Error) => error.message);
        await vi.advanceTimersByTimeAsync(130_000);
        expect(await outcome).toMatch(/^Timed out after 120000 ms/u);
        // default poll interval 2 000 ms → ~60 polls within 120 s
        expect(calls.length).toBeGreaterThanOrEqual(55);
        expect(calls.length).toBeLessThanOrEqual(61);
      } finally {
        vi.useRealTimers();
      }
    });

    it('waitForTransaction honours an already-aborted signal', async () => {
      const { calls, query } = chain(5);
      const controller = new AbortController();
      controller.abort();
      await expect(query.waitForTransaction(TX, { fromHeight: 0, signal: controller.signal })).rejects.toThrow('Aborted');
      expect(calls).toHaveLength(0);
    });

    it('waitForTransaction aborts while sleeping between polls', async () => {
      const { query } = chain(0);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 20);
      const started = Date.now();
      await expect(query.waitForTransaction(TX, { fromHeight: 1, pollIntervalMs: 60_000, timeoutMs: 600_000, signal: controller.signal }))
        .rejects.toThrow('Aborted');
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it('waitForTransaction aborts while scanning existing blocks', async () => {
      const controller = new AbortController();
      const query = client({
        block: req => {
          if (requestedHeight(req) === 2n) controller.abort();
          return { block: blockWithResult(requestedHeight(req)) };
        }
      });
      await expect(query.waitForTransaction(TX, { fromHeight: 0, signal: controller.signal })).rejects.toThrow('Aborted');
    });

    it('waitForTransaction propagates non-NOT_FOUND errors', async () => {
      const query = client({ block: () => { throw new ConnectError('denied', Code.PermissionDenied); } });
      const rpc = (await rejection(query.waitForTransaction(TX, { fromHeight: 0, pollIntervalMs: 1 }))) as KalvoraRpcError;
      expect(rpc).toBeInstanceOf(KalvoraRpcError);
      expect(rpc.codeName).toBe('PERMISSION_DENIED');
    });

    it('waitForTransaction validates fromHeight', async () => {
      await expect(chain(1).query.waitForTransaction(TX, { fromHeight: -1 })).rejects.toThrow('fromHeight must be an unsigned 64-bit integer');
    });
  });
});

// ----------------------------------------------------------------------------
// governance & smart contracts
// ----------------------------------------------------------------------------

describe('getProposalLedger', () => {
  it('zips key/value arrays into Maps', async () => {
    let request: unknown;
    const query = client({
      proposalLedger: req => {
        request = req;
        return {
          ledgerKeys: ['L1'],
          ledgerValues: ['ledger-1'],
          proposalKeys: ['P1', 'P2'],
          proposalValues: ['prop-1'], // shorter than keys → '' for P2
          walletsKeys: ['W1'],
          walletsValues: ['w'],
          votedKeys: [],
          votedValues: []
        };
      }
    });
    const view = await query.getProposalLedger(PROPOSAL_TYPE.PROPOSAL_BY_ID, 'P1');
    expect(request).toMatchObject({ type: PROPOSAL_TYPE.PROPOSAL_BY_ID, key: 'P1' });
    expect(view.ledgers).toEqual(new Map([['L1', 'ledger-1']]));
    expect(view.proposals).toEqual(new Map([['P1', 'prop-1'], ['P2', '']]));
    expect(view.wallets).toEqual(new Map([['W1', 'w']]));
    expect(view.temp.size).toBe(0);
    expect(view.voted.size).toBe(0);
    expect(view.raw.proposalKeys).toEqual(['P1', 'P2']);
  });

  it('defaults to ALL_PROPOSALS with an empty key', async () => {
    let request: unknown;
    const query = client({
      proposalLedger: req => {
        request = req;
        return {};
      }
    });
    await query.getProposalLedger();
    expect(request).toMatchObject({ type: PROPOSAL_TYPE.ALL_PROPOSALS, key: '' });
  });

  it('sends LEDGER_BY_ID as its numeric wire value', async () => {
    let type: number | undefined;
    const query = client({
      proposalLedger: req => {
        type = req.type;
        return {};
      }
    });
    await query.getProposalLedger(PROPOSAL_TYPE.LEDGER_BY_ID, 'L1');
    expect(type).toBe(3);
  });
});

describe('searchSmartContractEvents', () => {
  it('maps the request (with since) and events', async () => {
    let request: unknown;
    const query = client({
      smartContractEventsSearch: req => {
        request = req;
        return {
          events: [{
            smartContract: 'dex',
            instance: 2n,
            function: 'swap',
            eventData: ['a', 'b'],
            blockHeight: 99n,
            blockHash: 'bh',
            txnHash: 'th',
            timestamp: { seconds: 1_700_000_000n, nanos: 250_000_000 },
            gasUsed: 10n,
            gasApproved: 20n
          }]
        };
      }
    });
    const since = new Date('2025-01-02T03:04:05.678Z');
    const events = await query.searchSmartContractEvents('dex', since);
    expect(request).toMatchObject({
      smartContractId: 'dex',
      searchStart: { seconds: BigInt(Math.floor(since.getTime() / 1000)), nanos: 678_000_000 }
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      smartContract: 'dex',
      instance: 2n,
      function: 'swap',
      eventData: ['a', 'b'],
      blockHeight: 99n,
      blockHash: 'bh',
      txnHash: 'th',
      timestamp: new Date(1_700_000_000_250),
      gasUsed: 10n,
      gasApproved: 20n
    });
    expect(events[0]?.raw.$typeName).toBe('zera_api.SmartContractEventsResponse');
  });

  it('omits searchStart when since is not given', async () => {
    let hasStart: boolean | undefined;
    const query = client({
      smartContractEventsSearch: req => {
        hasStart = req.searchStart !== undefined;
        return { events: [{ smartContract: 'x' }] };
      }
    });
    const events = await query.searchSmartContractEvents('x');
    expect(hasStart).toBe(false);
    expect(events[0]?.timestamp).toBeUndefined();
  });

  it('validates input', async () => {
    const handler = vi.fn(() => ({}));
    const query = client({ smartContractEventsSearch: handler });
    await expect(query.searchSmartContractEvents('  ')).rejects.toThrow('smartContractId must be a non-empty string');
    await expect(query.searchSmartContractEvents('x', new Date(Number.NaN))).rejects.toThrow('since must be a valid Date');
    expect(handler).not.toHaveBeenCalled();
  });
});
