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
  MESSAGE_INBOUND: 'message:inbound',
  MESSAGE_OUTBOUND: 'message:outbound',
  AGENT_START: 'agent:start',
  AGENT_STREAM: 'agent:stream',
  AGENT_COMPLETE: 'agent:complete',
  AGENT_ERROR: 'agent:error',
  TOOL_CALL: 'tool:call',
  TOOL_RESULT: 'tool:result',
  PROVIDER_FAILOVER: 'provider:failover',
  CHANNEL_CONNECTED: 'channel:connected',
  CHANNEL_DISCONNECTED: 'channel:disconnected',
  GATEWAY_READY: 'gateway:ready',
  GATEWAY_SHUTDOWN: 'gateway:shutdown',
} as const;
