/**
 * Universal Protobuf Utilities
 * 
 * Provides comprehensive sanitization for protobuf objects to ensure
 * they never contain empty strings for optional fields and properly
 * handle BigInt serialization.
 */

// import { create } from '@bufbuild/protobuf'; // Not used in current implementation

/**
 * Sanitization options interface
 */
export interface SanitizeOptions {
  removeEmptyFields?: boolean;
  convertBigInt?: boolean;
}

/**
 * Universal sanitization function for protobuf objects
 * Handles both empty field removal and BigInt conversion
 */
export function sanitizeProtobufObject<T = unknown>(
  obj: T, 
  options: SanitizeOptions = {}
): T | undefined {
  const { removeEmptyFields = false, convertBigInt = false } = options;
  
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  // Convert BigInt to string if requested
  if (convertBigInt && typeof obj === 'bigint') {
    return obj.toString() as T;
  }
  
  // Preserve Uint8Array objects (they're needed for key extraction)
  if (obj instanceof Uint8Array) {
    return (obj.length === 0 && removeEmptyFields ? undefined : obj) as T;
  }
  
  if (Array.isArray(obj)) {
    const sanitized = obj.map(item => sanitizeProtobufObject(item, options));
    const filtered = removeEmptyFields ? sanitized.filter(item => item !== undefined) : sanitized;
    return filtered as T;
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Always preserve protobuf metadata fields (starting with $)
      if (key.startsWith('$')) {
        result[key] = value;
        continue;
      }
      
      const sanitized = sanitizeProtobufObject(value, options);
      
      // For string fields, convert empty strings to undefined if requested
      if (removeEmptyFields && typeof sanitized === 'string' && sanitized.length === 0) {
        result[key] = undefined;
        continue;
      }
      
      // Always include the field - don't skip undefined values
      // For arrays, always include them even if empty (protobuf repeated fields)
      if (Array.isArray(sanitized)) {
        result[key] = sanitized;
      } else {
        result[key] = sanitized;
      }
    }
    
    return (Object.keys(result).length > 0 ? result : (removeEmptyFields ? undefined : {})) as T;
  }
  
  // Handle primitive types
  if (typeof obj === 'string') {
    if (removeEmptyFields && obj.length === 0) {
      return undefined as T;
    }
    return obj;
  }
  
  if (typeof obj === 'boolean') {
    return obj;
  }
  
  if (typeof obj === 'number') {
    return obj;
  }
  
  return obj;
}

/**
 * Create a protobuf object with comprehensive sanitization
 * This ensures optional fields are never empty strings
 */
export function createSanitized<T>(schema: new (data?: Partial<T>) => T, data: Record<string, unknown>): T {
  // First sanitize the input data to remove empty optional fields
  const sanitizedData = sanitizeProtobufObject(data, { removeEmptyFields: true });
  
  // Then create the protobuf object
  return new schema(sanitizedData as Partial<T>);
}

/**
 * Sanitize object for serialization (BigInt conversion)
 */
export function sanitizeForSerialization<T = unknown>(obj: T): T | undefined {
  return sanitizeProtobufObject(obj, { convertBigInt: true });
}

/**
 * Create multiple protobuf objects with sanitization
 * Useful for creating arrays of protobuf objects
 */
export function createSanitizedArray<T>(schema: new (data?: Partial<T>) => T, dataArray: Record<string, unknown>[]): T[] {
  return dataArray.map(data => createSanitized(schema, data));
}

/**
 * Conditionally create sanitized protobuf object
 * Only creates if data is not null/undefined
 */
export function createSanitizedConditional<T>(schema: new (data?: Partial<T>) => T, data: Record<string, unknown>): T | undefined {
  if (data === null || data === undefined) {
    return undefined;
  }
  return createSanitized(schema, data);
}
