/**
 * Monitoring Examples
 * 
 * Demonstrates how to use the monitoring tools.
 */

import { logger, metrics, healthChecker } from '../index.js';

/**
 * Example 1: Basic Logging
 */
export function exampleLogging(): void {
  console.log('📝 Example 1: Basic Logging');
  
  logger.debug('Debug message', { operation: 'example' });
  logger.info('Info message', { operation: 'example', userId: 'user123' });
  logger.warn('Warning message', { operation: 'example' });
  logger.error('Error message', { operation: 'example' });
}

/**
 * Example 2: Metrics Collection
 */
export function exampleMetrics(): void {
  console.log('📊 Example 2: Metrics Collection');
  
  // Count events
  metrics.counter('api.requests', 1, { endpoint: '/transactions' });
  metrics.counter('transactions.created', 1, { type: 'coin' });
  
  // Track values
  metrics.gauge('memory.usage', 256, { unit: 'MB' });
  metrics.gauge('active.connections', 42);
  
  // Record durations
  metrics.histogram('request.duration', 150, { endpoint: '/transactions' });
  metrics.histogram('transaction.processing.time', 89);
  
  // Export metrics
  console.log('Metrics export:');
  console.log(metrics.export());
}

/**
 * Example 3: Health Checks
 */
export async function exampleHealthChecks(): Promise<void> {
  console.log('🏥 Example 3: Health Checks');
  
  // Add custom health check
  healthChecker.addCheck('custom-service', {
    name: 'custom-service',
    check: async () => {
      // Simulate service check
      const isHealthy = Math.random() > 0.3;
      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        message: isHealthy ? 'Service is running' : 'Service is down',
        details: { uptime: Date.now() }
      };
    },
    timeout: 2000
  });
  
  // Run individual check
  const customCheck = await healthChecker.runCheck('custom-service');
  console.log('Custom check result:', customCheck);
  
  // Run all checks
  const healthReport = await healthChecker.runAllChecks();
  console.log('Health report:', healthReport);
}

/**
 * Example 4: Integrated Monitoring
 */
export async function exampleIntegratedMonitoring(): Promise<void> {
  console.log('🔧 Example 4: Integrated Monitoring');
  
  const operation = 'createTransaction';
  const startTime = Date.now();
  
  try {
    // Log operation start
    logger.info('Operation started', { operation });
    metrics.counter('operations.started', 1, { type: operation });
    
    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Log success
    const duration = Date.now() - startTime;
    logger.info('Operation completed', { operation, duration });
    metrics.counter('operations.completed', 1, { type: operation });
    metrics.histogram('operation.duration', duration, { type: operation });
    
  } catch (error) {
    // Log error
    const duration = Date.now() - startTime;
    logger.error('Operation failed', { operation, duration }, error as Error);
    metrics.counter('operations.failed', 1, { type: operation });
    metrics.histogram('operation.duration', duration, { type: operation, status: 'failed' });
  }
}

/**
 * Run all examples
 */
export async function runAllExamples(): Promise<void> {
  console.log('🚀 Running Monitoring Examples\n');
  
  exampleLogging();
  console.log('');
  
  exampleMetrics();
  console.log('');
  
  await exampleHealthChecks();
  console.log('');
  
  await exampleIntegratedMonitoring();
  console.log('');
  
  console.log('✅ All monitoring examples completed!');
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().catch(console.error);
}
