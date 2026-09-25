# Monitoring

This module provides monitoring and observability tools for the SDK.

## What it does

- Structured logging with different levels
- Metrics collection and reporting
- Health checks for system status
- Performance monitoring

## Components

### Logger (`logger.ts`)
Structured logging with context and error handling.

```typescript
import { logger } from './logger.js';

logger.info('Transaction created', {
  operation: 'createTransaction',
  transactionId: 'tx123',
  duration: 150
});

logger.error('Transaction failed', {
  operation: 'createTransaction'
}, error);
```

### Metrics (`metrics.ts`)
Collect performance and business metrics.

```typescript
import { metrics } from './metrics.js';

// Count events
metrics.counter('transactions.created', 1, { type: 'coin' });

// Track values
metrics.gauge('memory.usage', 256, { unit: 'MB' });

// Record durations
metrics.histogram('transaction.duration', 150, { type: 'coin' });
```

### Health Checks (`health-check.ts`)
Monitor system health and status.

```typescript
import { healthChecker } from './health-check.js';

// Add custom health check
healthChecker.addCheck('database', {
  name: 'database',
  check: async () => {
    // Check database connection
    return { status: 'healthy' };
  }
});

// Run all checks
const report = await healthChecker.runAllChecks();
console.log(report.status); // 'healthy' | 'unhealthy' | 'degraded'
```

## Usage

```typescript
import { logger, metrics, healthChecker } from './index.js';

// Log operations
logger.info('Starting transaction', { operation: 'create' });

// Track metrics
metrics.counter('operations.started', 1);

// Check health
const health = await healthChecker.runAllChecks();
```

## Configuration

Set environment variables:
- `LOG_LEVEL`: debug, info, warn, error
- `NODE_ENV`: development, production

## Built-in Health Checks

- Memory usage monitoring
- Disk space checking
- Network connectivity
- Custom checks can be added
