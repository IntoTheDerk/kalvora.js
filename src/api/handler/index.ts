/**
 * Handler Services - Main Exports
 * 
 * Centralized handler services for all external API calls.
 * All external calls should go through these handlers for proper routing.
 */

// Nonce handler services
export { 
  getNonce, 
  getNonces, 
  nonceHandler
} from './nonce/service.js';

// Transaction submission uses direct gRPC calls - no handler needed

// Token info handler services
export { 
  getTokenFeeInfo, 
  getTokenInfoForSingle, 
  isTokenSupported, 
  getTokenDenomination, 
  getTokenRate, 
  getTokenInfoMap, 
  tokenInfoHandler,
  type TokenInfoHandlerOptions,
  type TokenInfo 
} from './token-info/service.js';

// Fee info handler services (rate handling)
export { 
  getExchangeRate, 
  processRate, 
  rateHandler,
  type RateHandlerOptions,
  type RateSource,
  type CacheInfo 
} from './fee-info/service.js';
