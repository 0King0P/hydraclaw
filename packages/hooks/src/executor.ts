import type { HookContext, HookEvent, HookPhase, HookResult } from './types.js';
import type { HookRegistry } from './registry.js';

export interface HookExecutorOptions {
  /** Default timeout in milliseconds for individual hooks. Defaults to 5000. */
  timeoutMs?: number;
  /** Logger function for errors and warnings. Defaults to console.warn. */
  onError?: (hookId: string, error: unknown) => void;
}

/**
 * HookExecutor - Executes registered hooks in priority order.
 *
 * For 'before' hooks, execution stops if any hook returns proceed: false.
 * For 'after' hooks, all hooks run regardless of individual results.
 * Errors in individual hooks are caught and logged, never propagated.
 * Hooks that exceed the configured timeout are skipped.
 */
export class HookExecutor {
  private registry: HookRegistry;
  private timeoutMs: number;
  private onError: (hookId: string, error: unknown) => void;

  constructor(registry: HookRegistry, options?: HookExecutorOptions) {
    this.registry = registry;
    this.timeoutMs = options?.timeoutMs ?? 5000;
    this.onError = options?.onError ?? ((hookId, error) => {
      console.warn(`Hook "${hookId}" failed:`, error);
    });
  }

  /**
   * Execute all 'before' hooks for the given event.
   * Returns the final accumulated data, or an abort result if any hook returns proceed: false.
   */
  async executeBefore(
    event: HookEvent,
    data: Record<string, unknown>,
  ): Promise<HookResult> {
    return this.execute(event, 'before', data);
  }

  /**
   * Execute all 'after' hooks for the given event.
   * All hooks run regardless of individual results.
   */
  async executeAfter(
    event: HookEvent,
    data: Record<string, unknown>,
  ): Promise<HookResult> {
    return this.execute(event, 'after', data);
  }

  /**
   * Generic hook execution for any event and phase.
   *
   * Hooks are executed in priority order (lower = first).
   * Each hook receives the accumulated data from previous hooks.
   *
   * For 'before' phase: stops on first proceed: false.
   * For 'after' phase: always runs all hooks.
   */
  async execute(
    event: HookEvent,
    phase: HookPhase,
    data: Record<string, unknown>,
  ): Promise<HookResult> {
    const hooks = this.registry.getHooks(event, phase);
    let currentData = { ...data };

    for (const hook of hooks) {
      const context: HookContext = {
        event,
        phase,
        data: { ...currentData },
        metadata: {
          timestamp: Date.now(),
          hookId: hook.id,
        },
      };

      try {
        const result = await this.executeWithTimeout(hook.id, hook.handler(context));

        if (result.data) {
          currentData = { ...currentData, ...result.data };
        }

        if (phase === 'before' && !result.proceed) {
          return {
            proceed: false,
            data: currentData,
            reason: result.reason ?? `Blocked by hook: ${hook.id}`,
          };
        }
      } catch (error) {
        this.onError(hook.id, error);
        // Continue execution - hooks should not crash the system
      }
    }

    return {
      proceed: true,
      data: currentData,
    };
  }

  private async executeWithTimeout<T>(hookId: string, promise: Promise<T>): Promise<T> {
    if (this.timeoutMs <= 0) {
      return promise;
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Hook "${hookId}" timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
