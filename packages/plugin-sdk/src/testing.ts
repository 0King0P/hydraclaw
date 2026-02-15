/**
 * Testing utilities for HydraClaw plugin developers.
 *
 * Provides mock implementations of core interfaces so plugins can be
 * unit-tested in isolation without spinning up the full runtime.
 */

import type {
  PluginContext,
  Logger,
  LogLevel,
  InboundMessage,
  ToolResult,
} from '@hydraclaw/core';
import { Container, MessageBus } from '@hydraclaw/core';

// ---------------------------------------------------------------------------
// Mock Logger
// ---------------------------------------------------------------------------

export interface LogEntry {
  level: LogLevel;
  message: string;
  args: unknown[];
  timestamp: number;
}

export interface MockLogger extends Logger {
  /** All captured log entries */
  entries: LogEntry[];
  /** Clear all captured entries */
  clear(): void;
  /** Get entries filtered by level */
  getByLevel(level: LogLevel): LogEntry[];
}

/**
 * Create a mock Logger that captures all log calls for assertions.
 */
export function createMockLogger(): MockLogger {
  const entries: LogEntry[] = [];

  function log(level: LogLevel) {
    return (msg: string, ...args: unknown[]) => {
      entries.push({ level, message: msg, args, timestamp: Date.now() });
    };
  }

  const logger: MockLogger = {
    entries,
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    fatal: log('fatal'),
    child(_bindings: Record<string, unknown>): Logger {
      // Return the same mock to keep captured entries centralized
      return logger;
    },
    clear() {
      entries.length = 0;
    },
    getByLevel(level: LogLevel) {
      return entries.filter((e) => e.level === level);
    },
  } as MockLogger;

  return logger;
}

// ---------------------------------------------------------------------------
// Mock MessageBus
// ---------------------------------------------------------------------------

export interface MockBus extends MessageBus {
  /** All events emitted through the bus, for assertions */
  emitted: Array<{ event: string; args: unknown[] }>;
  /** Clear emitted events */
  clear(): void;
}

/**
 * Create a mock MessageBus that records all emitted events.
 */
export function createMockBus(): MockBus {
  const bus = new MessageBus() as MockBus;
  const emitted: Array<{ event: string; args: unknown[] }> = [];
  bus.emitted = emitted;

  const originalEmit = bus.emit.bind(bus);
  bus.emit = async (event: string, ...args: unknown[]): Promise<void> => {
    emitted.push({ event, args });
    await originalEmit(event, ...args);
  };

  const originalEmitSync = bus.emitSync.bind(bus);
  bus.emitSync = (event: string, ...args: unknown[]): void => {
    emitted.push({ event, args });
    originalEmitSync(event, ...args);
  };

  bus.clear = () => {
    emitted.length = 0;
  };

  return bus;
}

// ---------------------------------------------------------------------------
// Mock Container
// ---------------------------------------------------------------------------

/**
 * Create a mock Container pre-seeded with any provided instances.
 */
export function createMockContainer(
  instances?: Record<string, unknown>,
): Container {
  const container = new Container();
  if (instances) {
    for (const [token, instance] of Object.entries(instances)) {
      container.registerInstance(token, instance);
    }
  }
  return container;
}

// ---------------------------------------------------------------------------
// Mock PluginContext
// ---------------------------------------------------------------------------

export interface MockPluginContext extends PluginContext {
  mockLogger: MockLogger;
  mockBus: MockBus;
}

/**
 * Create a complete mock PluginContext suitable for plugin init() testing.
 */
export function createMockContext(
  config?: Record<string, unknown>,
): MockPluginContext {
  const mockLogger = createMockLogger();
  const mockBus = createMockBus();
  const container = createMockContainer();

  return {
    logger: mockLogger,
    bus: mockBus,
    container,
    mockLogger,
    mockBus,
  } as unknown as MockPluginContext;
}

// ---------------------------------------------------------------------------
// Simulation Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate an inbound message arriving on a channel.
 * Emits 'message:inbound' on the provided bus.
 */
export async function simulateMessage(
  bus: MessageBus,
  channelId: string,
  content: string,
  overrides?: Partial<InboundMessage>,
): Promise<InboundMessage> {
  const message: InboundMessage = {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    channelId,
    senderId: 'test-sender',
    senderName: 'Test User',
    target: channelId,
    content,
    isGroup: false,
    timestamp: Date.now(),
    ...overrides,
  };

  await bus.emit('message:inbound', message);
  return message;
}

// ---------------------------------------------------------------------------
// Assertion Helpers
// ---------------------------------------------------------------------------

/**
 * Assert that a ToolResult matches expected values.
 * Throws an Error with a descriptive message if the assertion fails.
 */
export function assertToolResult(
  result: ToolResult,
  expected: Partial<ToolResult>,
): void {
  if (expected.toolCallId !== undefined && result.toolCallId !== expected.toolCallId) {
    throw new Error(
      `Expected toolCallId "${expected.toolCallId}", got "${result.toolCallId}"`,
    );
  }

  if (expected.content !== undefined && result.content !== expected.content) {
    throw new Error(
      `Expected content "${expected.content}", got "${result.content}"`,
    );
  }

  if (expected.isError !== undefined && result.isError !== expected.isError) {
    throw new Error(
      `Expected isError=${String(expected.isError)}, got isError=${String(result.isError)}`,
    );
  }
}
