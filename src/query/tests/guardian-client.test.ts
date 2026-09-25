/**
 * GuardianQueryClient tests against an in-memory ConnectRPC router.
 * Opts out of the global `@connectrpc/connect` mock from `vitest.setup.ts`.
 */
import { Code, ConnectError, createRouterTransport, type ServiceImpl } from '@connectrpc/connect';
import { describe, expect, it, vi } from 'vitest';

import { GuardianService } from '../../../proto/generated/guardian_pb.js';
import { KalvoraRpcError } from '../../grpc/errors.js';
import { KALVORA_NATIVE_TOKEN } from '../../shared/network/constants.js';
import { GuardianQueryClient, NETWORK_TYPE, createGuardianQueryClient } from '../guardian-client.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

const MINT = 'So11111111111111111111111111111111111111112';

function client(impl: Partial<ServiceImpl<typeof GuardianService>>): GuardianQueryClient {
  const transport = createRouterTransport(({ service }) => {
    service(GuardianService, impl);
  });
  return createGuardianQueryClient({ transport });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected promise to reject');
}

describe('GuardianQueryClient', () => {
  it('re-exports NETWORK_TYPE', () => {
    expect(NETWORK_TYPE.ZERA).toBe(0);
    expect(NETWORK_TYPE.SOLANA).toBe(1);
  });

  describe('getPayload', () => {
    it('maps payloadId and network and returns the payload oneof', async () => {
      let request: unknown;
      const query = client({
        getPayload: req => {
          request = req;
          return {
            payload: {
              case: 'solanaPayload',
              value: {
                payload: { case: 'mintPayload', value: { zeraContractId: KALVORA_NATIVE_TOKEN, amount: 5n, txnHash: 'abc' } },
                signedHash: 'hash',
                signatures: ['s1', 's2'],
                publicKeys: ['k1', 'k2']
              }
            }
          };
        }
      });
      const response = await query.getPayload('5xSig', NETWORK_TYPE.SOLANA);
      expect(request).toMatchObject({ payloadId: '5xSig', networkType: NETWORK_TYPE.SOLANA });
      expect(response.payload.case).toBe('solanaPayload');
      if (response.payload.case !== 'solanaPayload') throw new Error('unreachable');
      expect(response.payload.value.signatures).toEqual(['s1', 's2']);
      expect(response.payload.value.payload).toMatchObject({ case: 'mintPayload', value: { amount: 5n, zeraContractId: KALVORA_NATIVE_TOKEN } });
    });

    it('sends NETWORK_TYPE.ZERA', async () => {
      let network: NETWORK_TYPE | undefined;
      const query = client({
        getPayload: req => {
          network = req.networkType;
          return { payload: { case: 'zeraPayload', value: { signedHash: 'h' } } };
        }
      });
      const response = await query.getPayload('ab'.repeat(32), NETWORK_TYPE.ZERA);
      expect(network).toBe(NETWORK_TYPE.ZERA);
      expect(response.payload.case).toBe('zeraPayload');
    });

    it.each(['', '   ', undefined as unknown as string, 42 as unknown as string])('rejects payloadId %j', async payloadId => {
      const handler = vi.fn(() => ({}));
      await expect(client({ getPayload: handler }).getPayload(payloadId, NETWORK_TYPE.ZERA)).rejects.toThrow('payloadId must be a non-empty string');
      expect(handler).not.toHaveBeenCalled();
    });

    it('normalises NOT_FOUND', async () => {
      const query = client({ getPayload: () => { throw new ConnectError('payload not ready', Code.NotFound); } });
      const rpc = (await rejection(query.getPayload('x', NETWORK_TYPE.ZERA))) as KalvoraRpcError;
      expect(rpc).toBeInstanceOf(KalvoraRpcError);
      expect(rpc.isNotFound).toBe(true);
      expect(rpc.method).toBe('GetPayload');
      expect(rpc.service).toBe('zera_guardian.GuardianService');
    });
  });

  describe('searchPayloads', () => {
    it('maps since to a Timestamp and returns both directions', async () => {
      let request: unknown;
      const query = client({
        searchPayload: req => {
          request = req;
          return { zeraPayloads: [{ signedHash: 'z1' }], solanaPayloads: [{ signedHash: 's1' }, { signedHash: 's2' }] };
        }
      });
      const since = new Date('2026-01-01T00:00:00.500Z');
      const response = await query.searchPayloads(since);
      expect(request).toMatchObject({
        searchStartTime: { seconds: BigInt(Math.floor(since.getTime() / 1000)), nanos: 500_000_000 }
      });
      expect(response.zeraPayloads.map(p => p.signedHash)).toEqual(['z1']);
      expect(response.solanaPayloads.map(p => p.signedHash)).toEqual(['s1', 's2']);
    });

    it('rejects an invalid date', async () => {
      const handler = vi.fn(() => ({}));
      const query = client({ searchPayload: handler });
      await expect(query.searchPayloads(new Date(Number.NaN))).rejects.toThrow('since must be a valid Date');
      await expect(query.searchPayloads('2026-01-01' as unknown as Date)).rejects.toThrow('since must be a valid Date');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('getPriceData', () => {
    it('maps request and response', async () => {
      let request: unknown;
      const query = client({
        getPriceData: req => {
          request = req;
          return {
            hasPrice: true,
            priceData: { mintAddress: MINT, usdPrice: 150_000_000n, liquidity: 10n ** 12n, expiryTime: 1_800_000_000n },
            zeraKey: 'A_guardian'
          };
        }
      });
      const result = await query.getPriceData(MINT, 'sig123');
      expect(request).toMatchObject({ mintAddress: MINT, txnHash: 'sig123' });
      expect(result.hasPrice).toBe(true);
      expect(result.guardianKey).toBe('A_guardian');
      expect(result.priceData).toMatchObject({ mintAddress: MINT, usdPrice: 150_000_000n, liquidity: 10n ** 12n, expiryTime: 1_800_000_000n });
    });

    it('defaults txnHash to "" and handles a missing price', async () => {
      let request: unknown;
      const query = client({
        getPriceData: req => {
          request = req;
          return { hasPrice: false, zeraKey: 'A_g' };
        }
      });
      expect(await query.getPriceData(MINT)).toEqual({ hasPrice: false, priceData: undefined, guardianKey: 'A_g' });
      expect(request).toMatchObject({ mintAddress: MINT, txnHash: '' });
    });

    it('validates mintAddress', async () => {
      const handler = vi.fn(() => ({}));
      await expect(client({ getPriceData: handler }).getPriceData(' ')).rejects.toThrow('mintAddress must be a non-empty string');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('getMintInfo', () => {
    it('returns a contractId → mint Map (unknown IDs omitted)', async () => {
      let request: unknown;
      const query = client({
        getMintInfo: req => {
          request = req;
          return { mintInfos: [{ contractId: KALVORA_NATIVE_TOKEN, mintAddress: MINT }] };
        }
      });
      const map = await query.getMintInfo([KALVORA_NATIVE_TOKEN, 'KALunknown']);
      expect(request).toMatchObject({ contractIds: [KALVORA_NATIVE_TOKEN, 'KALunknown'] });
      expect(map).toEqual(new Map([[KALVORA_NATIVE_TOKEN, MINT]]));
      expect(map.has('KALunknown')).toBe(false);
    });

    it('validates contractIds', async () => {
      const handler = vi.fn(() => ({}));
      const query = client({ getMintInfo: handler });
      await expect(query.getMintInfo([])).rejects.toThrow('contractIds must be a non-empty array');
      await expect(query.getMintInfo(KALVORA_NATIVE_TOKEN as unknown as string[])).rejects.toThrow('contractIds must be a non-empty array');
      expect(handler).not.toHaveBeenCalled();
    });

    it('normalises UNAVAILABLE', async () => {
      const query = client({ getMintInfo: () => { throw new ConnectError('down', Code.Unavailable); } });
      const rpc = (await rejection(query.getMintInfo([KALVORA_NATIVE_TOKEN]))) as KalvoraRpcError;
      expect(rpc.isRetryable).toBe(true);
      expect(rpc.method).toBe('GetMintInfo');
    });
  });
});
