import type { MessageBus } from '../message-bus.js';
import type { Logger } from '../logger.js';
import type { Container } from '../container.js';

export type PluginType = 'provider' | 'channel' | 'tool';

export interface Plugin {
  id: string;
  name: string;
  version: string;
  type: PluginType;
  init(ctx: PluginContext): Promise<void>;
  destroy?(): Promise<void>;
}

export interface PluginContext {
  config: Record<string, unknown>;
  logger: Logger;
  bus: MessageBus;
  container: Container;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  type: PluginType;
  description?: string;
  configSchema?: Record<string, unknown>;
}

export interface PluginRegistry {
  providers: Map<string, Plugin>;
  channels: Map<string, Plugin>;
  tools: Map<string, Plugin>;
  all(): Plugin[];
  get(id: string): Plugin | undefined;
  register(plugin: Plugin): void;
  unregister(id: string): void;
}
