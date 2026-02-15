import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Logger } from '@hydraclaw/core';
import type { Skill, SkillManifest } from './types.js';
import type { DefaultSkillRegistry } from './registry.js';

const REQUIRED_MANIFEST_FIELDS: (keyof SkillManifest)[] = ['id', 'name', 'description', 'version'];

export class SkillLoader {
  private logger: Logger;
  private registry: DefaultSkillRegistry;

  constructor(logger: Logger, registry: DefaultSkillRegistry) {
    this.logger = logger;
    this.registry = registry;
  }

  /**
   * Load all skills from a directory. Each subdirectory is expected to contain
   * an index.ts/index.js that exports a default Skill object.
   */
  async loadFromDirectory(dir: string): Promise<Skill[]> {
    const absoluteDir = resolve(dir);
    const loaded: Skill[] = [];

    let entries: string[];
    try {
      entries = await readdir(absoluteDir);
    } catch (err) {
      this.logger.error(`Failed to read skills directory "${absoluteDir}": ${err}`);
      return loaded;
    }

    for (const entry of entries) {
      const entryPath = join(absoluteDir, entry);
      const entryStat = await stat(entryPath).catch(() => null);
      if (!entryStat?.isDirectory()) continue;

      try {
        const skill = await this.loadSkill(entryPath);
        if (skill) {
          loaded.push(skill);
        }
      } catch (err) {
        this.logger.warn(`Skipping skill at "${entryPath}": ${err}`);
      }
    }

    this.logger.info(`Loaded ${loaded.length} skill(s) from "${absoluteDir}"`);
    return loaded;
  }

  /**
   * Load a single skill from a directory path. The directory must contain
   * an index.js (or index.ts compiled to .js) that default-exports a Skill.
   */
  async loadSkill(skillPath: string): Promise<Skill> {
    const absolutePath = resolve(skillPath);
    const indexPath = join(absolutePath, 'index.js');

    const indexStat = await stat(indexPath).catch(() => null);
    if (!indexStat?.isFile()) {
      throw new Error(`No index.js found at "${absolutePath}"`);
    }

    const moduleUrl = pathToFileURL(indexPath).href;
    const mod = await import(moduleUrl);
    const skill: Skill = mod.default ?? mod;

    if (!skill.id || !skill.name) {
      throw new Error(`Skill at "${absolutePath}" is missing required fields (id, name)`);
    }

    this.registry.register(skill);
    this.logger.info(`Skill loaded: ${skill.name} (${skill.id}) v${skill.version}`);

    if (skill.init) {
      await skill.init({});
    }

    return skill;
  }

  /**
   * Validate a skill manifest object. Returns an array of validation error
   * strings; an empty array means the manifest is valid.
   */
  validateManifest(manifest: Partial<SkillManifest>): string[] {
    const errors: string[] = [];

    for (const field of REQUIRED_MANIFEST_FIELDS) {
      if (!manifest[field] || typeof manifest[field] !== 'string') {
        errors.push(`Missing or invalid required field: "${field}"`);
      }
    }

    if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) {
      errors.push('Skill id must contain only lowercase letters, numbers, and hyphens');
    }

    if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      errors.push('Version must follow semver format (e.g., 1.0.0)');
    }

    if (manifest.configSchema && typeof manifest.configSchema !== 'object') {
      errors.push('configSchema must be a valid JSON Schema object');
    }

    return errors;
  }

  /**
   * Install a skill from a remote source (npm package, git URL, or local path).
   * Returns the installed Skill on success.
   */
  async installSkill(source: string): Promise<Skill> {
    this.logger.info(`Installing skill from source: ${source}`);

    let resolvedPath: string;

    if (source.startsWith('/') || source.startsWith('./') || source.startsWith('../')) {
      // Local path
      resolvedPath = resolve(source);
    } else if (source.startsWith('git+') || source.startsWith('https://') || source.startsWith('git://')) {
      // Git URL - clone to a temporary location then load
      throw new Error('Git-based skill installation is not yet implemented');
    } else {
      // Treat as npm package name
      throw new Error('npm-based skill installation is not yet implemented');
    }

    // Attempt to load the manifest first
    const manifestPath = join(resolvedPath, 'manifest.json');
    try {
      const manifestRaw = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestRaw) as Partial<SkillManifest>;
      const errors = this.validateManifest(manifest);
      if (errors.length > 0) {
        throw new Error(`Invalid skill manifest: ${errors.join('; ')}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      this.logger.debug('No manifest.json found, proceeding with index.js-based loading');
    }

    return this.loadSkill(resolvedPath);
  }

  /**
   * Unload and unregister a skill by its id.
   */
  async unloadSkill(id: string): Promise<void> {
    const skill = this.registry.get(id);
    if (!skill) {
      this.logger.warn(`Cannot unload skill "${id}": not found`);
      return;
    }

    if (skill.destroy) {
      await skill.destroy();
    }

    this.registry.unregister(id);
    this.logger.info(`Skill unloaded: ${skill.name} (${id})`);
  }

  /**
   * Unload all registered skills.
   */
  async unloadAll(): Promise<void> {
    for (const skill of this.registry.getAll()) {
      try {
        if (skill.destroy) {
          await skill.destroy();
        }
      } catch (err) {
        this.logger.error(`Error destroying skill ${skill.name}: ${err}`);
      }
    }
    this.registry.clear();
    this.logger.info('All skills unloaded');
  }
}
