import type { HookDefinition, HookContext, HookResult } from './types.js';

/**
 * Create a logging hook that logs all events to the console.
 * Useful for debugging and monitoring the lifecycle pipeline.
 */
export function createLoggingHook(id: string = 'builtin:logging'): HookDefinition {
  return {
    id,
    event: 'message:receive',
    phase: 'before',
    priority: 0,
    enabled: true,
    handler: async (context: HookContext): Promise<HookResult> => {
      const { event, phase, metadata } = context;
      console.log(
        `[Hook:${id}] ${phase}:${event} at ${new Date(metadata.timestamp).toISOString()}`,
        JSON.stringify(context.data, null, 2),
      );
      return { proceed: true };
    },
  };
}

/**
 * Create a rate-limiting hook that restricts messages per sender per minute.
 * Only applies to 'message:receive' before hooks.
 */
export function createRateLimitHook(
  maxPerMinute: number,
  id: string = 'builtin:rate-limit',
): HookDefinition {
  const senderCounts: Map<string, { count: number; windowStart: number }> = new Map();

  return {
    id,
    event: 'message:receive',
    phase: 'before',
    priority: 10,
    enabled: true,
    handler: async (context: HookContext): Promise<HookResult> => {
      const senderId = context.data.senderId as string | undefined;
      if (!senderId) {
        return { proceed: true };
      }

      const now = Date.now();
      const windowMs = 60_000;
      let entry = senderCounts.get(senderId);

      if (!entry || now - entry.windowStart >= windowMs) {
        entry = { count: 0, windowStart: now };
        senderCounts.set(senderId, entry);
      }

      entry.count++;

      if (entry.count > maxPerMinute) {
        return {
          proceed: false,
          reason: `Rate limit exceeded for sender "${senderId}": ${entry.count}/${maxPerMinute} per minute`,
        };
      }

      return { proceed: true };
    },
  };
}

/**
 * Create a content filter hook that blocks messages matching any of the given patterns.
 * Patterns are compiled as case-insensitive regular expressions.
 */
export function createContentFilterHook(
  patterns: string[],
  id: string = 'builtin:content-filter',
): HookDefinition {
  const compiledPatterns = patterns.map((p) => new RegExp(p, 'i'));

  return {
    id,
    event: 'message:receive',
    phase: 'before',
    priority: 20,
    enabled: true,
    handler: async (context: HookContext): Promise<HookResult> => {
      const content = context.data.content as string | undefined;
      if (!content) {
        return { proceed: true };
      }

      for (const regex of compiledPatterns) {
        if (regex.test(content)) {
          return {
            proceed: false,
            reason: `Content blocked by filter pattern: ${regex.source}`,
          };
        }
      }

      return { proceed: true };
    },
  };
}

/**
 * Create an auto-response hook that replies to specific trigger patterns.
 * Each trigger maps a regex pattern to a response string.
 * The hook modifies the context data to include an `autoResponse` field.
 */
export function createAutoResponseHook(
  triggers: Array<{ pattern: string; response: string }>,
  id: string = 'builtin:auto-response',
): HookDefinition {
  const compiledTriggers = triggers.map((t) => ({
    regex: new RegExp(t.pattern, 'i'),
    response: t.response,
  }));

  return {
    id,
    event: 'message:receive',
    phase: 'after',
    priority: 100,
    enabled: true,
    handler: async (context: HookContext): Promise<HookResult> => {
      const content = context.data.content as string | undefined;
      if (!content) {
        return { proceed: true };
      }

      for (const trigger of compiledTriggers) {
        if (trigger.regex.test(content)) {
          return {
            proceed: true,
            data: {
              autoResponse: trigger.response,
            },
          };
        }
      }

      return { proceed: true };
    },
  };
}
