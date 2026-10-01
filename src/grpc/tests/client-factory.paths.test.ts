/**
 * On-wire request paths produced by `createClient`.
 *
 * The default transport rewrites the fully qualified `/<package>.<Service>/`
 * prefix to the Envoy route aliases (`/api/`, `/txn/`, `/validator/`,
 * `/guardian/`). The alias table is keyed by the proto package, so it must
 * track the official `kal_*` package names; otherwise requests would silently
 * go out on the unaliased fully qualified path.
 */
import { create } from '@bufbuild/protobuf';
import { vi } from 'vitest';

import { GuardianService, PayloadRequestSchema } from '../../../proto/generated/guardian_pb.js';
import { APIService, NonceRequestSchema } from '../../../proto/generated/kal_api_pb.js';
import { CoinTXNSchema, TXNService } from '../../../proto/generated/txn_pb.js';
import { NonceRequestSchema as ValidatorNonceRequestSchema, ValidatorService } from '../../../proto/generated/validator_pb.js';
import { createClient } from '../client-factory.js';

vi.unmock('@connectrpc/connect');
vi.unmock('@connectrpc/connect-web');

function capturingFetch(): { urls: string[]; fetch: typeof globalThis.fetch } {
  const urls: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    throw new TypeError('offline test transport');
  }) as typeof globalThis.fetch;
  return { urls, fetch };
}

const ENDPOINT = 'https://node.example';

describe('createClient request paths', () => {
  it('uses the official kal_* package names in the generated service descriptors', () => {
    expect(APIService.typeName).toBe('kal_api.APIService');
    expect(TXNService.typeName).toBe('kal_txn.TXNService');
    expect(ValidatorService.typeName).toBe('kal_validator.ValidatorService');
    expect(GuardianService.typeName).toBe('kal_guardian.GuardianService');
  });

  it.each([
    ['APIService.Nonce', `${ENDPOINT}/api/Nonce`],
    ['TXNService.Coin', `${ENDPOINT}/txn/Coin`],
    ['ValidatorService.Nonce', `${ENDPOINT}/validator/Nonce`],
    ['GuardianService.GetPayload', `${ENDPOINT}/guardian/GetPayload`]
  ])('rewrites %s to the Envoy alias %s', async (method, expected) => {
    const { urls, fetch } = capturingFetch();
    const config = { endpoint: ENDPOINT, fetch };
    const call: Record<string, () => Promise<unknown>> = {
      'APIService.Nonce': () => createClient(APIService, config).nonce(create(NonceRequestSchema, {})),
      'TXNService.Coin': () => createClient(TXNService, config).coin(create(CoinTXNSchema, {})),
      'ValidatorService.Nonce': () =>
        createClient(ValidatorService, config).nonce(create(ValidatorNonceRequestSchema, {})),
      'GuardianService.GetPayload': () =>
        createClient(GuardianService, config).getPayload(create(PayloadRequestSchema, {}))
    };
    await expect(call[method]!()).rejects.toThrow();
    expect(urls).toEqual([expected]);
  });
});
