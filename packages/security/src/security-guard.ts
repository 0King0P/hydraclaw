import type { ToolCall, Logger, MessageBus } from '@hydraclaw/core';
import { Events } from '@hydraclaw/core';
import type { SecurityVerdict } from './types.js';
import type { SecurityConfig } from './config.js';
import { DEFAULT_SECURITY_CONFIG } from './config.js';
import { PromptInjectionDetector } from './injection/detector.js';
import { ToolPolicyEngine } from './policy/engine.js';
import { AuditLogger } from './audit/logger.js';

export class SecurityGuard {
  private config: SecurityConfig;
  private injectionDetector: PromptInjectionDetector | null = null;
  private policyEngine: ToolPolicyEngine | null = null;
  private auditLogger: AuditLogger | null = null;
  private logger: Logger;
  private bus: MessageBus;

  constructor(config: Partial<SecurityConfig>, logger: Logger, bus: MessageBus) {
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config } as SecurityConfig;
    this.logger = logger.child({ module: 'security' });
    this.bus = bus;
  }

  async init(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Security guard is disabled');
      return;
    }

    this.logger.info('Initializing security guard...');

    if (this.config.promptInjection?.enabled) {
      this.injectionDetector = new PromptInjectionDetector(
        this.config.promptInjection.customPatterns,
      );
      this.logger.info(`Prompt injection detection: ON (action=${this.config.promptInjection.action})`);
    }

    if (this.config.toolPolicies && Object.keys(this.config.toolPolicies).length > 0) {
      this.policyEngine = new ToolPolicyEngine(this.config.toolPolicies);
      this.logger.info('Tool policy engine: ON');
    }

    if (this.config.audit?.enabled) {
      this.auditLogger = new AuditLogger(this.config.audit.logFile);
      await this.auditLogger.init();
      this.logger.info(`Audit logging: ON (file=${this.config.audit.logFile})`);
    }

    this.registerBusListeners();
    this.logger.info('Security guard initialized');
  }

  getToolExecutionGuard(): ((call: ToolCall) => Promise<{ action: 'allow' | 'warn' | 'block'; reason?: string }>) | null {
    if (!this.config.enabled) return null;

    return async (call: ToolCall) => {
      return this.validateToolCall(call);
    };
  }

  async validateToolCall(call: ToolCall): Promise<SecurityVerdict> {
    // 1. Check tool policies
    if (this.policyEngine) {
      const policyResult = this.policyEngine.validate(call);
      if (policyResult.action === 'block') {
        this.logger.warn(`Tool call BLOCKED: ${call.name} - ${policyResult.reason}`);
        if (this.auditLogger) {
          await this.auditLogger.logToolCallBlocked(call.name, policyResult.reason ?? '', call.arguments);
        }
        return policyResult;
      }
    }

    // 2. Check for injection patterns in tool arguments
    if (this.injectionDetector) {
      const argsStr = JSON.stringify(call.arguments);
      const injectionResult = this.injectionDetector.scan(argsStr, 'tool_call');
      if (!injectionResult.safe) {
        const reason = injectionResult.detections.map(d => d.description).join('; ');

        if (this.config.promptInjection.action === 'block') {
          this.logger.warn(`Tool call BLOCKED (injection): ${call.name} - ${reason}`);
          if (this.auditLogger) {
            await this.auditLogger.logToolCallBlocked(call.name, reason, call.arguments);
          }
          return {
            action: 'block',
            reason,
            detections: injectionResult.detections,
          };
        }

        // Warn mode
        this.logger.warn(`Tool call WARNING (injection): ${call.name} - ${reason}`);
        if (this.auditLogger) {
          await this.auditLogger.logToolCallWarned(call.name, reason, call.arguments);
        }
        return { action: 'warn', reason, detections: injectionResult.detections };
      }
    }

    return { action: 'allow' };
  }

  private registerBusListeners(): void {
    if (!this.injectionDetector) return;

    // Scan inbound messages
    this.bus.on(Events.MESSAGE_INBOUND, async (...args: unknown[]) => {
      const message = args[0] as { content?: string; senderId?: string };
      if (!message?.content) return;

      const result = this.injectionDetector!.scanMessage(message.content);
      if (!result.safe) {
        const patterns = result.detections.map(d => d.matchedPattern).join(', ');
        this.logger.warn(`Injection detected in message from ${message.senderId}: ${patterns}`);
        if (this.auditLogger) {
          await this.auditLogger.logInjectionDetected(`user_message:${message.senderId}`, result.detections);
        }
      }
    });

    // Scan tool results
    this.bus.on(Events.TOOL_RESULT, async (...args: unknown[]) => {
      const toolResult = args[0] as { content?: string; toolCallId?: string };
      if (!toolResult?.content) return;

      const result = this.injectionDetector!.scanToolResult(toolResult.content);
      if (!result.safe) {
        const patterns = result.detections.map(d => d.matchedPattern).join(', ');
        this.logger.warn(`Injection detected in tool result ${toolResult.toolCallId}: ${patterns}`);
        if (this.auditLogger) {
          await this.auditLogger.logInjectionDetected(`tool_result:${toolResult.toolCallId}`, result.detections);
        }
      }
    });
  }
}
