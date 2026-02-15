import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const HYDRACLAW_DIR = resolve(homedir(), '.hydraclaw');
const PID_FILE = resolve(HYDRACLAW_DIR, 'daemon.pid');
const LOG_FILE = resolve(HYDRACLAW_DIR, 'logs', 'daemon.log');
const DAEMON_CONFIG_FILE = resolve(HYDRACLAW_DIR, 'daemon.json');

/**
 * Create the `hydraclaw daemon` command group.
 *
 * Subcommands:
 *   hydraclaw daemon start    - Start the background daemon
 *   hydraclaw daemon stop     - Stop the daemon
 *   hydraclaw daemon restart  - Restart the daemon
 *   hydraclaw daemon status   - Show daemon status
 *   hydraclaw daemon logs     - Tail daemon logs
 */
export function createDaemonCommand(): Command {
  const command = new Command('daemon');
  command.description('Manage the HydraClaw background daemon');

  // ─── start ──────────────────────────────────────────────────────────
  command
    .command('start')
    .description('Start the HydraClaw background daemon')
    .option('-c, --config <path>', 'Path to config file')
    .option('--foreground', 'Run in foreground (do not daemonize)')
    .action(async (opts: { config?: string; foreground?: boolean }) => {
      ensureDirectories();

      // Check if already running
      const existingPid = readPid();
      if (existingPid && isProcessRunning(existingPid)) {
        console.log(chalk.yellow(`Daemon is already running (PID ${existingPid})`));
        return;
      }

      // Clean up stale PID file
      if (existingPid) {
        removePidFile();
      }

      const configArgs: string[] = [];
      if (opts.config) {
        configArgs.push('--config', opts.config);
      }

      if (opts.foreground) {
        console.log(chalk.cyan('Starting HydraClaw in foreground...'));
        console.log(chalk.dim('Press Ctrl+C to stop.\n'));

        // In foreground mode, just exec the start command in-process
        const { loadConfig, createLogger, Container, MessageBus } = await import('@hydraclaw/core');
        const config = loadConfig(opts.config);
        const logger = createLogger({ name: 'hydraclaw-daemon', pretty: true });
        logger.info('Daemon running in foreground mode');

        // Write PID file for status checks
        writePid(process.pid);

        // The actual server start is handled by the 'start' command;
        // in foreground mode we let it run inline.
        const { createGatewayServer } = await import('@hydraclaw/gateway');
        const container = new Container();
        const bus = new MessageBus();
        container.registerInstance('config', config);
        container.registerInstance('gatewayConfig', config.gateway);
        container.registerInstance('agentConfig', config.agent);
        container.registerInstance('logger', logger);
        container.registerInstance('bus', bus);

        const gateway = createGatewayServer(container);
        await gateway.start();

        const shutdown = async () => {
          await gateway.stop();
          removePidFile();
          process.exit(0);
        };
        process.on('SIGINT', () => shutdown());
        process.on('SIGTERM', () => shutdown());
        return;
      }

      // Daemonize: spawn a detached child process
      console.log(chalk.cyan('Starting HydraClaw daemon...'));

      const hydraclawBin = process.argv[1]; // Path to the CLI entry point
      const child = spawn(
        process.execPath,
        [hydraclawBin, 'start', ...configArgs],
        {
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, HYDRACLAW_DAEMON: '1' },
        },
      );

      // Write the daemon PID
      if (child.pid) {
        writePid(child.pid);
        console.log(chalk.green(`Daemon started (PID ${child.pid})`));
        console.log(chalk.dim(`  PID file: ${PID_FILE}`));
        console.log(chalk.dim(`  Log file: ${LOG_FILE}`));
      }

      // Pipe stdout/stderr to log file
      const { createWriteStream } = await import('node:fs');
      const logStream = createWriteStream(LOG_FILE, { flags: 'a' });
      if (child.stdout) child.stdout.pipe(logStream);
      if (child.stderr) child.stderr.pipe(logStream);

      child.unref();
    });

  // ─── stop ───────────────────────────────────────────────────────────
  command
    .command('stop')
    .description('Stop the HydraClaw background daemon')
    .action(() => {
      const pid = readPid();
      if (!pid) {
        console.log(chalk.yellow('No daemon PID file found. Daemon may not be running.'));
        return;
      }

      if (!isProcessRunning(pid)) {
        console.log(chalk.yellow(`Daemon (PID ${pid}) is not running. Cleaning up PID file.`));
        removePidFile();
        return;
      }

      console.log(chalk.cyan(`Stopping daemon (PID ${pid})...`));

      try {
        process.kill(pid, 'SIGTERM');
        console.log(chalk.green('Stop signal sent. Daemon will shut down gracefully.'));
      } catch (err) {
        console.error(chalk.red(`Failed to stop daemon: ${err instanceof Error ? err.message : String(err)}`));
      }

      // Wait briefly and check
      setTimeout(() => {
        if (!isProcessRunning(pid)) {
          removePidFile();
          console.log(chalk.green('Daemon stopped.'));
        } else {
          console.log(chalk.dim('Daemon is still shutting down...'));
        }
      }, 2000);
    });

  // ─── restart ────────────────────────────────────────────────────────
  command
    .command('restart')
    .description('Restart the HydraClaw background daemon')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (opts: { config?: string }) => {
      const pid = readPid();

      if (pid && isProcessRunning(pid)) {
        console.log(chalk.cyan(`Stopping current daemon (PID ${pid})...`));
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // Process may have already exited
        }

        // Wait for the process to exit
        await waitForExit(pid, 10_000);
        removePidFile();
        console.log(chalk.green('Daemon stopped.'));
      }

      console.log(chalk.cyan('Starting daemon...'));

      // Re-invoke the start subcommand
      const hydraclawBin = process.argv[1];
      const configArgs: string[] = [];
      if (opts.config) configArgs.push('--config', opts.config);

      const child = spawn(
        process.execPath,
        [hydraclawBin, 'start', ...configArgs],
        {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, HYDRACLAW_DAEMON: '1' },
        },
      );

      if (child.pid) {
        writePid(child.pid);
        console.log(chalk.green(`Daemon restarted (PID ${child.pid})`));
      }

      child.unref();
    });

  // ─── status ─────────────────────────────────────────────────────────
  command
    .command('status')
    .description('Show the daemon status')
    .action(async () => {
      const pid = readPid();

      console.log(chalk.bold.cyan('HydraClaw Daemon Status\n'));

      if (!pid) {
        console.log(`  Status:  ${chalk.red('not running')}`);
        console.log(`  PID:     ${chalk.dim('none')}`);
        return;
      }

      const running = isProcessRunning(pid);
      console.log(`  Status:  ${running ? chalk.green('running') : chalk.red('not running')}`);
      console.log(`  PID:     ${pid}`);
      console.log(`  PID file: ${PID_FILE}`);
      console.log(`  Log file: ${LOG_FILE}`);

      // Read daemon config for extra info
      if (existsSync(DAEMON_CONFIG_FILE)) {
        try {
          const daemonConfig = JSON.parse(readFileSync(DAEMON_CONFIG_FILE, 'utf-8'));
          console.log(`  Auto-start: ${daemonConfig.autoStart ? chalk.green('yes') : chalk.dim('no')}`);
          if (daemonConfig.healthCheck) {
            console.log(`  Health check: ${daemonConfig.healthCheck.enabled ? chalk.green(`every ${daemonConfig.healthCheck.intervalSeconds}s`) : chalk.dim('disabled')}`);
          }
        } catch {
          // Ignore config parse errors
        }
      }

      if (!running) {
        console.log(chalk.yellow('\n  PID file exists but process is not running.'));
        console.log(chalk.dim('  Run `hydraclaw daemon start` to start the daemon.'));
      }

      // Try to reach the gateway health endpoint
      if (running) {
        try {
          const { loadConfig } = await import('@hydraclaw/core');
          const config = loadConfig();
          const url = `http://${config.gateway.host === '0.0.0.0' ? '127.0.0.1' : config.gateway.host}:${config.gateway.port}/health`;

          const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
          if (response.ok) {
            const health = await response.json() as { uptime?: number };
            console.log(`\n  Gateway:  ${chalk.green('reachable')}`);
            if (health.uptime) {
              console.log(`  Uptime:   ${formatUptime(health.uptime)}`);
            }
          } else {
            console.log(`\n  Gateway:  ${chalk.yellow('unreachable')} (HTTP ${response.status})`);
          }
        } catch {
          console.log(`\n  Gateway:  ${chalk.yellow('unreachable')}`);
        }
      }
    });

  // ─── logs ───────────────────────────────────────────────────────────
  command
    .command('logs')
    .description('Tail the daemon log file')
    .option('-n, --lines <n>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow the log output in real-time')
    .action(async (opts: { lines: string; follow?: boolean }) => {
      if (!existsSync(LOG_FILE)) {
        console.log(chalk.yellow('No log file found. Daemon may not have been started yet.'));
        console.log(chalk.dim(`Expected at: ${LOG_FILE}`));
        return;
      }

      const lines = parseInt(opts.lines, 10) || 50;

      // Read last N lines
      const content = readFileSync(LOG_FILE, 'utf-8');
      const allLines = content.split('\n');
      const tail = allLines.slice(-lines);
      console.log(tail.join('\n'));

      if (opts.follow) {
        console.log(chalk.dim('\n--- Following log output (Ctrl+C to stop) ---\n'));

        const { createReadStream } = await import('node:fs');
        const { stat } = await import('node:fs/promises');

        let lastSize = (await stat(LOG_FILE)).size;

        const interval = setInterval(async () => {
          try {
            const currentSize = (await stat(LOG_FILE)).size;
            if (currentSize > lastSize) {
              const stream = createReadStream(LOG_FILE, { start: lastSize });
              stream.on('data', (chunk: Buffer) => {
                process.stdout.write(chunk);
              });
              lastSize = currentSize;
            }
          } catch {
            // File may have been rotated
          }
        }, 500);

        // Keep alive
        process.on('SIGINT', () => {
          clearInterval(interval);
          process.exit(0);
        });

        // Block until SIGINT
        await new Promise(() => {});
      }
    });

  return command;
}

// ---------------------------------------------------------------------------
// PID file helpers
// ---------------------------------------------------------------------------

function ensureDirectories(): void {
  const dirs = [HYDRACLAW_DIR, resolve(HYDRACLAW_DIR, 'logs')];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

function readPid(): number | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const content = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  writeFileSync(PID_FILE, String(pid), 'utf-8');
}

function removePidFile(): void {
  try {
    const { unlinkSync } = require('node:fs') as typeof import('node:fs');
    unlinkSync(PID_FILE);
  } catch {
    // Ignore
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 just checks existence
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessRunning(pid)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}
