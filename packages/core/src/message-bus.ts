import { EventEmitter } from 'node:events';

export type EventHandler = (...args: unknown[]) => void | Promise<void>;

export class MessageBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  on(event: string, handler: EventHandler): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  once(event: string, handler: EventHandler): void {
    this.emitter.once(event, handler as (...args: unknown[]) => void);
  }

  off(event: string, handler: EventHandler): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  async emit(event: string, ...args: unknown[]): Promise<void> {
    const listeners = this.emitter.listeners(event);
    for (const listener of listeners) {
      await (listener as EventHandler)(...args);
    }
  }

  emitSync(event: string, ...args: unknown[]): void {
    this.emitter.emit(event, ...args);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  listenerCount(event: string): number {
    return this.emitter.listenerCount(event);
  }
}

// Standard event names
export const Events = {
  // Message events
  MESSAGE_INBOUND: 'message:inbound',
  MESSAGE_OUTBOUND: 'message:outbound',
  MESSAGE_ROUTED: 'message:routed',

  // Agent events
  AGENT_START: 'agent:start',
  AGENT_STREAM: 'agent:stream',
  AGENT_COMPLETE: 'agent:complete',
  AGENT_ERROR: 'agent:error',

  // Tool events
  TOOL_CALL: 'tool:call',
  TOOL_RESULT: 'tool:result',

  // Provider events
  PROVIDER_FAILOVER: 'provider:failover',
  PROVIDER_ERROR: 'provider:error',

  // Channel events
  CHANNEL_CONNECTED: 'channel:connected',
  CHANNEL_DISCONNECTED: 'channel:disconnected',

  // Gateway events
  GATEWAY_READY: 'gateway:ready',
  GATEWAY_SHUTDOWN: 'gateway:shutdown',

  // Config events
  CONFIG_RELOAD: 'config:reload',
  CONFIG_CHANGED: 'config:changed',

  // Session events
  SESSION_CREATE: 'session:create',
  SESSION_DESTROY: 'session:destroy',

  // Memory events
  MEMORY_STORED: 'memory:stored',
  MEMORY_RECALLED: 'memory:recalled',

  // Skill events
  SKILL_LOADED: 'skill:loaded',
  SKILL_UNLOADED: 'skill:unloaded',
  SKILL_TRIGGERED: 'skill:triggered',

  // Extension events
  EXTENSION_LOADED: 'extension:loaded',
  EXTENSION_UNLOADED: 'extension:unloaded',

  // Hook events
  HOOK_BEFORE: 'hook:before',
  HOOK_AFTER: 'hook:after',

  // Cron events
  CRON_JOB_RUN: 'cron:job:run',
  CRON_JOB_COMPLETE: 'cron:job:complete',

  // Node/pairing events
  NODE_PAIRED: 'node:paired',
  NODE_UNPAIRED: 'node:unpaired',
  NODE_HEARTBEAT: 'node:heartbeat',

  // Daemon events
  DAEMON_START: 'daemon:start',
  DAEMON_STOP: 'daemon:stop',
  DAEMON_HEALTH: 'daemon:health',

  // Voice events
  VOICE_TTS: 'voice:tts',
  VOICE_STT: 'voice:stt',

  // Broadcast events
  BROADCAST_SEND: 'broadcast:send',
  BROADCAST_COMPLETE: 'broadcast:complete',
} as const;
