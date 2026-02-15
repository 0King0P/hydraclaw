import type { Extension, ExtensionContext } from '@hydraclaw/extensions';

interface MemoryEntry {
  key: string;
  value: unknown;
  namespace: string;
  createdAt: number;
  updatedAt: number;
  ttl?: number; // time-to-live in milliseconds
  tags?: string[];
}

/**
 * Memory Core Extension
 *
 * Provides core memory management for HydraClaw, enabling persistent
 * key-value storage with namespace isolation, TTL support, and tag-based
 * retrieval. This extension backs conversation memory, user preferences,
 * and cross-session state.
 */
class MemoryCoreExtension implements Extension {
  id = 'memory-core';
  name = 'Memory Core';
  description = 'Core memory management for persistent key-value storage with namespaces, TTL, and tag-based retrieval';
  version = '1.0.0';
  type = 'storage' as const;

  private store = new Map<string, MemoryEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private ctx: ExtensionContext | null = null;

  async init(context: ExtensionContext): Promise<void> {
    this.ctx = context;
    const cleanupIntervalMs = (context.config.cleanupIntervalMs as number) ?? 60000;

    context.logger.info('Memory Core extension initializing');

    // Start periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);

    // Listen for memory operations on the message bus
    context.bus.on('memory:set', async (...args: unknown[]) => {
      const [namespace, key, value, ttl] = args as [string, string, unknown, number?];
      this.set(namespace, key, value, ttl);
    });

    context.bus.on('memory:get', async (...args: unknown[]) => {
      const [namespace, key, callback] = args as [string, string, (val: unknown) => void];
      const entry = this.get(namespace, key);
      callback(entry?.value ?? null);
    });

    context.bus.on('memory:delete', async (...args: unknown[]) => {
      const [namespace, key] = args as [string, string];
      this.delete(namespace, key);
    });

    context.logger.info(`Memory Core initialized (cleanup every ${cleanupIntervalMs}ms)`);
  }

  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
    this.ctx?.logger.info('Memory Core destroyed');
  }

  set(namespace: string, key: string, value: unknown, ttl?: number, tags?: string[]): void {
    const compositeKey = `${namespace}:${key}`;
    const now = Date.now();

    const existing = this.store.get(compositeKey);
    this.store.set(compositeKey, {
      key,
      value,
      namespace,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ttl,
      tags,
    });
  }

  get(namespace: string, key: string): MemoryEntry | null {
    const compositeKey = `${namespace}:${key}`;
    const entry = this.store.get(compositeKey);

    if (!entry) return null;

    // Check TTL expiration
    if (entry.ttl && Date.now() - entry.updatedAt > entry.ttl) {
      this.store.delete(compositeKey);
      return null;
    }

    return entry;
  }

  delete(namespace: string, key: string): boolean {
    return this.store.delete(`${namespace}:${key}`);
  }

  getByNamespace(namespace: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    for (const entry of this.store.values()) {
      if (entry.namespace === namespace) {
        if (!entry.ttl || Date.now() - entry.updatedAt <= entry.ttl) {
          entries.push(entry);
        }
      }
    }
    return entries;
  }

  getByTag(tag: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    for (const entry of this.store.values()) {
      if (entry.tags?.includes(tag)) {
        if (!entry.ttl || Date.now() - entry.updatedAt <= entry.ttl) {
          entries.push(entry);
        }
      }
    }
    return entries;
  }

  clearNamespace(namespace: string): number {
    let count = 0;
    for (const [key, entry] of this.store) {
      if (entry.namespace === namespace) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  stats(): { totalEntries: number; namespaces: string[]; sizeEstimate: number } {
    const namespaces = new Set<string>();
    let sizeEstimate = 0;

    for (const entry of this.store.values()) {
      namespaces.add(entry.namespace);
      sizeEstimate += JSON.stringify(entry.value).length;
    }

    return {
      totalEntries: this.store.size,
      namespaces: Array.from(namespaces),
      sizeEstimate,
    };
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.store) {
      if (entry.ttl && now - entry.updatedAt > entry.ttl) {
        this.store.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.ctx?.logger.debug(`Memory cleanup: removed ${removed} expired entries`);
    }
  }
}

export default new MemoryCoreExtension();
