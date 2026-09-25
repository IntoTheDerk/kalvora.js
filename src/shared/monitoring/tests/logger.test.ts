import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger, type LogContext } from '../logger.js';

describe('logger secret redaction', () => {
  beforeEach(() => {
    logger.setLogLevel('debug');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    logger.setLogLevel('info');
  });

  it('recursively redacts common secret keys while preserving useful context', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const context: LogContext = {
      operation: 'submit-transaction',
      status: 'rejected',
      details: {
        mnemonic: 'mnemonic-secret',
        nested: {
          privateKey: 'private-key-secret',
          extended_private_key: 'extended-key-secret',
          seed: 'seed-secret',
          passphrase: 'passphrase-secret',
          headers: {
            Authorization: 'Bearer authorization-secret',
            API_KEY: 'api-key-secret',
            'bearer-token': 'bearer-token-secret'
          },
          publicKey: 'safe-public-key'
        }
      }
    };

    logger.info('transaction rejected', context);

    const logged = String(output.mock.calls[0]?.[0]);
    expect(logged).toContain('submit-transaction');
    expect(logged).toContain('rejected');
    expect(logged).toContain('safe-public-key');
    expect(logged).toContain('[REDACTED]');
    expect(logged).not.toContain('mnemonic-secret');
    expect(logged).not.toContain('private-key-secret');
    expect(logged).not.toContain('extended-key-secret');
    expect(logged).not.toContain('seed-secret');
    expect(logged).not.toContain('passphrase-secret');
    expect(logged).not.toContain('authorization-secret');
    expect(logged).not.toContain('api-key-secret');
    expect(logged).not.toContain('bearer-token-secret');
  });

  it('does not mutate caller-owned context during redaction', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const nested = {
      privateKey: 'caller-owned-secret',
      label: 'unchanged'
    };
    const context: LogContext = {
      operation: 'sign',
      details: nested
    };

    logger.info('signing', context);

    expect(context.details).toBe(nested);
    expect(nested).toEqual({
      privateKey: 'caller-owned-secret',
      label: 'unchanged'
    });
  });

  it('handles cycles and bounds deeply nested or large values', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const context: LogContext = {
      operation: 'bounded-log',
      values: Array.from({ length: 101 }, (_, index) => index)
    };
    context.self = context;

    let current: Record<string, unknown> = context;
    for (let index = 0; index < 12; index += 1) {
      const next: Record<string, unknown> = { index };
      current.next = next;
      current = next;
    }

    expect(() => logger.info('bounded values', context)).not.toThrow();

    const logged = String(output.mock.calls[0]?.[0]);
    expect(logged).toContain('[Circular]');
    expect(logged).toContain('[Truncated]');
    expect(logged).toContain('bounded-log');
  });

  it('redacts structured error details without discarding nonsecret fields', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = Object.assign(new Error('request failed'), {
      details: {
        apiKey: 'error-api-key-secret',
        endpoint: '/v1/transactions'
      }
    });

    logger.error('request failed', { operation: 'request' }, error);

    const logged = String(output.mock.calls[0]?.[0]);
    expect(logged).toContain('/v1/transactions');
    expect(logged).toContain('[REDACTED]');
    expect(logged).not.toContain('error-api-key-secret');
  });
});
