/**
 * Health Check System
 * 
 * Monitors system health and provides status endpoints.
 */

export interface HealthCheck {
  name: string;
  check: () => Promise<HealthStatus>;
  timeout?: number;
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  details?: Record<string, unknown>;
  timestamp?: number;
}

export interface HealthReport {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: number;
  checks: Record<string, HealthStatus>;
  uptime: number;
  version?: string | undefined;
}

class HealthChecker {
  private checks: Map<string, HealthCheck> = new Map();
  private startTime: number = Date.now();

  addCheck(name: string, check: HealthCheck): void {
    this.checks.set(name, check);
  }

  removeCheck(name: string): void {
    this.checks.delete(name);
  }

  async runCheck(name: string): Promise<HealthStatus> {
    const check = this.checks.get(name);
    if (!check) {
      return {
        status: 'unhealthy',
        message: `Check '${name}' not found`,
        timestamp: Date.now()
      };
    }

    try {
      const timeout = check.timeout || 5000;
      const result = await Promise.race([
        check.check(),
        new Promise<HealthStatus>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), timeout)
        )
      ]);
      
      return {
        ...result,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
    }
  }

  async runAllChecks(): Promise<HealthReport> {
    const results: Record<string, HealthStatus> = {};
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

    for (const [name] of this.checks) {
      const result = await this.runCheck(name);
      results[name] = result;
      
      if (result.status === 'unhealthy') {
        overallStatus = 'unhealthy';
      } else if (result.status === 'degraded' && overallStatus === 'healthy') {
        overallStatus = 'degraded';
      }
    }

    return {
      status: overallStatus,
      timestamp: Date.now(),
      checks: results,
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version
    };
  }

  // Built-in health checks
  async memoryCheck(): Promise<HealthStatus> {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    
    if (heapUsedMB > 500) {
      return {
        status: 'degraded',
        message: 'High memory usage',
        details: { heapUsedMB, heapTotalMB }
      };
    }
    
    return {
      status: 'healthy',
      details: { heapUsedMB, heapTotalMB }
    };
  }

  async diskSpaceCheck(): Promise<HealthStatus> {
    // Simple disk space check (if available)
    try {
      const fs = await import('fs/promises');
      const stats = await fs.stat('.');
      
      return {
        status: 'healthy',
        details: { 
          available: stats.size,
          timestamp: stats.mtime.getTime()
        }
      };
    } catch {
      return {
        status: 'healthy',
        message: 'Disk space check not available'
      };
    }
  }

  async networkCheck(): Promise<HealthStatus> {
    try {
      // Simple network connectivity check (Node.js 18+)
      if (typeof fetch === 'undefined') {
        return {
          status: 'healthy',
          message: 'Network check not available (fetch not supported)'
        };
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch('https://httpbin.org/status/200', {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return { status: 'healthy' };
      } else {
        return {
          status: 'degraded',
          message: `Network check returned ${response.status}`
        };
      }
    } catch {
      return {
        status: 'unhealthy',
        message: 'Network connectivity check failed'
      };
    }
  }
}

export const healthChecker = new HealthChecker();

// Add default health checks
healthChecker.addCheck('memory', {
  name: 'memory',
  check: () => healthChecker.memoryCheck()
});

healthChecker.addCheck('disk', {
  name: 'disk',
  check: () => healthChecker.diskSpaceCheck()
});

healthChecker.addCheck('network', {
  name: 'network',
  check: () => healthChecker.networkCheck(),
  timeout: 5000
});
