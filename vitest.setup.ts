/**
 * Global vitest setup.
 *
 * Stubs the ConnectRPC client factory and gRPC-Web transport so unit tests of
 * builders never touch the network: `createClient` returns canned responses
 * for the handful of RPCs the fee calculator and nonce lookup use.
 *
 * Tests that exercise real RPC plumbing opt out per file with
 * `vi.unmock('@connectrpc/connect'); vi.unmock('@connectrpc/connect-web');`
 * and supply an in-memory `createRouterTransport` instead (see
 * src/query/tests).
 */
import { vi } from 'vitest';

// Mock @connectrpc/connect and @connectrpc/connect-web
vi.mock('@connectrpc/connect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@connectrpc/connect')>()),
  createClient: vi.fn(() => ({
    // Mock Transaction Service methods
    coin: vi.fn().mockResolvedValue({}),
    governVote: vi.fn().mockResolvedValue({}),
    smartContractExecute: vi.fn().mockResolvedValue({}),
    contract: vi.fn().mockResolvedValue({}),
    contractUpdate: vi.fn().mockResolvedValue({}),
    itemMint: vi.fn().mockResolvedValue({}),
    nFT: vi.fn().mockResolvedValue({}),
    burnSBT: vi.fn().mockResolvedValue({}),
    
    // Mock API Service methods
    nonce: vi.fn().mockResolvedValue({ nonce: '0' }),
    tokenFeeInfo: vi.fn().mockResolvedValue({}),
    getTokenFeeInfo: vi.fn().mockResolvedValue({
      tokens: [
        {
          contractId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
          rate: '1000000000000000000',
          authorized: true,
          denomination: '1000000000',
          contractFees: {
            fee: '1000000',
            burn: '500000',
            validator: '500000'
          },
          allowedFees: '0',
          usedFees: '0'
        }
      ]
    })
  })),
  Client: {}
}));

vi.mock('@connectrpc/connect-web', () => ({
  createGrpcWebTransport: vi.fn(() => ({}))
}));
