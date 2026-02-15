import type { Logger, MessageBus } from '@hydraclaw/core';

export type ExtensionType = 'channel' | 'provider' | 'integration' | 'auth' | 'storage' | 'voice';

export interface Extension {
  id: string;
  name: string;
  description: string;
  version: string;
  type: ExtensionType;
  init(context: ExtensionContext): Promise<void>;
  destroy?(): Promise<void>;
}

export interface ExtensionContext {
  config: Record<string, unknown>;
  logger: Logger;
  bus: MessageBus;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  type: ExtensionType;
  configSchema?: Record<string, unknown>;
  dependencies?: string[];
}

export interface ExtensionRegistry {
  register(ext: Extension): void;
  unregister(id: string): void;
  get(id: string): Extension | undefined;
  getAll(): Extension[];
  getByType(type: ExtensionType): Extension[];
}
