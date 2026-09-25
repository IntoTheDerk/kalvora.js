import { describe, expect, it } from 'vitest';

import { APIService } from '../../../proto/generated/api_pb.js';
import { createClient } from '../client-factory.js';

describe('gRPC endpoint security', () => {
  it('rejects malformed, credential-bearing, and unsupported endpoints', () => {
    expect(() => createClient(APIService, { endpoint: 'https://[not-an-ip' })).toThrow(
      'gRPC endpoint must be a valid absolute or bare-host HTTP(S) URL'
    );
    expect(() => createClient(APIService, { endpoint: 'https://user:secret@example.com' })).toThrow(
      'gRPC endpoint must not contain credentials'
    );
    expect(() => createClient(APIService, { endpoint: 'file:///tmp/socket' })).toThrow(
      'gRPC endpoint protocol must be http or https'
    );
  });

  it('rejects HTTP fallback for public hosts but permits local development hosts', () => {
    expect(() => createClient(APIService, {
      endpoint: 'https://api.example.com',
      fallbackToHttp: true
    })).toThrow('gRPC HTTP fallback is restricted to loopback or private development hosts');

    expect(() => createClient(APIService, {
      endpoint: 'https://127.0.0.1:443',
      fallbackToHttp: true
    })).not.toThrow();
  });
});
