import { watch, existsSync, readFileSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger, MessageBus, HydraClawConfig } from '@hydraclaw/core';
import { loadConfig } from '@hydraclaw/core';

/**
 * Configuration for the ConfigReloader.
 */
export interface ConfigReloaderOptions {
  /** Debounce interval in milliseconds. Defaults to 1000. */
  debounceMs?: number;
  /** Callback invoked after a successful reload with the new config. */
  onReload?: (config: HydraClawConfig) => void;
  /** Callback invoked when a reload fails. */
  onError?: (error: Error) => void;
}

/**
 * Watches a configuration file and triggers a reload when changes are
 * detected.
 *
 * - Uses `fs.watch` for file-system notifications
 * - Debounces rapid successive changes to avoid cascading reloads
 * - Emits `config:reloaded` on the message bus after a successful reload
 * - Emits `config:reload-error` on failure
 */
export class ConfigReloader {
  private logger: Logger;
  private bus: MessageBus;
  private options: Required<ConfigReloaderOptions>;

  private watcher: FSWatcher | null = null;
  private configPath: string | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastConfig: HydraClawConfig | null = null;
  private reloadCount = 0;

  constructor(logger: Logger, bus: MessageBus, options?: ConfigReloaderOptions) {
    this.logger = logger;
    this.bus = bus;
    this.options = {
      debounceMs: options?.debounceMs ?? 1000,
      onReload: options?.onReload ?? (() => {}),
      onError: options?.onError ?? (() => {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start watching the given config file for changes.
   *
   * @param configPath  Absolute or relative path to the YAML config file.
   * @throws If the file does not exist or a watcher is already active.
   */
  watch(configPath: string): void {
    const absolutePath = resolve(configPath);

    if (!existsSync(absolutePath)) {
      throw new Error(`Config file does not exist: ${absolutePath}`);
    }

    if (this.watcher) {
      this.logger.warn('ConfigReloader already watching – stopping previous watcher');
      this.stop();
    }

    this.configPath = absolutePath;

    // Load initial config so we can detect actual content changes
    try {
      this.lastConfig = loadConfig(absolutePath);
    } catch {
      // Non-fatal – we will still watch for future valid configs
    }

    this.watcher = watch(absolutePath, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') {
        this.scheduleReload();
      }
    });

    this.logger.info(`Watching config file for changes: ${absolutePath}`);
  }

  /**
   * Manually trigger a config reload. Useful for programmatic reload via an
   * API endpoint or CLI command.
   */
  reload(): HydraClawConfig | null {
    if (!this.configPath) {
      this.logger.warn('Cannot reload: no config path set (call watch() first)');
      return null;
    }

    return this.performReload();
  }

  /**
   * Stop watching the config file and clean up resources.
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.logger.info('Stopped watching config file');
    }

    this.configPath = null;
  }

  /**
   * Whether the reloader is currently watching a file.
   */
  get isWatching(): boolean {
    return this.watcher !== null;
  }

  /**
   * The number of successful reloads that have occurred.
   */
  get totalReloads(): number {
    return this.reloadCount;
  }

  /**
   * The last successfully loaded config, or `null` if none.
   */
  get currentConfig(): HydraClawConfig | null {
    return this.lastConfig;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Schedule a debounced reload. Multiple rapid file-change events will
   * collapse into a single reload after the debounce window.
   */
  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.performReload();
    }, this.options.debounceMs);
  }

  /**
   * Execute the actual reload and notify listeners.
   */
  private performReload(): HydraClawConfig | null {
    if (!this.configPath) return null;

    try {
      // Verify the file still exists (could be a rename/delete event)
      if (!existsSync(this.configPath)) {
        this.logger.warn(`Config file disappeared: ${this.configPath}`);
        return null;
      }

      // Quick sanity check – make sure the file is not empty
      const raw = readFileSync(this.configPath, 'utf-8');
      if (raw.trim().length === 0) {
        this.logger.warn('Config file is empty, skipping reload');
        return null;
      }

      const newConfig = loadConfig(this.configPath);

      // Check whether the config has actually changed
      const oldJson = this.lastConfig ? JSON.stringify(this.lastConfig) : '';
      const newJson = JSON.stringify(newConfig);
      if (oldJson === newJson) {
        this.logger.debug('Config file changed on disk but content is identical, skipping reload');
        return this.lastConfig;
      }

      this.lastConfig = newConfig;
      this.reloadCount++;

      this.logger.info(`Config reloaded (reload #${this.reloadCount})`);
      this.bus.emitSync('config:reloaded', { config: newConfig, reloadCount: this.reloadCount });
      this.options.onReload(newConfig);

      return newConfig;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`Config reload failed: ${error.message}`);
      this.bus.emitSync('config:reload-error', { error: error.message });
      this.options.onError(error);
      return null;
    }
  }
}
