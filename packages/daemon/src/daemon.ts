import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { createLogger } from '@hydraclaw/core';
import { writePid, readPid, removePid, isPidRunning } from './pid.js';
import { HealthMonitor, type HealthMonitorOptions } from './health.js';

const logger = createLogger({ name: 'daemon' });

const DATA_DIR = resolve(homedir(), '.hydraclaw');
const LOG_FILE = resolve(DATA_DIR, 'logs', 'daemon.log');
const DEFAULT_GATEWAY_ENTRY = resolve(process.cwd(), 'node_modules', '@hydraclaw', 'gateway', 'dist', 'index.js');

/** Information returned by the `status()` method. */
export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  uptimeMs: number | null;
  memoryUsage: NodeJS.MemoryUsage | null;
  logFile: string;
}

/** Options accepted by the daemon constructor. */
export interface DaemonOptions {
  /** Absolute path to the gateway entry-point module to fork. */
  gatewayEntry?: string;
  /** Gateway base URL used for health checks. */
  gatewayUrl?: string;
  /** Custom PID file path (defaults to ~/.hydraclaw/daemon.pid). */
  pidPath?: string;
  /** Health monitor options (check interval, failure threshold, etc.). */
  health?: Partial<HealthMonitorOptions>;
}

/**
 * Manages the HydraClaw gateway as a detached background process.
 *
 * Supports starting, stopping, restarting, status queries, and log tailing.
 * Integrates with {@link HealthMonitor} for automatic crash recovery.
 */
export class HydraClawDaemon {
  private readonly gatewayEntry: string;
  private readonly gatewayUrl: string;
  private readonly pidPath: string | undefined;
  private readonly healthOpts: Partial<HealthMonitorOptions>;

  private child: ChildProcess | null = null;
  private healthMonitor: HealthMonitor | null = null;
  private startedAt: Date | null = null;

  constructor(opts?: DaemonOptions) {
    this.gatewayEntry = opts?.gatewayEntry ?? DEFAULT_GATEWAY_ENTRY;
    this.gatewayUrl = opts?.gatewayUrl ?? 'http://127.0.0.1:3000';
    this.pidPath = opts?.pidPath;
    this.healthOpts = opts?.health ?? {};
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Fork the gateway process, write the PID file, and optionally start
   * the health monitor.
   *
   * Throws if the daemon is already running.
   */
  async start(): Promise<number> {
    if (await this.isRunning()) {
      const existingPid = readPid(this.pidPath);
      throw new Error(`Daemon is already running (PID ${existingPid}). Stop it first or use restart().`);
    }

    logger.info('Starting HydraClaw daemon (entry=%s)', this.gatewayEntry);

    if (!existsSync(this.gatewayEntry)) {
      throw new Error(`Gateway entry point not found: ${this.gatewayEntry}. Did you run \`pnpm build\`?`);
    }

    // Ensure the log directory exists
    const { mkdirSync } = await import('node:fs');
    const logDir = resolve(DATA_DIR, 'logs');
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    // Open log file for stdout/stderr of the child
    const { openSync } = await import('node:fs');
    const logFd = openSync(LOG_FILE, 'a');

    this.child = fork(this.gatewayEntry, [], {
      detached: true,
      stdio: ['ignore', logFd, logFd, 'ipc'],
      env: { ...process.env, HYDRACLAW_DAEMON: '1' },
    });

    const pid = this.child.pid;
    if (pid === undefined) {
      throw new Error('Failed to fork gateway process: PID is undefined.');
    }

    writePid(pid, this.pidPath);
    this.startedAt = new Date();
    logger.info('Daemon started (PID %d)', pid);

    // Disconnect so the parent can exit without killing the child
    this.child.unref();
    this.child.disconnect();

    // Start health monitor
    this.healthMonitor = new HealthMonitor({
      gatewayUrl: this.gatewayUrl,
      ...this.healthOpts,
      onRestartNeeded: async () => {
        logger.warn('Watchdog triggered restart');
        await this.restart();
      },
    });
    this.healthMonitor.start();

    return pid;
  }

  /**
   * Stop the daemon by sending SIGTERM to the PID recorded in the PID file.
   *
   * Waits up to `timeoutMs` for the process to exit, then sends SIGKILL.
   */
  async stop(timeoutMs: number = 10_000): Promise<void> {
    // Stop health monitor first
    if (this.healthMonitor) {
      this.healthMonitor.stop();
      this.healthMonitor = null;
    }

    const pid = readPid(this.pidPath);
    if (pid === null) {
      logger.warn('No PID file found; daemon may not be running.');
      return;
    }

    if (!isPidRunning(pid)) {
      logger.warn('PID %d is not running. Cleaning up stale PID file.', pid);
      removePid(this.pidPath);
      return;
    }

    logger.info('Sending SIGTERM to PID %d', pid);
    process.kill(pid, 'SIGTERM');

    // Wait for the process to exit
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isPidRunning(pid)) {
        break;
      }
      await sleep(250);
    }

    // Force kill if still alive
    if (isPidRunning(pid)) {
      logger.warn('PID %d did not exit in %dms. Sending SIGKILL.', pid, timeoutMs);
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process may have exited between the check and the kill.
      }
    }

    removePid(this.pidPath);
    this.child = null;
    this.startedAt = null;
    logger.info('Daemon stopped');
  }

  /**
   * Restart the daemon (stop then start).
   */
  async restart(): Promise<number> {
    logger.info('Restarting daemon');
    await this.stop();
    // Small grace period to release ports
    await sleep(1_000);
    return this.start();
  }

  /**
   * Return the current daemon status including PID, uptime, and memory usage.
   */
  async status(): Promise<DaemonStatus> {
    const pid = readPid(this.pidPath);
    const running = pid !== null && isPidRunning(pid);

    let uptimeMs: number | null = null;
    if (running && this.startedAt) {
      uptimeMs = Date.now() - this.startedAt.getTime();
    }

    let memoryUsage: NodeJS.MemoryUsage | null = null;
    if (running) {
      // We can only get memory usage for our own process; for the child we
      // would need IPC or /proc. Provide our own usage as a proxy when
      // running in-process, otherwise null.
      if (this.child && this.child.connected) {
        memoryUsage = process.memoryUsage();
      }
    }

    return {
      running,
      pid,
      uptimeMs,
      memoryUsage,
      logFile: LOG_FILE,
    };
  }

  /**
   * Tail the daemon log file, printing the last `lines` lines to stdout.
   *
   * Returns the lines as an array of strings.
   */
  async logs(lines: number = 50): Promise<string[]> {
    if (!existsSync(LOG_FILE)) {
      logger.warn('Log file does not exist: %s', LOG_FILE);
      return [];
    }

    return new Promise<string[]>((resolvePromise, reject) => {
      const allLines: string[] = [];

      const stream = createReadStream(LOG_FILE, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        allLines.push(line);
        // Keep a rolling window so we don't hold the entire file in memory
        if (allLines.length > lines * 2) {
          allLines.splice(0, allLines.length - lines);
        }
      });

      rl.on('close', () => {
        const tail = allLines.slice(-lines);
        resolvePromise(tail);
      });

      rl.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Check whether the daemon is currently running (PID file exists and
   * process is alive).
   */
  async isRunning(): Promise<boolean> {
    const pid = readPid(this.pidPath);
    if (pid === null) {
      return false;
    }
    return isPidRunning(pid);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
