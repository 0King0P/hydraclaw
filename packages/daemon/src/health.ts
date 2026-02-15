import { createLogger } from '@hydraclaw/core';
import { isPidRunning, readPid } from './pid.js';

const logger = createLogger({ name: 'health-monitor' });

/** Options for the HealthMonitor. */
export interface HealthMonitorOptions {
  /** Base URL for the gateway health endpoint (e.g. "http://127.0.0.1:3000"). */
  gatewayUrl: string;
  /** How often to check health, in milliseconds. Defaults to 30 000 (30 s). */
  checkIntervalMs?: number;
  /** Number of consecutive failures before triggering a restart. Defaults to 3. */
  maxConsecutiveFailures?: number;
  /** HTTP timeout for each health check request, in milliseconds. Defaults to 5 000. */
  requestTimeoutMs?: number;
  /** Callback invoked when the watchdog decides a restart is needed. */
  onRestartNeeded?: () => void | Promise<void>;
}

export interface HealthStatus {
  healthy: boolean;
  pid: number | null;
  pidRunning: boolean;
  gatewayReachable: boolean;
  consecutiveFailures: number;
  lastCheckAt: Date | null;
  uptimeMs: number | null;
}

/**
 * Health monitoring for the HydraClaw daemon.
 *
 * Performs periodic HTTP health checks against the gateway and monitors the
 * daemon PID. When the configured failure threshold is exceeded the optional
 * `onRestartNeeded` callback is invoked so the caller can trigger a restart.
 */
export class HealthMonitor {
  private readonly gatewayUrl: string;
  private readonly checkIntervalMs: number;
  private readonly maxConsecutiveFailures: number;
  private readonly requestTimeoutMs: number;
  private readonly onRestartNeeded?: () => void | Promise<void>;

  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private lastCheckAt: Date | null = null;
  private startedAt: Date | null = null;
  private running = false;

  constructor(opts: HealthMonitorOptions) {
    this.gatewayUrl = opts.gatewayUrl.replace(/\/+$/, '');
    this.checkIntervalMs = opts.checkIntervalMs ?? 30_000;
    this.maxConsecutiveFailures = opts.maxConsecutiveFailures ?? 3;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 5_000;
    this.onRestartNeeded = opts.onRestartNeeded;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the periodic health check loop.
   */
  start(): void {
    if (this.running) {
      logger.warn('HealthMonitor is already running');
      return;
    }

    this.running = true;
    this.startedAt = new Date();
    this.consecutiveFailures = 0;
    logger.info('HealthMonitor started (interval=%dms, threshold=%d)', this.checkIntervalMs, this.maxConsecutiveFailures);

    // Run immediately, then on the interval
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.checkIntervalMs);
  }

  /**
   * Stop the periodic health check loop.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.startedAt = null;
    logger.info('HealthMonitor stopped');
  }

  /**
   * Return the current health status snapshot.
   */
  async getStatus(): Promise<HealthStatus> {
    const pid = readPid();
    const pidRunning = pid !== null ? isPidRunning(pid) : false;
    const gatewayReachable = await this.checkGatewayHealth();

    return {
      healthy: pidRunning && gatewayReachable,
      pid,
      pidRunning,
      gatewayReachable,
      consecutiveFailures: this.consecutiveFailures,
      lastCheckAt: this.lastCheckAt,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt.getTime() : null,
    };
  }

  // -----------------------------------------------------------------------
  // Gateway Health Check
  // -----------------------------------------------------------------------

  /**
   * Perform a single HTTP health check against the gateway.
   *
   * Returns `true` if the gateway responds with a 2xx status within the
   * configured timeout, `false` otherwise.
   */
  async checkGatewayHealth(): Promise<boolean> {
    const url = `${this.gatewayUrl}/health`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'User-Agent': 'HydraClaw-HealthMonitor/1.0' },
        });
        return response.ok;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      logger.debug('Gateway health check failed: %s', (err as Error).message);
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Watchdog
  // -----------------------------------------------------------------------

  /**
   * Run a single watchdog cycle: check PID + gateway health, and trigger
   * a restart if failures exceed the threshold.
   *
   * This is called automatically by the interval timer but can also be
   * invoked manually for testing.
   */
  async watchDog(): Promise<void> {
    const pid = readPid();
    const pidAlive = pid !== null && isPidRunning(pid);
    const gatewayOk = await this.checkGatewayHealth();

    this.lastCheckAt = new Date();

    if (pidAlive && gatewayOk) {
      if (this.consecutiveFailures > 0) {
        logger.info('Gateway recovered after %d failures', this.consecutiveFailures);
      }
      this.consecutiveFailures = 0;
      return;
    }

    this.consecutiveFailures++;

    if (!pidAlive) {
      logger.warn('Daemon PID %s is not running (failure %d/%d)', pid ?? 'N/A', this.consecutiveFailures, this.maxConsecutiveFailures);
    } else if (!gatewayOk) {
      logger.warn('Gateway health check failed (failure %d/%d)', this.consecutiveFailures, this.maxConsecutiveFailures);
    }

    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      logger.error(
        'Consecutive failure threshold reached (%d). Requesting restart.',
        this.maxConsecutiveFailures,
      );
      this.consecutiveFailures = 0;

      if (this.onRestartNeeded) {
        try {
          await this.onRestartNeeded();
        } catch (restartErr) {
          logger.error('Restart callback failed: %s', (restartErr as Error).message);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async tick(): Promise<void> {
    try {
      await this.watchDog();
    } catch (err) {
      logger.error('Unexpected error during health check tick: %s', (err as Error).message);
    }
  }
}
