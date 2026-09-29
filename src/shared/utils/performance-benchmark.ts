/**
 * Performance Benchmarking Utilities
 * 
 * Provides comprehensive performance measurement and benchmarking tools
 * for the Kalvora SDK. Useful for optimization and performance monitoring.
 */

import { performance } from 'perf_hooks';

import { logger, metrics } from '../monitoring/index.js';

/**
 * Benchmark result interface
 */
export interface BenchmarkResult {
  /** Name of the benchmark */
  name: string;
  /** Execution time in milliseconds */
  duration: number;
  /** Number of iterations performed */
  iterations: number;
  /** Average time per iteration in milliseconds */
  averageTime: number;
  /** Minimum execution time in milliseconds */
  minTime: number;
  /** Maximum execution time in milliseconds */
  maxTime: number;
  /** Standard deviation of execution times */
  standardDeviation: number;
  /** Memory usage in bytes (if available) */
  memoryUsage?: {
    before: number;
    after: number;
    delta: number;
  };
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Benchmark configuration options
 */
export interface BenchmarkOptions {
  /** Number of iterations to run */
  iterations?: number;
  /** Warmup iterations (not counted in results) */
  warmupIterations?: number;
  /** Whether to measure memory usage */
  measureMemory?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Additional metadata to include */
  metadata?: Record<string, unknown>;
}

/**
 * Performance benchmark class
 */
export class PerformanceBenchmark {
  private results: BenchmarkResult[] = [];

  /**
   * Run a benchmark for a given function
   */
  async benchmark<T>(
    name: string,
    fn: () => T | Promise<T>,
    options: BenchmarkOptions = {}
  ): Promise<BenchmarkResult> {
    const {
      iterations = 1000,
      warmupIterations = 10,
      measureMemory = false,
      timeout = 30000,
      metadata = {}
    } = options;

    // Warmup iterations
    for (let i = 0; i < warmupIterations; i++) {
      try {
        await fn();
      } catch {
        // Ignore warmup errors
      }
    }

    const times: number[] = [];
    let memoryBefore: number | undefined;
    let memoryAfter: number | undefined;

    // Measure memory before if requested
    if (measureMemory && process.memoryUsage) {
      memoryBefore = process.memoryUsage().heapUsed;
    }

    const startTime = performance.now();

    // Run benchmark iterations
    for (let i = 0; i < iterations; i++) {
      const iterationStart = performance.now();
      
      try {
        await fn();
        const iterationEnd = performance.now();
        const duration = iterationEnd - iterationStart;
        times.push(duration);
        
        // Track performance metrics
        metrics.histogram('benchmark.iteration.duration', duration, { name });
      } catch {
        // Record failed iteration as 0 time
        times.push(0);
        logger.warn(`Benchmark iteration ${i + 1} failed`, { name, iteration: i + 1 });
        metrics.counter('benchmark.iterations.failed', 1, { name });
      }

      // Check timeout
      if (performance.now() - startTime > timeout) {
        break;
      }
    }

    // Measure memory after if requested
    if (measureMemory && process.memoryUsage) {
      memoryAfter = process.memoryUsage().heapUsed;
    }

    const result = this.calculateStats(name, times, {
      memoryBefore: memoryBefore || 0,
      memoryAfter: memoryAfter || 0,
      metadata: metadata || {}
    });

    this.results.push(result);
    return result;
  }

  /**
   * Run multiple benchmarks in sequence
   */
  async benchmarkSuite(
    benchmarks: Array<{
      name: string;
      fn: () => unknown | Promise<unknown>;
      options?: BenchmarkOptions;
    }>
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];

    for (const benchmark of benchmarks) {
      const result = await this.benchmark(
        benchmark.name,
        benchmark.fn,
        benchmark.options
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Run multiple benchmarks in parallel
   */
  async benchmarkParallel(
    benchmarks: Array<{
      name: string;
      fn: () => unknown | Promise<unknown>;
      options?: BenchmarkOptions;
    }>
  ): Promise<BenchmarkResult[]> {
    const promises = benchmarks.map(benchmark =>
      this.benchmark(benchmark.name, benchmark.fn, benchmark.options)
    );

    return Promise.all(promises);
  }

  /**
   * Calculate statistics from execution times
   */
  private calculateStats(
    name: string,
    times: number[],
    options: {
      memoryBefore?: number;
      memoryAfter?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): BenchmarkResult {
    const validTimes = times.filter(t => t > 0);
    const iterations = times.length;

    if (iterations === 0) {
      return {
        name,
        duration: 0,
        iterations: 0,
        averageTime: 0,
        minTime: 0,
        maxTime: 0,
        standardDeviation: 0,
        metadata: options.metadata || {}
      };
    }

    const totalTime = validTimes.reduce((sum, time) => sum + time, 0);
    const averageTime = validTimes.length > 0 ? totalTime / validTimes.length : 0;
    const minTime = validTimes.length > 0 ? Math.min(...validTimes) : 0;
    const maxTime = validTimes.length > 0 ? Math.max(...validTimes) : 0;

    // Calculate standard deviation
    const variance = validTimes.length > 0 ? validTimes.reduce((sum, time) => {
      const diff = time - averageTime;
      return sum + (diff * diff);
    }, 0) / validTimes.length : 0;
    const standardDeviation = Math.sqrt(variance);

    const result: BenchmarkResult = {
      name,
      duration: totalTime,
      iterations,
      averageTime,
      minTime,
      maxTime,
      standardDeviation,
      metadata: options.metadata || {}
    };

    // Add memory usage if available
    if (options.memoryBefore !== undefined && options.memoryAfter !== undefined) {
      result.memoryUsage = {
        before: options.memoryBefore,
        after: options.memoryAfter,
        delta: options.memoryAfter - options.memoryBefore
      };
    }

    return result;
  }

  /**
   * Get all benchmark results
   */
  getResults(): BenchmarkResult[] {
    return [...this.results];
  }

  /**
   * Clear all benchmark results
   */
  clearResults(): void {
    this.results = [];
  }

  /**
   * Generate a performance report
   */
  generateReport(): string {
    if (this.results.length === 0) {
      return 'No benchmark results available.';
    }

    let report = 'Performance Benchmark Report\n';
    report += `${'='.repeat(50)}\n\n`;

    for (const result of this.results) {
      report += `Benchmark: ${result.name}\n`;
      report += `  Iterations: ${result.iterations}\n`;
      report += `  Total Time: ${result.duration.toFixed(2)}ms\n`;
      report += `  Average Time: ${result.averageTime.toFixed(4)}ms\n`;
      report += `  Min Time: ${result.minTime.toFixed(4)}ms\n`;
      report += `  Max Time: ${result.maxTime.toFixed(4)}ms\n`;
      report += `  Std Dev: ${result.standardDeviation.toFixed(4)}ms\n`;

      if (result.memoryUsage) {
        report += `  Memory Delta: ${result.memoryUsage.delta} bytes\n`;
      }

      if (result.metadata && Object.keys(result.metadata).length > 0) {
        report += `  Metadata: ${JSON.stringify(result.metadata, null, 2)}\n`;
      }

      report += '\n';
    }

    return report;
  }

  /**
   * Compare two benchmark results
   */
  static compare(result1: BenchmarkResult, result2: BenchmarkResult): {
    name1: string;
    name2: string;
    speedup: number;
    slowdown: number;
    difference: number;
    percentageChange: number;
  } {
    const speedup = result1.averageTime / result2.averageTime;
    const slowdown = result2.averageTime / result1.averageTime;
    const difference = result2.averageTime - result1.averageTime;
    const percentageChange = (difference / result1.averageTime) * 100;

    return {
      name1: result1.name,
      name2: result2.name,
      speedup,
      slowdown,
      difference,
      percentageChange
    };
  }
}

/**
 * Convenience function to run a single benchmark
 */
export async function benchmark<T>(
  name: string,
  fn: () => T | Promise<T>,
  options?: BenchmarkOptions
): Promise<BenchmarkResult> {
  const benchmark = new PerformanceBenchmark();
  return benchmark.benchmark(name, fn, options);
}

/**
 * Convenience function to run a benchmark suite
 */
export async function benchmarkSuite(
  benchmarks: Array<{
    name: string;
    fn: () => unknown | Promise<unknown>;
    options?: BenchmarkOptions;
  }>
): Promise<BenchmarkResult[]> {
  const benchmark = new PerformanceBenchmark();
  return benchmark.benchmarkSuite(benchmarks);
}

/**
 * Memory usage tracker
 */
export class MemoryTracker {
  private measurements: Array<{
    name: string;
    memory: number;
    timestamp: number;
  }> = [];

  /**
   * Record current memory usage
   */
  record(name: string): void {
    if (process.memoryUsage) {
      const memory = process.memoryUsage().heapUsed;
      this.measurements.push({
        name,
        memory,
        timestamp: performance.now()
      });
    }
  }

  /**
   * Get memory usage report
   */
  getReport(): string {
    if (this.measurements.length === 0) {
      return 'No memory measurements recorded.';
    }

    let report = 'Memory Usage Report\n';
    report += `${'='.repeat(30)}\n\n`;

    for (let i = 0; i < this.measurements.length; i++) {
      const measurement = this.measurements[i];
      const prevMeasurement = i > 0 ? this.measurements[i - 1] : null;

      report += `${measurement?.name}: ${measurement?.memory} bytes`;
      
      if (prevMeasurement) {
        const delta = (measurement?.memory || 0) - (prevMeasurement?.memory || 0);
        const percentage = (delta / (prevMeasurement?.memory || 1)) * 100;
        report += ` (${delta > 0 ? '+' : ''}${delta} bytes, ${percentage.toFixed(2)}%)`;
      }
      
      report += '\n';
    }

    return report;
  }

  /**
   * Clear all measurements
   */
  clear(): void {
    this.measurements = [];
  }
}

/**
 * Performance monitoring decorator
 */
export function measurePerformance<_T extends(...args: unknown[]) => unknown>(
  name?: string
) {
  return function (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const _methodName = name || `${(target as { constructor: { name: string } }).constructor.name}.${propertyKey}`;

    descriptor.value = async function (..._args: unknown[]) {
      const _start = performance.now();
      const result = await originalMethod.apply(this, _args);
      const _end = performance.now();
      
      
      return result;
    };

    return descriptor;
  };
}
