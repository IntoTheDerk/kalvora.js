/**
 * Standardized Error Handler
 * 
 * Provides consistent error handling patterns across the SDK.
 * This module standardizes how errors are created, formatted, and handled.
 */

import { 
  KalvoraError, 
  ValidationError, 
  NetworkError, 
  CryptoError, 
  TransactionError,
  Result,
  createError,
  createSuccess
} from '../../types/index.js';
import { logger, metrics } from '../monitoring/index.js';

/**
 * Error context information
 */
export interface ErrorContext {
  operation: string;
  module: string;
  details?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Standardized error creation
 */
export class ErrorHandler {
  /**
   * Create a standardized error with context
   */
  static createError(
    type: 'validation' | 'network' | 'crypto' | 'transaction' | 'general',
    message: string,
    context?: ErrorContext
  ): Error {
    const timestamp = new Date().toISOString();
    const details: Record<string, unknown> = {
      timestamp,
      ...context?.details
    };

    if (context) {
      details.operation = context.operation;
      details.module = context.module;
    }

    let error: Error;
    switch (type) {
    case 'validation':
      error = new ValidationError(message, details);
      break;
    case 'network':
      error = new NetworkError(message, details);
      break;
    case 'crypto':
      error = new CryptoError(message, details);
      break;
    case 'transaction':
      error = new TransactionError(message, details);
      break;
    default:
      error = new KalvoraError(message, 'GENERAL_ERROR', details);
    }

    // Log the error
    logger.error(`Error created: ${message}`, context as unknown as Record<string, unknown>, error);
    
    // Track error metrics
    metrics.counter('errors.created', 1, { type });

    return error;
  }

  /**
   * Wrap an operation with standardized error handling
   */
  static async wrapOperation<T>(
    operation: () => Promise<T>,
    context: ErrorContext
  ): Promise<Result<T, Error>> {
    try {
      const result = await operation();
      return createSuccess(result);
    } catch (error) {
      const standardizedError = this.createError(
        'general',
        error instanceof Error ? error.message : 'Unknown error occurred',
        context
      );
      return createError(standardizedError);
    }
  }

  /**
   * Wrap a synchronous operation with standardized error handling
   */
  static wrapSyncOperation<T>(
    operation: () => T,
    context: ErrorContext
  ): Result<T, Error> {
    try {
      const result = operation();
      return createSuccess(result);
    } catch (error) {
      const standardizedError = this.createError(
        'general',
        error instanceof Error ? error.message : 'Unknown error occurred',
        context
      );
      return createError(standardizedError);
    }
  }

  /**
   * Format error for logging
   */
  static formatError(error: Error): string {
    if (error instanceof KalvoraError) {
      return `[${error.code}] ${error.message}${error.details ? ` | Details: ${JSON.stringify(error.details)}` : ''}`;
    }
    return `${error.name}: ${error.message}`;
  }

  /**
   * Check if error is retryable
   */
  static isRetryableError(error: Error): boolean {
    if (error instanceof NetworkError) {
      return true;
    }
    
    // Check for gRPC errors (which are typically retryable)
    if ('code' in error && 'details' in error) {
      return true;
    }
    
    // Check for specific retryable error messages
    const retryableMessages = [
      'timeout',
      'connection',
      'network',
      'temporary',
      'rate limit',
      'connection failed',
      'request timeout'
    ];
    
    return retryableMessages.some(msg => 
      error.message.toLowerCase().includes(msg)
    );
  }

  /**
   * Get error severity level
   */
  static getErrorSeverity(error: Error): 'low' | 'medium' | 'high' | 'critical' {
    if (error instanceof ValidationError) {
      return 'low';
    }
    
    if (error instanceof NetworkError) {
      return 'medium';
    }
    
    if (error instanceof CryptoError || error instanceof TransactionError) {
      return 'high';
    }
    
    // Check for critical error patterns
    const criticalPatterns = [
      'private key',
      'signature',
      'authentication',
      'authorization'
    ];
    
    if (criticalPatterns.some(pattern => 
      error.message.toLowerCase().includes(pattern)
    )) {
      return 'critical';
    }
    
    return 'medium';
  }
}

/**
 * Convenience functions for common error types
 */
export const createValidationError = (message: string, context?: ErrorContext) =>
  ErrorHandler.createError('validation', message, context);

export const createNetworkError = (message: string, context?: ErrorContext) =>
  ErrorHandler.createError('network', message, context);

export const createCryptoError = (message: string, context?: ErrorContext) =>
  ErrorHandler.createError('crypto', message, context);

export const createTransactionError = (message: string, context?: ErrorContext) =>
  ErrorHandler.createError('transaction', message, context);

/**
 * Error context builders
 */
export const createErrorContext = (
  operation: string,
  module: string,
  details?: Record<string, unknown>
): ErrorContext => ({
  operation,
  module,
  details: details || {},
  timestamp: new Date().toISOString()
});

/**
 * Module-specific error context builders
 */
export const walletErrorContext = (operation: string, details?: Record<string, unknown>) =>
  createErrorContext(operation, 'wallet-creation', details);

export const transactionErrorContext = (operation: string, details?: Record<string, unknown>) =>
  createErrorContext(operation, 'coin-txn', details);

export const grpcErrorContext = (operation: string, details?: Record<string, unknown>) =>
  createErrorContext(operation, 'grpc', details);

export const apiErrorContext = (operation: string, details?: Record<string, unknown>) =>
  createErrorContext(operation, 'api', details);

export const cryptoErrorContext = (operation: string, details?: Record<string, unknown>) =>
  createErrorContext(operation, 'crypto', details);
