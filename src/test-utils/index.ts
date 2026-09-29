/**
 * Test Utilities for Kalvora JS SDK
 * Provides pre-configured test keys and basic assertion functions
 */

// Export test keys for universal use
export * from './keys.test.js';

// Test result tracking for assertions
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  startTime: Date.now()
};

/**
 * Basic assertion functions
 */
export const assert = {
  /**
   * Assert that a condition is true
   */
  ok(condition: unknown, message: string = 'Assertion failed'): boolean {
    testResults.total++;
    if (condition) {
      testResults.passed++;
      return true;
    } else {
      testResults.failed++;
      throw new Error(message);
    }
  },

  /**
   * Assert that two values are equal
   */
  equal(actual: unknown, expected: unknown, message: string = `Expected ${expected}, but got ${actual}`): boolean {
    testResults.total++;
    if (actual === expected) {
      testResults.passed++;
      return true;
    } else {
      testResults.failed++;
      throw new Error(message);
    }
  },

  /**
   * Assert that two values are deeply equal (for objects/arrays)
   */
  deepEqual(actual: unknown, expected: unknown, message: string = 'Objects are not deeply equal'): boolean {
    testResults.total++;
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      testResults.passed++;
      return true;
    } else {
      testResults.failed++;
      throw new Error(message);
    }
  },

  /**
   * Assert that a function throws an error
   */
  throws(fn: () => unknown, expectedError: unknown = null, message: string = 'Expected function to throw an error'): Error {
    testResults.total++;
    try {
      fn();
      testResults.failed++;
      throw new Error(message);
    } catch (error) {
      if (expectedError && !(error instanceof (expectedError as new (...args: unknown[]) => Error))) {
        testResults.failed++;
        const expectedName = (expectedError as new (...args: unknown[]) => Error).name;
        throw new Error(`Expected ${expectedName}, but got ${(error as Error).constructor.name}`);
      }
      testResults.passed++;
      return error as Error;
    }
  },

  /**
   * Assert that a function does not throw an error
   */
  doesNotThrow(fn: () => unknown, message: string = 'Expected function not to throw an error'): boolean {
    testResults.total++;
    try {
      fn();
      testResults.passed++;
      return true;
    } catch (error) {
      testResults.failed++;
      throw new Error(`${message}: ${(error as Error).message}`);
    }
  },

  /**
   * Assert that a condition is false
   */
  fail(message: string = 'Test failed'): never {
    testResults.total++;
    testResults.failed++;
    throw new Error(message);
  }
};
