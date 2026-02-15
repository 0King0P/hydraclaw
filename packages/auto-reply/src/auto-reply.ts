/**
 * Auto-reply engine that evaluates inbound messages against a set of
 * configurable rules and produces responses when matches are found.
 */

import type { InboundMessage } from '@hydraclaw/core';
import type {
  AutoReplyRule,
  AutoReplyCondition,
  AutoReplyResponse,
} from './types.js';
import { renderTemplate } from './templates.js';

/** Cooldown tracking key: senderId + ruleId */
type CooldownKey = string;

/** Daily usage tracking key: senderId + ruleId + dateString */
type DailyKey = string;

export interface AutoReplyResult {
  ruleId: string;
  ruleName: string;
  response: string;
}

/**
 * Core auto-reply engine. Add rules, then call `processMessage()` for
 * each inbound message to check for matches and generate responses.
 */
export class AutoReplyEngine {
  private rules = new Map<string, AutoReplyRule>();
  private cooldowns = new Map<CooldownKey, number>();
  private dailyCounts = new Map<DailyKey, number>();

  /**
   * Add or update an auto-reply rule.
   */
  addRule(rule: AutoReplyRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Remove a rule by ID.
   */
  removeRule(id: string): void {
    this.rules.delete(id);
  }

  /**
   * Get all registered rules.
   */
  getRules(): AutoReplyRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Enable a rule by ID.
   */
  enable(id: string): void {
    const rule = this.rules.get(id);
    if (rule) {
      rule.enabled = true;
    }
  }

  /**
   * Disable a rule by ID.
   */
  disable(id: string): void {
    const rule = this.rules.get(id);
    if (rule) {
      rule.enabled = false;
    }
  }

  /**
   * Process an inbound message against all enabled rules.
   * Returns the first matching rule's response, or `undefined` if none match.
   */
  processMessage(message: InboundMessage): AutoReplyResult | undefined {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      if (!this.matchesTrigger(rule, message)) continue;
      if (!this.matchesConditions(rule, message)) continue;
      if (this.isOnCooldown(message.senderId, rule.id)) continue;
      if (this.isOverDailyLimit(message.senderId, rule)) continue;

      // Record usage
      this.recordCooldown(message.senderId, rule);
      this.recordDailyUse(message.senderId, rule.id);

      const response = this.buildResponse(rule.response, message);
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        response,
      };
    }

    return undefined;
  }

  /**
   * Check whether a sender is currently on cooldown for a specific rule.
   */
  isOnCooldown(senderId: string, ruleId: string): boolean {
    const key: CooldownKey = `${senderId}:${ruleId}`;
    const expiresAt = this.cooldowns.get(key);
    if (expiresAt === undefined) return false;
    if (Date.now() < expiresAt) return true;
    this.cooldowns.delete(key);
    return false;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private matchesTrigger(rule: AutoReplyRule, message: InboundMessage): boolean {
    const trigger = rule.trigger;
    const content = trigger.caseSensitive ? message.content : message.content.toLowerCase();
    const pattern = trigger.caseSensitive
      ? (trigger.pattern ?? '')
      : (trigger.pattern ?? '').toLowerCase();

    switch (trigger.type) {
      case 'any':
        return true;

      case 'exact':
        return content === pattern;

      case 'keyword':
        return content.includes(pattern);

      case 'regex': {
        try {
          const flags = trigger.caseSensitive ? '' : 'i';
          const regex = new RegExp(trigger.pattern ?? '', flags);
          return regex.test(message.content);
        } catch {
          return false;
        }
      }

      default:
        return false;
    }
  }

  private matchesConditions(rule: AutoReplyRule, message: InboundMessage): boolean {
    if (!rule.conditions || rule.conditions.length === 0) return true;

    return rule.conditions.every((condition) => this.evaluateCondition(condition, message));
  }

  private evaluateCondition(condition: AutoReplyCondition, message: InboundMessage): boolean {
    const fieldValue = this.getFieldValue(condition.field, message);

    switch (condition.operator) {
      case 'equals':
        return fieldValue === condition.value;

      case 'contains':
        return typeof fieldValue === 'string' &&
          typeof condition.value === 'string' &&
          fieldValue.includes(condition.value);

      case 'matches': {
        if (typeof fieldValue !== 'string' || typeof condition.value !== 'string') return false;
        try {
          return new RegExp(condition.value).test(fieldValue);
        } catch {
          return false;
        }
      }

      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(fieldValue);

      case 'between': {
        if (!Array.isArray(condition.value) || condition.value.length !== 2) return false;
        const [low, high] = condition.value as [unknown, unknown];
        if (typeof fieldValue === 'number' && typeof low === 'number' && typeof high === 'number') {
          return fieldValue >= low && fieldValue <= high;
        }
        if (typeof fieldValue === 'string' && typeof low === 'string' && typeof high === 'string') {
          return fieldValue >= low && fieldValue <= high;
        }
        return false;
      }

      default:
        return false;
    }
  }

  private getFieldValue(field: AutoReplyCondition['field'], message: InboundMessage): unknown {
    switch (field) {
      case 'channelId':
        return message.channelId;
      case 'senderId':
        return message.senderId;
      case 'groupId':
        return message.groupId;
      case 'isGroup':
        return message.isGroup;
      case 'time': {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
      }
      default:
        return undefined;
    }
  }

  private recordCooldown(senderId: string, rule: AutoReplyRule): void {
    if (!rule.cooldown || rule.cooldown <= 0) return;
    const key: CooldownKey = `${senderId}:${rule.id}`;
    this.cooldowns.set(key, Date.now() + rule.cooldown);
  }

  private isOverDailyLimit(senderId: string, rule: AutoReplyRule): boolean {
    if (!rule.maxPerDay || rule.maxPerDay <= 0) return false;
    const key = this.dailyKey(senderId, rule.id);
    const count = this.dailyCounts.get(key) ?? 0;
    return count >= rule.maxPerDay;
  }

  private recordDailyUse(senderId: string, ruleId: string): void {
    const key = this.dailyKey(senderId, ruleId);
    const count = this.dailyCounts.get(key) ?? 0;
    this.dailyCounts.set(key, count + 1);
  }

  private dailyKey(senderId: string, ruleId: string): DailyKey {
    const dateStr = new Date().toISOString().slice(0, 10);
    return `${senderId}:${ruleId}:${dateStr}`;
  }

  private buildResponse(response: AutoReplyResponse, message: InboundMessage): string {
    switch (response.type) {
      case 'static':
        return response.content ?? '';

      case 'template':
        return renderTemplate(response.template ?? '', {
          sender: message.senderName ?? message.senderId,
          channel: message.channelId,
          message: message.content,
        });

      case 'ai':
        // AI-generated responses need to be handled by the caller
        // Return the prompt so the caller can pass it to the AI provider
        return response.aiPrompt ?? '';

      default:
        return '';
    }
  }
}
