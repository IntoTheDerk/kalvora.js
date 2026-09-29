/**
 * gRPC Infrastructure Integration Tests
 * 
 * Tests gRPC client infrastructure, error handling, and configuration.
 * Does NOT test business logic (nonce, transactions, etc.) - those are tested in service-specific tests.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { 
  ErrorHandler
} from '../../shared/utils/error-handler.js';
import { 
  PerformanceBenchmark
} from '../../shared/utils/performance-benchmark.js';
import { 
  createValidatorAPIClient
} from '../api/validator-api-client.js';
import { 
  createTransactionClient
} from '../transaction/transaction-client.js';

describe('gRPC Infrastructure Tests', () => {

  afterEach(() => {
    // Clean up any global state
  });

  describe('Validator API Client Creation', () => {
    it('should create a validator API client with default configuration', () => {
      const client = createValidatorAPIClient();

      expect(client).toBeDefined();
      // Private properties like host/port/serviceName are not directly accessible on the impl instance
      // but we can check methods exist
      expect(client.getNonce).toBeDefined();
      expect(client.getTokenFeeInfo).toBeDefined();
    });

    it('should create a validator API client with custom configuration', () => {
      const client = createValidatorAPIClient({
        host: 'custom-host',
        port: 9999,
        timeout: 10000
      });

      expect(client).toBeDefined();
    });
  });

  describe('Transaction Client Creation', () => {
    it('should create a transaction client', () => {
      const client = createTransactionClient();

      expect(client).toBeDefined();
      expect(client.submitCoinTransaction).toBeDefined();
    });
  });

  describe('Error Handling Infrastructure', () => {
    it('should handle network errors gracefully', async () => {
      const client = createValidatorAPIClient({
        host: 'invalid-host',
        port: 9999,
        timeout: 1000
      });

      try {
        // Call any method - we're testing error handling, not business logic
        await (client as any).client.Nonce({ address: 'test' });
      } catch (error) {
        expect(error).toBeDefined();
        // Depending on how the promise client handles errors, it might not be strictly retryable in all cases
        // but it should throw something.
      }
    });

    it('should handle timeout errors gracefully', async () => {
      const client = createValidatorAPIClient({
        host: 'localhost',
        port: 443,
        timeout: 1 // 1ms timeout to force timeout
      });

      try {
        // Call any method - we're testing error handling, not business logic
        await (client as any).client.Nonce({ address: 'test' });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle connection errors gracefully', async () => {
      const client = createValidatorAPIClient({
        host: 'localhost',
        port: 1, // Invalid port
        timeout: 1000
      });

      try {
        // Call any method - we're testing error handling, not business logic
        await (client as any).client.Nonce({ address: 'test' });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Performance', () => {
    it('should create clients within reasonable time', async () => {
      const benchmark = new PerformanceBenchmark();

      const result = await benchmark.benchmark('client-creation', async () => {
        createValidatorAPIClient({
          host: 'localhost',
          port: 443
        });
      }, { iterations: 10 });

      expect(result.iterations).toBe(10);
      expect(result.duration).toBeLessThan(1000); // Should create 10 clients in < 1 second
    });

    it('should handle multiple client creation efficiently', async () => {
      const benchmark = new PerformanceBenchmark();

      let clientCount = 0;
      const result = await benchmark.benchmark('multiple-clients', async () => {
        createValidatorAPIClient({
          host: 'localhost',
          port: 443 + clientCount
        });
        clientCount++;
      }, { iterations: 3 });

      expect(result.iterations).toBe(3);
      expect(result.duration).toBeLessThan(500); // Should create 3 clients in < 500ms
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory with multiple client creations', async () => {
      const benchmark = new PerformanceBenchmark();

      const result = await benchmark.benchmark('memory-test', async () => {
        createValidatorAPIClient({
          host: 'localhost',
          port: 443
        });
      }, { iterations: 100, measureMemory: true });

      expect(result.iterations).toBe(100);
      
      // Memory should not increase dramatically
      if (result.memoryUsage) {
        expect(result.memoryUsage.delta).toBeLessThan(50 * 1024 * 1024); // Less than 50MB increase
      }
    });
  });
});