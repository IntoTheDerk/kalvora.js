import { logger } from '../../shared/monitoring/index.js';
 
/**
 * Custom fetch wrapper for React Native to handle gRPC-Web binary responses
 *
 * React Native's fetch has issues parsing binary protobuf responses.
 * This wrapper intercepts responses and ensures proper binary handling.
 */

/**
 * Minimal ReadableStream polyfill for React Native
 * Implements the subset of ReadableStream API that ConnectRPC uses
 */
class MinimalReadableStream {
  private locked = false;
  private reader: MinimalReader | null = null;
  private underlyingSource: UnderlyingSource | null = null;
  private data: Uint8Array | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(underlyingSourceOrData?: any) {
    // Handle two cases:
    // 1. Standard ReadableStream API: new ReadableStream({ start, pull, cancel })
    // 2. Our simplified API: new MinimalReadableStream(uint8Array)

    if (underlyingSourceOrData instanceof Uint8Array) {
      // Case 2: Direct Uint8Array data (our custom usage)
      this.data = underlyingSourceOrData;
    } else if (typeof underlyingSourceOrData === 'object' && underlyingSourceOrData !== null) {
      // Case 1: UnderlyingSource object (standard ReadableStream API)
      this.underlyingSource = underlyingSourceOrData;
    }
  }

  getReader() {
    if (this.locked) {
      throw new TypeError('ReadableStream is locked');
    }
    this.locked = true;

    if (this.data !== null) {
      // Simple case: we have direct data
      this.reader = new MinimalReader(this.data);
    } else if (this.underlyingSource !== null) {
      // Standard case: use the underlying source
      this.reader = new MinimalReader(this.underlyingSource);
    } else {
      logger.error('[RN Stream] No data or underlying source available', { module: 'grpc-web-fetch' });
      this.reader = new MinimalReader(new Uint8Array(0));
    }

    return this.reader;
  }
}

// Type definition for UnderlyingSource (subset that ConnectRPC uses)
interface UnderlyingSource {
  start?: (controller: ReadableStreamController) => void | Promise<void>;
  pull?: (controller: ReadableStreamController) => void | Promise<void>;
  cancel?: (reason?: unknown) => void | Promise<void>;
}

interface ReadableStreamController {
  enqueue: (chunk: Uint8Array) => void;
  close: () => void;
  error: (error: Error) => void;
}

class MinimalReader {
  private chunks: Uint8Array[] = [];
  private done = false;
  private streamClosed = false;
  private underlyingSource: UnderlyingSource | null = null;
  private controller: ReadableStreamController | null = null;
  private pullPromise: Promise<void> | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(dataOrSource: Uint8Array | UnderlyingSource | any) {
    if (dataOrSource instanceof Uint8Array) {
      // Simple case: direct data
      this.chunks.push(dataOrSource);
      this.streamClosed = true; // No more data coming
    } else if (typeof dataOrSource === 'object' && dataOrSource !== null &&
               ('start' in dataOrSource || 'pull' in dataOrSource)) {
      // UnderlyingSource case
      const underlyingSource: UnderlyingSource = dataOrSource;
      this.underlyingSource = underlyingSource;
      this.controller = {
        enqueue: (chunk: Uint8Array) => {
          this.chunks.push(chunk);
        },
        close: () => {
          this.streamClosed = true;
        },
        error: (err: Error) => {
          logger.error('[RN Reader] Controller.error() called', { module: 'grpc-web-fetch', error: err instanceof Error ? err.message : String(err) });
          this.streamClosed = true;
          this.done = true;
        }
      };

      // Call start() if it exists
      const startFn = underlyingSource.start;
      const controller = this.controller;
      if (startFn && controller) {
        const result = startFn(controller);
        if (result instanceof Promise) {
          result.catch(err => {
            logger.error('[RN Reader] start() failed', { module: 'grpc-web-fetch', error: err instanceof Error ? err.message : String(err) });
            this.controller?.error(err);
          });
        }
      }
    } else {
      logger.error('[RN Reader] Unknown data type, creating empty reader', { module: 'grpc-web-fetch' });
      this.streamClosed = true;
    }
  }

  async read(): Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }> {
    // If we have chunks available, return the first one
    if (this.chunks.length > 0) {
      const chunk = this.chunks.shift();
      if (chunk) {
        return { done: false, value: chunk };
      }
    }

    // If stream is closed and no chunks, we're done
    if (this.streamClosed) {
      this.done = true;
      return { done: true, value: undefined };
    }

    // Need to pull more data from underlying source
    if (this.underlyingSource?.pull && this.controller) {
      try {
        const result = this.underlyingSource.pull(this.controller);
        if (result instanceof Promise) {
          await result;
        }

        // After pull, check if we got chunks
        if (this.chunks.length > 0) {
          const chunk = this.chunks.shift();
          if (chunk) {
            return { done: false, value: chunk };
          }
        }
      } catch (err) {
        logger.error('[RN Reader] pull() failed', { module: 'grpc-web-fetch', error: err instanceof Error ? err.message : String(err) });
        this.streamClosed = true;
        this.done = true;
        return { done: true, value: undefined };
      }
    }

    // No data available and no way to get more
    this.streamClosed = true;
    this.done = true;
    return { done: true, value: undefined };
  }

  releaseLock() {
    // No-op for minimal implementation
  }

  async cancel(reason?: unknown) {
    if (this.underlyingSource?.cancel) {
      const result = this.underlyingSource.cancel(reason);
      if (result instanceof Promise) {
        await result;
      }
    }
    this.streamClosed = true;
    this.done = true;
  }
}

// Install ReadableStream polyfill globally if it doesn't exist
// This is needed for React Native compatibility with ConnectRPC
if (typeof globalThis.ReadableStream === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ReadableStream = MinimalReadableStream;
}

export function createGrpcWebFetch(): typeof globalThis.fetch {
  const nativeFetch = globalThis.fetch;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const response = await nativeFetch(input, init);

      // Only intervene for gRPC-Web binary responses
      if (response.ok && response.status === 200) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/grpc-web+proto') ||
            contentType?.includes('application/grpc-web')) {

          // Check if body exists BEFORE reading it
          const bodyExists = response.body !== null && response.body !== undefined;

          // If body exists, return it unchanged - ConnectRPC will handle it
          if (bodyExists) {
            return response;
          }

          // If body doesn't exist, this is the React Native bug - we need to fix it

          try {
            // Clone first to preserve the ability to read
            const cloned = response.clone();
            const arrayBuffer = await cloned.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);

            // Create a minimal ReadableStream polyfill
            const mockStream = new MinimalReadableStream(bytes);

            // Override the body property to return our mock stream
            Object.defineProperty(response, 'body', {
              get() { return mockStream; },
              configurable: true
            });

            Object.defineProperty(response, 'bodyUsed', {
              get() { return false; }, // Always report as not used
              configurable: true
            });

            // Override methods to return cached data (fallback if ConnectRPC doesn't use streams)
            response.arrayBuffer = async () => arrayBuffer;
            response.text = async () => new TextDecoder().decode(arrayBuffer);

            return response;

          } catch (parseError) {
            logger.error('[RN Binary Parser] Failed to fix missing body', { module: 'grpc-web-fetch', error: parseError instanceof Error ? parseError.message : String(parseError) });
            return response;
          }
        }
      }

      return response;

    } catch (error) {
      logger.error('[RN Binary Parser] Fetch error', { module: 'grpc-web-fetch', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
}
