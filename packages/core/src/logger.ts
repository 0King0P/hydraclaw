import pino from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface Logger {
  trace(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  fatal(msg: string, ...args: unknown[]): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(opts?: { level?: LogLevel; name?: string; pretty?: boolean }): Logger {
  const level = opts?.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info';
  const transport = opts?.pretty !== false
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined;

  const logger = pino({
    name: opts?.name ?? 'hydraclaw',
    level,
    transport,
  });

  return logger as unknown as Logger;
}
