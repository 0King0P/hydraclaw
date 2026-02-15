import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_PID_PATH = resolve(homedir(), '.hydraclaw', 'daemon.pid');

/**
 * Write a PID to the daemon PID file.
 *
 * Creates the parent directory if it does not already exist.
 */
export function writePid(pid: number, pidPath: string = DEFAULT_PID_PATH): void {
  const dir = dirname(pidPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(pidPath, String(pid), 'utf-8');
}

/**
 * Read the PID from the daemon PID file.
 *
 * Returns `null` if the file does not exist or cannot be parsed.
 */
export function readPid(pidPath: string = DEFAULT_PID_PATH): number | null {
  if (!existsSync(pidPath)) {
    return null;
  }

  try {
    const content = readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    if (isNaN(pid) || pid <= 0) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

/**
 * Remove the daemon PID file.
 *
 * No-op if the file does not exist.
 */
export function removePid(pidPath: string = DEFAULT_PID_PATH): void {
  if (existsSync(pidPath)) {
    try {
      unlinkSync(pidPath);
    } catch {
      // Swallow errors during cleanup -- the file may have already been removed.
    }
  }
}

/**
 * Check whether a given PID corresponds to a currently running process.
 *
 * Uses `process.kill(pid, 0)` which sends signal 0 (no actual signal) to
 * test for process existence without affecting it.
 */
export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // ESRCH means "no such process" -- the PID is not running.
    // EPERM means the process exists but we lack permission to signal it -- still running.
    if (err instanceof Error && 'code' in err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
    return false;
  }
}
