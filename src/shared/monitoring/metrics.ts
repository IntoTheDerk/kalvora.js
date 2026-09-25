/**
 * Metrics Collection
 * 
 * Collects and reports performance metrics.
 */

export interface MetricPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string> | undefined;
}

export interface Metric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels?: Record<string, string> | undefined;
  points: MetricPoint[];
}

class MetricsCollector {
  private metrics: Map<string, Metric> = new Map();
  private readonly maxPoints = 1000;

  private getMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  private addPoint(metric: Metric, value: number, labels?: Record<string, string>): void {
    const point: MetricPoint = {
      timestamp: Date.now(),
      value,
      labels
    };

    metric.points.push(point);
    
    // Keep only recent points
    if (metric.points.length > this.maxPoints) {
      metric.points = metric.points.slice(-this.maxPoints);
    }
  }

  counter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    let metric = this.metrics.get(key);
    
    if (!metric) {
      metric = {
        name,
        type: 'counter',
        value: 0,
        labels,
        points: []
      };
      this.metrics.set(key, metric);
    }
    
    metric.value += value;
    this.addPoint(metric, metric.value, labels);
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    let metric = this.metrics.get(key);
    
    if (!metric) {
      metric = {
        name,
        type: 'gauge',
        value,
        labels,
        points: []
      };
      this.metrics.set(key, metric);
    } else {
      metric.value = value;
    }
    
    this.addPoint(metric, value, labels);
  }

  histogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    let metric = this.metrics.get(key);
    
    if (!metric) {
      metric = {
        name,
        type: 'histogram',
        value: 0,
        labels,
        points: []
      };
      this.metrics.set(key, metric);
    }
    
    this.addPoint(metric, value, labels);
  }

  getMetrics(): Metric[] {
    return Array.from(this.metrics.values());
  }

  getMetric(name: string, labels?: Record<string, string>): Metric | undefined {
    const key = this.getMetricKey(name, labels);
    return this.metrics.get(key);
  }

  clear(): void {
    this.metrics.clear();
  }

  export(): string {
    const metrics = this.getMetrics();
    const lines: string[] = [];
    
    for (const metric of metrics) {
      const labelStr = metric.labels 
        ? `{${Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
        : '';
      
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      lines.push(`${metric.name}${labelStr} ${metric.value}`);
    }
    
    return lines.join('\n');
  }
}

export const metrics = new MetricsCollector();
