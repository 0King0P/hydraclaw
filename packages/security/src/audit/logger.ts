import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditEvent } from '../types.js';

export class AuditLogger {
  private logFile: string;
  private initialized = false;

  constructor(logFile: string) {
    this.logFile = logFile;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.logFile), { recursive: true });
    this.initialized = true;
  }

  async log(event: AuditEvent): Promise<void> {
    if (!this.initialized) await this.init();

    const line = JSON.stringify({
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    }) + '\n';

    await appendFile(this.logFile, line, 'utf-8');
  }

  async logToolCallBlocked(toolName: string, reason: string, callArgs: Record<string, unknown>): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      type: 'tool_call_blocked',
      details: { toolName, reason, arguments: callArgs },
    });
  }

  async logToolCallWarned(toolName: string, reason: string, callArgs: Record<string, unknown>): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      type: 'tool_call_warned',
      details: { toolName, reason, arguments: callArgs },
    });
  }

  async logInjectionDetected(source: string, detections: unknown[]): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      type: 'injection_detected',
      details: { source, detections },
    });
  }
}
