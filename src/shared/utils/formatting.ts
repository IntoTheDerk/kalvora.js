/**
 * Shared Formatting Utilities
 * 
 * Provides common formatting functions used across the SDK.
 */

/**
 * Format duration in milliseconds to human-readable string
 * 
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 * 
 * @example
 * ```typescript
 * formatDuration(500); // "500ms"
 * formatDuration(1500); // "1.50s"
 * formatDuration(65000); // "1m 5.00s"
 * formatDuration(3661000); // "1h 1m 1.00s"
 * ```
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  return `${hours}h ${remainingMinutes}m ${remainingSeconds.toFixed(2)}s`;
}

/**
 * Format bytes to human-readable string
 * 
 * @param bytes - Number of bytes
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted bytes string
 * 
 * @example
 * ```typescript
 * formatBytes(1024); // "1.00 KB"
 * formatBytes(1048576); // "1.00 MB"
 * formatBytes(1073741824); // "1.00 GB"
 * ```
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Format number with thousands separators
 * 
 * @param num - Number to format
 * @param locale - Locale for formatting (default: 'en-US')
 * @returns Formatted number string
 * 
 * @example
 * ```typescript
 * formatNumber(1234567); // "1,234,567"
 * formatNumber(1234567.89); // "1,234,567.89"
 * ```
 */
export function formatNumber(num: number, locale: string = 'en-US'): string {
  return new Intl.NumberFormat(locale).format(num);
}

/**
 * Format percentage with specified decimal places
 * 
 * @param value - Value to format as percentage
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted percentage string
 * 
 * @example
 * ```typescript
 * formatPercentage(0.1234); // "12.34%"
 * formatPercentage(0.1234, 1); // "12.3%"
 * ```
 */
export function formatPercentage(value: number, decimals: number = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format currency amount
 * 
 * @param amount - Amount to format
 * @param currency - Currency code (default: 'USD')
 * @param locale - Locale for formatting (default: 'en-US')
 * @returns Formatted currency string
 * 
 * @example
 * ```typescript
 * formatCurrency(1234.56); // "$1,234.56"
 * formatCurrency(1234.56, 'EUR'); // "€1,234.56"
 * ```
 */
export function formatCurrency(amount: number, currency: string = 'USD', locale: string = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency
  }).format(amount);
}

/**
 * Format date to human-readable string
 * 
 * @param date - Date to format
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string
 * 
 * @example
 * ```typescript
 * formatDate(new Date()); // "12/25/2023"
 * formatDate(new Date(), { year: 'numeric', month: 'long', day: 'numeric' }); // "December 25, 2023"
 * ```
 */
export function formatDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  };
  
  return new Intl.DateTimeFormat('en-US', options || defaultOptions).format(date);
}

/**
 * Format date and time to human-readable string
 * 
 * @param date - Date to format
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date and time string
 * 
 * @example
 * ```typescript
 * formatDateTime(new Date()); // "12/25/2023, 3:30:45 PM"
 * ```
 */
export function formatDateTime(date: Date, options?: Intl.DateTimeFormatOptions): string {
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  };
  
  return new Intl.DateTimeFormat('en-US', options || defaultOptions).format(date);
}

/**
 * Truncate string to specified length with ellipsis
 * 
 * @param str - String to truncate
 * @param length - Maximum length
 * @param ellipsis - Ellipsis string (default: '...')
 * @returns Truncated string
 * 
 * @example
 * ```typescript
 * truncateString('This is a long string', 10); // "This is a..."
 * truncateString('Short', 10); // "Short"
 * ```
 */
export function truncateString(str: string, length: number, ellipsis: string = '...'): string {
  if (str.length <= length) {
    return str;
  }
  
  return str.substring(0, length - ellipsis.length) + ellipsis;
}

/**
 * Format memory usage for display
 * 
 * @param bytes - Memory usage in bytes
 * @returns Formatted memory string
 * 
 * @example
 * ```typescript
 * formatMemoryUsage(1024 * 1024); // "1.00 MB"
 * ```
 */
export function formatMemoryUsage(bytes: number): string {
  return formatBytes(bytes);
}
