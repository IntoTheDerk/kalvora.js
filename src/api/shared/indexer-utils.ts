/**
 * Shared utilities for indexer routing logic
 */

/**
 * Determine if indexer should be used based on environment
 * @returns true if INDEXER_AUTH is provided, false otherwise
 */
export function shouldUseIndexer(): boolean {
  // Use indexer if authentication is provided
  return !!process.env.INDEXER_AUTH;
}

/**
 * Get indexer authentication header value
 * @returns the INDEXER_AUTH value or undefined
 */
export function getIndexerAuth(): string | undefined {
  return process.env.INDEXER_AUTH;
}
