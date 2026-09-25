 
import type { GenService } from '@bufbuild/protobuf/codegenv2';
import { ConnectError, createClient as createConnectClient, type Client, type Interceptor } from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';

import { logger } from '../shared/monitoring/index.js';
import type { GRPCConfig } from '../types/index.js';

import { KalvoraRpcError } from './errors.js';
import { createGrpcWebFetch } from './utils/grpc-web-fetch-wrapper.js';

/**
 * Wrap a client so that every failed unary call surfaces as a
 * {@link KalvoraRpcError} carrying the real gRPC status code.
 *
 * This is done at the client boundary rather than in a transport interceptor:
 * ConnectRPC re-wraps non-`ConnectError` exceptions thrown by interceptors as
 * `ConnectError` with code `Unknown`, which would discard the server's status
 * code (e.g. `NOT_FOUND`). It also covers caller-supplied transports.
 * Streaming methods are passed through unchanged.
 */
function withErrorNormalization<T extends object>(client: T, serviceTypeName: string): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (result instanceof Promise) {
          return result.catch((err: unknown) => {
            if (err instanceof ConnectError) {
              const method = String(property);
              throw KalvoraRpcError.fromConnectError(err, method.charAt(0).toUpperCase() + method.slice(1), serviceTypeName);
            }
            throw err;
          });
        }
        return result;
      };
    }
  });
}

/**
 * URL Rewriter Interceptor.
 *
 * In @connectrpc/connect v2, the request URL is built using `method.parent.typeName`.
 * Shallow cloning `service.typeName` no longer works. This interceptor explicitly
 * rewrites the outgoing request URL to match the Envoy paths expected by the Kalvora backend.
 */
const urlRewriter: Interceptor = (next) => async (req) => {
  let rewrittenUrl = req.url;
  for (const [originalPath, newPath] of Object.entries(SERVICE_TYPE_NAME_MAPPING)) {
    const searchString = `/${originalPath}/`;
    if (rewrittenUrl.includes(searchString)) {
      rewrittenUrl = rewrittenUrl.replace(searchString, `/${newPath}/`);
      break;
    }
  }
  
  if (rewrittenUrl !== req.url) {
    return next({ ...req, url: rewrittenUrl });
  }
  return next(req);
};

/**
 * Mapping of protobuf service names to desired URL prefixes/service names.
 * This allows hitting /api/Nonce instead of /zera_api.APIService/Nonce,
 * /txn/Coin instead of /zera_txn.TXNService/Coin, and
 * /validator/... for ValidatorService.
 */
const SERVICE_TYPE_NAME_MAPPING: Record<string, string> = {
  'zera_api.APIService': 'api',
  'zera_txn.TXNService': 'txn',
  'zera_validator.ValidatorService': 'validator',
  'zera_guardian.GuardianService': 'guardian'
};

function redactUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid-url]';
  }
}

function isLocalDevelopmentHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized === '::1' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    return true;
  }
  if (/^127(?:\.\d{1,3}){3}$/u.test(normalized) || /^10(?:\.\d{1,3}){3}$/u.test(normalized) || /^192\.168(?:\.\d{1,3}){2}$/u.test(normalized)) {
    return true;
  }
  const private172 = /^172\.(\d{1,3})(?:\.\d{1,3}){2}$/u.exec(normalized);
  return private172 !== null && Number(private172[1]) >= 16 && Number(private172[1]) <= 31;
}


/**
 * Create a ConnectRPC client for the given service
 * 
 * @param service - The service definition (from generated proto)
 * @param config - Configuration options
 * @returns A Client for the service
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createClient<T extends GenService<any>>(
  service: T,
  config: GRPCConfig = {}
): Client<T> {
  if (config.transport) {
    return withErrorNormalization(createConnectClient(service, config.transport), service.typeName);
  }

  // Default configuration: Kalvora protonet over HTTPS (443)
  const host = config.host || 'kal-protonet.visiondynamics.ch';
  const port = config.port || 443;
  const protocol = config.protocol || 'https';
  const servicePath = SERVICE_TYPE_NAME_MAPPING[service.typeName];

  // Normalize endpoint: ensure protocol is present even if caller passes a bare hostname
  const hasProtocol = (value: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  let baseUrl = config.endpoint || `${protocol}://${host}:${port}`;
  if (!hasProtocol(baseUrl)) {
    baseUrl = `${protocol}://${baseUrl}`;
  }

  // Try to parse the URL so downstream fetch/fallback always receives a valid absolute URL
  let actualHostname = host;
  let actualProtocol = `${protocol}:`;
  try {
    const baseUrlObj = new URL(baseUrl);
    if (baseUrlObj.protocol !== 'http:' && baseUrlObj.protocol !== 'https:') {
      throw new TypeError('gRPC endpoint protocol must be http or https');
    }
    if (baseUrlObj.username || baseUrlObj.password) {
      throw new TypeError('gRPC endpoint must not contain credentials');
    }
    if (config.port && !baseUrlObj.port) {
      baseUrlObj.port = String(config.port);
    }
    baseUrl = baseUrlObj.toString();
    actualHostname = baseUrlObj.hostname;
    actualProtocol = baseUrlObj.protocol;
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith('gRPC endpoint')) throw error;
    throw new TypeError('gRPC endpoint must be a valid absolute or bare-host HTTP(S) URL');
  }
  
  // Normalize baseUrl: remove trailing slashes to prevent double slashes in path construction
  // ConnectRPC will add the necessary slashes when constructing the full URL
  baseUrl = baseUrl.replace(/\/+$/, '');
  
  // If the endpoint already includes a service path (e.g., /api, /txn, /validator),
  // remove it since the service mapping will add it back
  // This prevents duplicate slashes when calling configured service endpoints.
  if (servicePath) {
    const pathToRemove = `/${servicePath.replace(/\/$/, '')}`;
    if (baseUrl.endsWith(pathToRemove)) {
      baseUrl = baseUrl.slice(0, -pathToRemove.length);
    }
  }

  // Fallback is an explicit local-development opt-in. Never silently
  // downgrade a Kalvora HTTPS request to plaintext.
  const fallbackEnabled = config.fallbackToHttp === true;
  if (fallbackEnabled && !isLocalDevelopmentHost(actualHostname)) {
    throw new TypeError('gRPC HTTP fallback is restricted to loopback or private development hosts');
  }
  const fallbackPort = config.fallbackPort || 8080;

  const baseFetch = config.fetch || globalThis.fetch;

  // Wrapper fetch for fallback logic
  const retryingFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (baseFetch as any)(input, init);
      return response;
    } catch (error) {
      // Attempt fallback if enabled, using HTTPS, and request failed
      if (fallbackEnabled && actualProtocol === 'https:') {
        let urlStr = '';
        if (typeof input === 'string') {
          urlStr = input;
        } else if (input instanceof URL) {
          urlStr = input.toString();
        } else if (typeof input === 'object' && input !== null && 'url' in input) {
          // Handle Request object
          urlStr = input.url;
        }

        // Only retry if we can determine the URL and it matches our target host
        if (urlStr) {
          try {
            const requestUrl = new URL(urlStr);
            // Compare against the actual hostname from baseUrl (not the default host)
            // This ensures fallback works even when a custom endpoint is provided
            if (requestUrl.hostname === actualHostname) {
              // Construct fallback URL: http://host:fallbackPort/path...
              requestUrl.protocol = 'http:';
              requestUrl.port = fallbackPort.toString();
              
              const fallbackUrl = requestUrl.toString();
              
              logger.warn('HTTPS connection failed, falling back to HTTP', {
                operation: 'grpcFallback',
                module: 'grpc-client-factory',
                originalUrl: redactUrlForLog(urlStr),
                fallbackUrl: redactUrlForLog(fallbackUrl),
                hostname: actualHostname,
                host: host,
                port: port,
                fallbackPort: fallbackPort
              });
              
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const fallbackResponse = await (baseFetch as any)(fallbackUrl, init);
              return fallbackResponse;
            }
          } catch (fallbackError) {
            // If fallback fails or URL parsing fails, we just ignore and throw original error below
            if (fallbackError instanceof Error && 'message' in fallbackError && fallbackError.message !== 'fetch failed') {
              // Only log if it's not just another connection failure (reduce noise)
              logger.warn('Fallback attempt error', {
                operation: 'grpcFallback',
                module: 'grpc-client-factory',
                hostname: actualHostname,
                host: host,
                fallbackPort: fallbackPort,
                error: fallbackError.message,
                errorName: fallbackError.name,
                failedUrl: redactUrlForLog(urlStr),
                baseUrl: redactUrlForLog(baseUrl)
              });
            }
          }
        }
      }
      throw error;
    }
  };

  // Detect client-side environment (React Native or Web Browser)
  // Only use standard fetch in Node.js server environment
  const isNodeJs = typeof process !== 'undefined' &&
    typeof process.versions !== 'undefined' &&
    typeof process.versions.node !== 'undefined';

  // Use gRPC-Web transport with binary format
  // In React Native or Web browsers, use custom fetch wrapper to handle binary responses
  // In Node.js, use the retryingFetch with fallback logic
  const transport = createGrpcWebTransport({
    baseUrl,
    useBinaryFormat: true,
    interceptors: [urlRewriter],
    // Use custom fetch wrapper for all client-side environments (RN + Web)
    fetch: !isNodeJs ? createGrpcWebFetch() : retryingFetch
  });

  return withErrorNormalization(createConnectClient(service, transport), service.typeName);
}
