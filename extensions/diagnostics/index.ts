import { cpus, freemem, totalmem, uptime as osUptime, loadavg, hostname, platform, release } from 'node:os';
import type { Extension, ExtensionContext } from '@hydraclaw/extensions';

interface DiagnosticSnapshot {
  timestamp: string;
  system: {
    hostname: string;
    platform: string;
    release: string;
    uptime: number;
    loadAvg: number[];
    cpuCount: number;
    memoryTotal: number;
    memoryFree: number;
    memoryUsed: number;
    memoryUsagePercent: number;
  };
  process: {
    pid: number;
    uptime: number;
    memoryRss: number;
    memoryHeapTotal: number;
    memoryHeapUsed: number;
    memoryExternal: number;
    nodeVersion: string;
  };
  extensions: {
    loaded: number;
    names: string[];
  };
  health: 'healthy' | 'degraded' | 'critical';
  issues: string[];
}

/**
 * Diagnostics Extension
 *
 * Provides system health reporting, resource monitoring, and diagnostic
 * data collection. Exposes system and process metrics, tracks health
 * over time, and emits alerts when thresholds are exceeded.
 */
class DiagnosticsExtension implements Extension {
  id = 'diagnostics';
  name = 'Diagnostics';
  description = 'System health reporting, resource monitoring, and diagnostic data collection';
  version = '1.0.0';
  type = 'integration' as const;

  private ctx: ExtensionContext | null = null;
  private snapshots: DiagnosticSnapshot[] = [];
  private monitorInterval: NodeJS.Timeout | null = null;
  private maxSnapshots = 1000;
  private thresholds = {
    memoryUsagePercent: 90,
    heapUsagePercent: 85,
    loadAvgPerCpu: 2.0,
  };

  async init(context: ExtensionContext): Promise<void> {
    this.ctx = context;
    const intervalMs = (context.config.intervalMs as number) ?? 30000;
    this.maxSnapshots = (context.config.maxSnapshots as number) ?? 1000;

    if (context.config.thresholds) {
      Object.assign(this.thresholds, context.config.thresholds);
    }

    context.logger.info('Diagnostics extension initializing');

    // Periodic monitoring
    this.monitorInterval = setInterval(() => {
      const snapshot = this.collectSnapshot();
      this.snapshots.push(snapshot);

      if (this.snapshots.length > this.maxSnapshots) {
        this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);
      }

      // Emit alerts for critical issues
      if (snapshot.health === 'critical') {
        context.bus.emit('diagnostics:critical', snapshot).catch(() => {});
      } else if (snapshot.health === 'degraded') {
        context.bus.emit('diagnostics:degraded', snapshot).catch(() => {});
      }
    }, intervalMs);

    // Listen for diagnostic requests
    context.bus.on('diagnostics:request', async (...args: unknown[]) => {
      const [callback] = args as [(snapshot: DiagnosticSnapshot) => void];
      const snapshot = this.collectSnapshot();
      callback(snapshot);
    });

    // Take initial snapshot
    const initial = this.collectSnapshot();
    this.snapshots.push(initial);
    context.logger.info(`Diagnostics initialized: ${initial.health} (monitor every ${intervalMs}ms)`);
  }

  async destroy(): Promise<void> {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.snapshots = [];
    this.ctx?.logger.info('Diagnostics destroyed');
  }

  collectSnapshot(): DiagnosticSnapshot {
    const memTotal = totalmem();
    const memFree = freemem();
    const memUsed = memTotal - memFree;
    const memUsagePercent = (memUsed / memTotal) * 100;

    const processMemory = process.memoryUsage();
    const cpuCount = cpus().length;
    const load = loadavg();

    const issues: string[] = [];

    if (memUsagePercent > this.thresholds.memoryUsagePercent) {
      issues.push(`System memory usage at ${memUsagePercent.toFixed(1)}% (threshold: ${this.thresholds.memoryUsagePercent}%)`);
    }

    const heapUsagePercent = (processMemory.heapUsed / processMemory.heapTotal) * 100;
    if (heapUsagePercent > this.thresholds.heapUsagePercent) {
      issues.push(`Heap usage at ${heapUsagePercent.toFixed(1)}% (threshold: ${this.thresholds.heapUsagePercent}%)`);
    }

    const loadPerCpu = load[0]! / cpuCount;
    if (loadPerCpu > this.thresholds.loadAvgPerCpu) {
      issues.push(`Load average per CPU at ${loadPerCpu.toFixed(2)} (threshold: ${this.thresholds.loadAvgPerCpu})`);
    }

    let health: 'healthy' | 'degraded' | 'critical';
    if (issues.length === 0) {
      health = 'healthy';
    } else if (issues.length <= 1) {
      health = 'degraded';
    } else {
      health = 'critical';
    }

    return {
      timestamp: new Date().toISOString(),
      system: {
        hostname: hostname(),
        platform: platform(),
        release: release(),
        uptime: osUptime(),
        loadAvg: load,
        cpuCount,
        memoryTotal: memTotal,
        memoryFree: memFree,
        memoryUsed: memUsed,
        memoryUsagePercent: Math.round(memUsagePercent * 100) / 100,
      },
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        memoryRss: processMemory.rss,
        memoryHeapTotal: processMemory.heapTotal,
        memoryHeapUsed: processMemory.heapUsed,
        memoryExternal: processMemory.external,
        nodeVersion: process.version,
      },
      extensions: {
        loaded: 0, // Will be filled by the runtime
        names: [],
      },
      health,
      issues,
    };
  }

  getHistory(limit?: number): DiagnosticSnapshot[] {
    return this.snapshots.slice(-(limit ?? 100));
  }

  getLatest(): DiagnosticSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1]! : null;
  }

  getHealthTrend(count: number = 10): { timestamp: string; health: string }[] {
    return this.snapshots.slice(-count).map(s => ({
      timestamp: s.timestamp,
      health: s.health,
    }));
  }
}

export default new DiagnosticsExtension();
