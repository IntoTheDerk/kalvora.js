/**
 * Structured Logger
 * 
 * Provides structured logging with different levels and context.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  operation?: string;
  module?: string;
  userId?: string;
  transactionId?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext | undefined;
  error?: {
    name: string;
    message: string;
    stack?: string | undefined;
    details?: unknown;
  };
}

const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';
const TRUNCATED = '[Truncated]';
const UNSERIALIZABLE = '[Unserializable]';
const MAX_REDACTION_DEPTH = 8;
const MAX_COLLECTION_ENTRIES = 100;
const MAX_REDACTION_NODES = 1000;

const SECRET_KEYS = new Set([
  'mnemonic',
  'privatekey',
  'extendedprivatekey',
  'seed',
  'passphrase',
  'authorization',
  'apikey',
  'bearertoken'
]);

interface RedactionState {
  nodesVisited: number;
  ancestors: WeakSet<object>;
}

function isSecretKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SECRET_KEYS.has(normalizedKey);
}

function redactValue(value: unknown, depth: number, state: RedactionState): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (depth >= MAX_REDACTION_DEPTH || state.nodesVisited >= MAX_REDACTION_NODES) {
    return TRUNCATED;
  }

  if (state.ancestors.has(value)) {
    return CIRCULAR;
  }

  state.nodesVisited += 1;
  state.ancestors.add(value);

  try {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      const redactedArray = value
        .slice(0, MAX_COLLECTION_ENTRIES)
        .map(item => redactValue(item, depth + 1, state));

      if (value.length > MAX_COLLECTION_ENTRIES) {
        redactedArray.push(TRUNCATED);
      }

      return redactedArray;
    }

    let keys: string[];
    try {
      keys = Object.keys(value);
    } catch {
      return UNSERIALIZABLE;
    }

    const redactedObject: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys.slice(0, MAX_COLLECTION_ENTRIES)) {
      if (isSecretKey(key)) {
        redactedObject[key] = REDACTED;
        continue;
      }

      try {
        redactedObject[key] = redactValue(
          (value as Record<string, unknown>)[key],
          depth + 1,
          state
        );
      } catch {
        redactedObject[key] = UNSERIALIZABLE;
      }
    }

    if (keys.length > MAX_COLLECTION_ENTRIES) {
      redactedObject.$truncated = TRUNCATED;
    }

    return redactedObject;
  } finally {
    state.ancestors.delete(value);
  }
}

function redactForLogging(value: unknown): unknown {
  return redactValue(value, 0, {
    nodesVisited: 0,
    ancestors: new WeakSet<object>()
  });
}

class Logger {
  private logLevel: LogLevel = 'info';
  private isProduction: boolean = false;

  constructor() {
    const runtimeEnv = typeof process !== 'undefined' && process.env
      ? process.env
      : undefined;
    this.isProduction = runtimeEnv?.NODE_ENV === 'production';
    this.logLevel = (runtimeEnv?.LOG_LEVEL as LogLevel | undefined) || 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
    return levels[level] >= levels[this.logLevel];
  }

  private formatLog(entry: LogEntry): string {
    if (this.isProduction) {
      return JSON.stringify(entry);
    }
    
    const timestamp = entry.timestamp;
    const level = entry.level.toUpperCase().padEnd(5);
    const message = entry.message;
    const context = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const errorDetails = entry.error?.details !== undefined
      ? ` ${JSON.stringify(entry.error.details)}`
      : '';
    const error = entry.error
      ? `\nError: ${entry.error.name}: ${entry.error.message}${errorDetails}`
      : '';
    
    return `[${timestamp}] ${level} ${message}${context}${error}`;
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    if (!this.shouldLog(level)) return;

    const redactedContext = context
      ? redactForLogging(context) as LogContext
      : undefined;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: redactedContext
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };

      try {
        if ('details' in error && error.details !== undefined) {
          entry.error.details = redactForLogging(error.details);
        }
      } catch {
        entry.error.details = UNSERIALIZABLE;
      }
    }

    const formatted = this.formatLog(entry);
    
    switch (level) {
    case 'debug':
      console.debug(formatted);
      break;
    case 'info':
      console.info(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    case 'error':
      console.error(formatted);
      break;
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext, error?: Error): void {
    this.log('error', message, context, error);
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }
}

export const logger = new Logger();
