import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Logger, MessageBus } from '@hydraclaw/core';
import type { Extension, ExtensionContext, ExtensionManifest, ExtensionType } from './types.js';
import type { DefaultExtensionRegistry } from './registry.js';

const REQUIRED_MANIFEST_FIELDS: (keyof ExtensionManifest)[] = ['id', 'name', 'description', 'version', 'type'];
const VALID_EXTENSION_TYPES: ExtensionType[] = ['channel', 'provider', 'integration', 'auth', 'storage', 'voice'];

export class ExtensionLoader {
  private logger: Logger;
  private registry: DefaultExtensionRegistry;
  private bus: MessageBus;

  constructor(logger: Logger, registry: DefaultExtensionRegistry, bus: MessageBus) {
    this.logger = logger;
    this.registry = registry;
    this.bus = bus;
  }

  /**
   * Load all extensions from a directory. Each subdirectory is expected to
   * contain an index.js that default-exports an Extension object.
   */
  async loadFromDirectory(dir: string, config?: Record<string, Record<string, unknown>>): Promise<Extension[]> {
    const absoluteDir = resolve(dir);
    const loaded: Extension[] = [];

    let entries: string[];
    try {
      entries = await readdir(absoluteDir);
    } catch (err) {
      this.logger.error(`Failed to read extensions directory "${absoluteDir}": ${err}`);
      return loaded;
    }

    for (const entry of entries) {
      const entryPath = join(absoluteDir, entry);
      const entryStat = await stat(entryPath).catch(() => null);
      if (!entryStat?.isDirectory()) continue;

      try {
        const extConfig = config?.[entry] ?? {};
        const ext = await this.loadExtension(entryPath, extConfig);
        if (ext) {
          loaded.push(ext);
        }
      } catch (err) {
        this.logger.warn(`Skipping extension at "${entryPath}": ${err}`);
      }
    }

    this.logger.info(`Loaded ${loaded.length} extension(s) from "${absoluteDir}"`);
    return loaded;
  }

  /**
   * Load a single extension from a directory path.
   */
  async loadExtension(extensionPath: string, config?: Record<string, unknown>): Promise<Extension> {
    const absolutePath = resolve(extensionPath);
    const indexPath = join(absolutePath, 'index.js');

    const indexStat = await stat(indexPath).catch(() => null);
    if (!indexStat?.isFile()) {
      throw new Error(`No index.js found at "${absolutePath}"`);
    }

    const moduleUrl = pathToFileURL(indexPath).href;
    const mod = await import(moduleUrl);
    const ext: Extension = mod.default ?? mod;

    if (!ext.id || !ext.name || !ext.type) {
      throw new Error(`Extension at "${absolutePath}" is missing required fields (id, name, type)`);
    }

    const context: ExtensionContext = {
      config: config ?? {},
      logger: this.logger.child({ extension: ext.id }),
      bus: this.bus,
    };

    await ext.init(context);
    this.registry.register(ext);
    this.logger.info(`Extension loaded: ${ext.name} (${ext.id}) [${ext.type}] v${ext.version}`);

    return ext;
  }

  /**
   * Validate an extension manifest object. Returns an array of validation
   * error strings; an empty array means the manifest is valid.
   */
  validateManifest(manifest: Partial<ExtensionManifest>): string[] {
    const errors: string[] = [];

    for (const field of REQUIRED_MANIFEST_FIELDS) {
      if (!manifest[field] || (typeof manifest[field] !== 'string')) {
        errors.push(`Missing or invalid required field: "${field}"`);
      }
    }

    if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) {
      errors.push('Extension id must contain only lowercase letters, numbers, and hyphens');
    }

    if (manifest.type && !VALID_EXTENSION_TYPES.includes(manifest.type)) {
      errors.push(`Invalid extension type "${manifest.type}". Must be one of: ${VALID_EXTENSION_TYPES.join(', ')}`);
    }

    if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      errors.push('Version must follow semver format (e.g., 1.0.0)');
    }

    if (manifest.configSchema && typeof manifest.configSchema !== 'object') {
      errors.push('configSchema must be a valid JSON Schema object');
    }

    if (manifest.dependencies) {
      if (!Array.isArray(manifest.dependencies)) {
        errors.push('dependencies must be an array of extension IDs');
      } else {
        for (const dep of manifest.dependencies) {
          if (typeof dep !== 'string' || !/^[a-z0-9-]+$/.test(dep)) {
            errors.push(`Invalid dependency: "${dep}"`);
          }
        }
      }
    }

    return errors;
  }

  /**
   * Unload and unregister an extension by its id.
   */
  async unloadExtension(id: string): Promise<void> {
    const ext = this.registry.get(id);
    if (!ext) {
      this.logger.warn(`Cannot unload extension "${id}": not found`);
      return;
    }

    if (ext.destroy) {
      await ext.destroy();
    }

    this.registry.unregister(id);
    this.logger.info(`Extension unloaded: ${ext.name} (${id})`);
  }

  /**
   * Unload all registered extensions.
   */
  async unloadAll(): Promise<void> {
    for (const ext of this.registry.getAll()) {
      try {
        if (ext.destroy) {
          await ext.destroy();
        }
      } catch (err) {
        this.logger.error(`Error destroying extension ${ext.name}: ${err}`);
      }
    }
    this.registry.clear();
    this.logger.info('All extensions unloaded');
  }

  /**
   * Resolve the load order based on extension dependencies.
   * Returns extensions sorted so that dependencies are loaded first.
   */
  async resolveLoadOrder(manifests: ExtensionManifest[]): Promise<ExtensionManifest[]> {
    const graph = new Map<string, string[]>();
    const manifestMap = new Map<string, ExtensionManifest>();

    for (const manifest of manifests) {
      graph.set(manifest.id, manifest.dependencies ?? []);
      manifestMap.set(manifest.id, manifest);
    }

    // Topological sort using Kahn's algorithm
    const inDegree = new Map<string, number>();
    for (const id of graph.keys()) {
      inDegree.set(id, 0);
    }

    for (const deps of graph.values()) {
      for (const dep of deps) {
        if (inDegree.has(dep)) {
          inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const sorted: ExtensionManifest[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const manifest = manifestMap.get(id);
      if (manifest) sorted.push(manifest);

      for (const dep of graph.get(id) ?? []) {
        const newDegree = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) queue.push(dep);
      }
    }

    if (sorted.length !== manifests.length) {
      const missing = manifests.filter(m => !sorted.includes(m)).map(m => m.id);
      this.logger.error(`Circular dependency detected involving: ${missing.join(', ')}`);
    }

    return sorted;
  }
}
