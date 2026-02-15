import type { HookDefinition, HookEvent, HookPhase } from './types.js';

/**
 * HookRegistry - Manages registration and retrieval of lifecycle hooks.
 *
 * Hooks are organized by event and phase, and sorted by priority
 * (lower number = higher priority = executed first).
 */
export class HookRegistry {
  private hooks: Map<string, HookDefinition> = new Map();

  /**
   * Register a hook. If a hook with the same ID already exists, it is replaced.
   */
  register(hook: HookDefinition): void {
    this.hooks.set(hook.id, hook);
  }

  /**
   * Remove a hook by its ID.
   * Returns true if the hook was found and removed.
   */
  unregister(id: string): boolean {
    return this.hooks.delete(id);
  }

  /**
   * Get all hooks matching the given event and phase, sorted by priority (ascending).
   * Only returns enabled hooks.
   */
  getHooks(event: HookEvent, phase: HookPhase): HookDefinition[] {
    const matching: HookDefinition[] = [];

    for (const hook of this.hooks.values()) {
      if (hook.event === event && hook.phase === phase && hook.enabled) {
        matching.push(hook);
      }
    }

    return matching.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Enable a hook by ID. Returns true if the hook was found.
   */
  enable(id: string): boolean {
    const hook = this.hooks.get(id);
    if (hook) {
      hook.enabled = true;
      return true;
    }
    return false;
  }

  /**
   * Disable a hook by ID. Returns true if the hook was found.
   */
  disable(id: string): boolean {
    const hook = this.hooks.get(id);
    if (hook) {
      hook.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * Remove all hooks.
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * Get a specific hook by ID.
   */
  get(id: string): HookDefinition | undefined {
    return this.hooks.get(id);
  }

  /**
   * Get the number of registered hooks.
   */
  get size(): number {
    return this.hooks.size;
  }

  /**
   * Get all registered hook IDs.
   */
  getIds(): string[] {
    return [...this.hooks.keys()];
  }
}
