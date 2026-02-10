import type { Plugin, PluginContext, PluginRegistry } from './types/plugin.js';
import type { AIProvider } from './types/provider.js';
import type { Channel } from './types/channel.js';
import type { Tool } from './types/tool.js';
import type { Logger } from './logger.js';

export class DefaultPluginRegistry implements PluginRegistry {
  providers = new Map<string, Plugin>();
  channels = new Map<string, Plugin>();
  tools = new Map<string, Plugin>();

  all(): Plugin[] {
    return [
      ...this.providers.values(),
      ...this.channels.values(),
      ...this.tools.values(),
    ];
  }

  get(id: string): Plugin | undefined {
    return this.providers.get(id) ?? this.channels.get(id) ?? this.tools.get(id);
  }

  register(plugin: Plugin): void {
    switch (plugin.type) {
      case 'provider':
        this.providers.set(plugin.id, plugin);
        break;
      case 'channel':
        this.channels.set(plugin.id, plugin);
        break;
      case 'tool':
        this.tools.set(plugin.id, plugin);
        break;
    }
  }

  unregister(id: string): void {
    this.providers.delete(id);
    this.channels.delete(id);
    this.tools.delete(id);
  }

  getProvider(id: string): AIProvider | undefined {
    return this.providers.get(id) as AIProvider | undefined;
  }

  getChannel(id: string): Channel | undefined {
    return this.channels.get(id) as Channel | undefined;
  }

  getTool(id: string): Tool | undefined {
    return this.tools.get(id) as Tool | undefined;
  }
}

export class PluginLoader {
  private logger: Logger;
  private registry: DefaultPluginRegistry;

  constructor(logger: Logger, registry: DefaultPluginRegistry) {
    this.logger = logger;
    this.registry = registry;
  }

  async loadPlugin(plugin: Plugin, ctx: PluginContext): Promise<void> {
    this.logger.info(`Loading plugin: ${plugin.name} (${plugin.id})`);
    try {
      await plugin.init(ctx);
      this.registry.register(plugin);
      this.logger.info(`Plugin loaded: ${plugin.name}`);
    } catch (err) {
      this.logger.error(`Failed to load plugin ${plugin.name}: ${err}`);
      throw err;
    }
  }

  async loadPlugins(plugins: Plugin[], ctx: PluginContext): Promise<void> {
    for (const plugin of plugins) {
      try {
        await this.loadPlugin(plugin, ctx);
      } catch {
        this.logger.warn(`Skipping plugin ${plugin.name} due to load failure`);
      }
    }
  }

  async unloadPlugin(id: string): Promise<void> {
    const plugin = this.registry.get(id);
    if (plugin?.destroy) {
      await plugin.destroy();
    }
    this.registry.unregister(id);
  }

  async unloadAll(): Promise<void> {
    for (const plugin of this.registry.all()) {
      if (plugin.destroy) {
        try {
          await plugin.destroy();
        } catch (err) {
          this.logger.error(`Error destroying plugin ${plugin.name}: ${err}`);
        }
      }
    }
    this.registry.providers.clear();
    this.registry.channels.clear();
    this.registry.tools.clear();
  }
}
