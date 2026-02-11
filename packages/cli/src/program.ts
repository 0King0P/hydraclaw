import { Command } from 'commander';
import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  loadConfig,
  Container,
  MessageBus,
  Events,
  createLogger,
  DefaultPluginRegistry,
  PluginLoader,
} from '@hydraclaw/core';
import type {
  HydraClawConfig,
  AIProvider,
  Channel,
  Tool,
  InboundMessage,
  OutboundMessage,
  PluginContext,
  Logger,
} from '@hydraclaw/core';
import { SQLiteStore, SessionStore } from '@hydraclaw/store';
import { Agent, ConversationManager } from '@hydraclaw/agent';
import { createGatewayServer } from '@hydraclaw/gateway';

// Known plugin package names keyed by config id
const PROVIDER_PACKAGES: Record<string, string> = {
  anthropic: '@hydraclaw/provider-anthropic',
  openai: '@hydraclaw/provider-openai',
  google: '@hydraclaw/provider-google',
  mistral: '@hydraclaw/provider-mistral',
  cohere: '@hydraclaw/provider-cohere',
  groq: '@hydraclaw/provider-groq',
  together: '@hydraclaw/provider-together',
  openrouter: '@hydraclaw/provider-openrouter',
  deepseek: '@hydraclaw/provider-deepseek',
  xai: '@hydraclaw/provider-xai',
  perplexity: '@hydraclaw/provider-perplexity',
  ollama: '@hydraclaw/provider-ollama',
  lmstudio: '@hydraclaw/provider-lmstudio',
  vllm: '@hydraclaw/provider-vllm',
};

const CHANNEL_PACKAGES: Record<string, string> = {
  telegram: '@hydraclaw/channel-telegram',
  discord: '@hydraclaw/channel-discord',
  whatsapp: '@hydraclaw/channel-whatsapp',
  slack: '@hydraclaw/channel-slack',
  signal: '@hydraclaw/channel-signal',
  imessage: '@hydraclaw/channel-imessage',
  matrix: '@hydraclaw/channel-matrix',
  email: '@hydraclaw/channel-email',
  irc: '@hydraclaw/channel-irc',
  xmpp: '@hydraclaw/channel-xmpp',
  reddit: '@hydraclaw/channel-reddit',
  twitter: '@hydraclaw/channel-twitter',
  mastodon: '@hydraclaw/channel-mastodon',
  bluesky: '@hydraclaw/channel-bluesky',
  line: '@hydraclaw/channel-line',
  teams: '@hydraclaw/channel-teams',
  webchat: '@hydraclaw/channel-webchat',
  zalo: '@hydraclaw/channel-zalo',
};

const TOOL_PACKAGES: Record<string, string> = {
  shell: '@hydraclaw/tool-shell',
  filesystem: '@hydraclaw/tool-filesystem',
  browser: '@hydraclaw/tool-browser',
  'http-client': '@hydraclaw/tool-http',
  scheduler: '@hydraclaw/tool-scheduler',
  webhook: '@hydraclaw/tool-webhook',
  database: '@hydraclaw/tool-database',
  'code-runner': '@hydraclaw/tool-coderunner',
  scraper: '@hydraclaw/tool-scraper',
  git: '@hydraclaw/tool-git',
  docker: '@hydraclaw/tool-docker',
  'image-gen': '@hydraclaw/tool-imagegen',
};

async function tryImportDefault<T>(pkg: string, logger: Logger): Promise<T | null> {
  try {
    const mod = await import(pkg);
    const Cls = mod.default ?? mod[Object.keys(mod)[0]];
    if (typeof Cls === 'function') {
      return new Cls() as T;
    }
    return Cls as T;
  } catch (err) {
    logger.debug(`Could not import ${pkg}: ${err}`);
    return null;
  }
}

function createPluginContext(
  config: Record<string, unknown>,
  logger: Logger,
  bus: MessageBus,
  container: Container,
): PluginContext {
  return { config, logger, bus, container };
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('hydraclaw')
    .description('HydraClaw - Multi-headed AI assistant platform')
    .version('1.0.0');

  // ─── start ───────────────────────────────────────────────────────────
  program
    .command('start')
    .description('Start the gateway server with all loaded plugins')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (opts: { config?: string }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', pretty: true });

      logger.info(chalk.bold.cyan('HydraClaw') + ' starting up...');

      // Container
      const container = new Container();
      const bus = new MessageBus();

      container.registerInstance('config', config);
      container.registerInstance('gatewayConfig', config.gateway);
      container.registerInstance('agentConfig', config.agent);
      container.registerInstance('logger', logger);
      container.registerInstance('bus', bus);

      // Store
      const dbPath = resolve(process.cwd(), config.store.path);
      const sqliteStore = new SQLiteStore(dbPath, logger);
      const sessionStore = new SessionStore(sqliteStore);

      container.registerInstance('sqliteStore', sqliteStore);
      container.registerInstance('sessionStore', sessionStore);

      // Plugin system
      const registry = new DefaultPluginRegistry();
      const loader = new PluginLoader(logger, registry);

      container.registerInstance('registry', registry);
      container.registerInstance('pluginLoader', loader);

      // Load providers
      for (const [id, providerConfig] of Object.entries(config.providers)) {
        if (providerConfig.enabled === false) continue;
        const pkg = PROVIDER_PACKAGES[id] ?? `@hydraclaw/provider-${id}`;
        const provider = await tryImportDefault<AIProvider>(pkg, logger);
        if (provider) {
          const ctx = createPluginContext(providerConfig as Record<string, unknown>, logger, bus, container);
          await loader.loadPlugin(provider, ctx);
          logger.info(`Provider loaded: ${chalk.green(id)}`);
        }
      }

      // Load channels
      for (const [id, channelConfig] of Object.entries(config.channels)) {
        if (channelConfig.enabled === false) continue;
        const pkg = CHANNEL_PACKAGES[id] ?? `@hydraclaw/channel-${id}`;
        const channel = await tryImportDefault<Channel>(pkg, logger);
        if (channel) {
          const ctx = createPluginContext(channelConfig as Record<string, unknown>, logger, bus, container);
          await loader.loadPlugin(channel, ctx);
          logger.info(`Channel loaded: ${chalk.green(id)}`);
        }
      }

      // Load tools
      for (const [id, toolConfig] of Object.entries(config.tools)) {
        if (toolConfig.enabled === false) continue;
        const pkg = TOOL_PACKAGES[id] ?? `@hydraclaw/tool-${id}`;
        const tool = await tryImportDefault<Tool>(pkg, logger);
        if (tool) {
          const ctx = createPluginContext(toolConfig as Record<string, unknown>, logger, bus, container);
          await loader.loadPlugin(tool, ctx);
          logger.info(`Tool loaded: ${chalk.green(id)}`);
        }
      }

      // Auto-load default tools if none specified in config
      if (Object.keys(config.tools).length === 0) {
        for (const [id, pkg] of Object.entries(TOOL_PACKAGES)) {
          const tool = await tryImportDefault<Tool>(pkg, logger);
          if (tool) {
            const ctx = createPluginContext({}, logger, bus, container);
            await loader.loadPlugin(tool, ctx);
            logger.info(`Tool auto-loaded: ${chalk.green(id)}`);
          }
        }
      }

      // Agent
      const conversationManager = new ConversationManager(sessionStore, config.agent);
      const agent = new Agent(config.agent, registry, conversationManager, logger, bus);

      container.registerInstance('agent', agent);
      container.registerInstance('conversationManager', conversationManager);

      // Security guard (opt-in)
      if (config.security && (config.security as Record<string, unknown>).enabled) {
        try {
          const { SecurityGuard } = await import('@hydraclaw/security');
          const guard = new SecurityGuard(config.security as Record<string, unknown>, logger, bus);
          await guard.init();
          const toolGuard = guard.getToolExecutionGuard();
          if (toolGuard) {
            agent.setToolGuard(toolGuard);
          }
          logger.info(chalk.green('Security guard active'));
        } catch (err) {
          logger.warn(`Failed to load security module: ${err}`);
        }
      }

      // Message routing: inbound messages -> agent -> outbound
      bus.on(Events.MESSAGE_INBOUND, async (message: unknown) => {
        const inbound = message as InboundMessage;
        logger.info(`Inbound message from ${inbound.channelId}:${inbound.senderId}`);

        try {
          const result = await agent.run({ message: inbound });

          // Send response back through the channel
          const channel = registry.getChannel(inbound.channelId) as Channel | undefined;
          if (channel) {
            const outbound: OutboundMessage = {
              content: result.content,
              replyToId: inbound.channelMessageId,
            };
            await channel.send(inbound.target, outbound);
            await bus.emit(Events.MESSAGE_OUTBOUND, {
              channelId: inbound.channelId,
              target: inbound.target,
              message: outbound,
            });
          }
        } catch (err) {
          logger.error(`Error processing message: ${err}`);
        }
      });

      // Gateway
      const gateway = createGatewayServer(container);
      await gateway.start();

      // Start all channels
      for (const [, plugin] of registry.channels) {
        const channel = plugin as Channel;
        try {
          await channel.start();
          logger.info(`Channel started: ${chalk.green(channel.name)}`);
          await bus.emit(Events.CHANNEL_CONNECTED, { channelId: channel.id });
        } catch (err) {
          logger.error(`Failed to start channel ${channel.name}: ${err}`);
        }
      }

      logger.info(chalk.bold.green('HydraClaw is ready!'));
      logger.info(`  HTTP: http://${config.gateway.host}:${config.gateway.port}`);
      logger.info(`  WS:   ws://${config.gateway.host}:${config.gateway.wsPort}`);
      logger.info(`  Providers: ${[...registry.providers.keys()].join(', ') || 'none'}`);
      logger.info(`  Channels:  ${[...registry.channels.keys()].join(', ') || 'none'}`);
      logger.info(`  Tools:     ${[...registry.tools.keys()].join(', ') || 'none'}`);

      // Graceful shutdown
      const shutdown = async (signal: string) => {
        logger.info(`\n${signal} received, shutting down...`);

        // Stop channels
        for (const [, plugin] of registry.channels) {
          const channel = plugin as Channel;
          try {
            await channel.stop();
            await bus.emit(Events.CHANNEL_DISCONNECTED, { channelId: channel.id });
          } catch (err) {
            logger.error(`Error stopping channel ${channel.name}: ${err}`);
          }
        }

        // Stop gateway
        await gateway.stop();

        // Unload all plugins
        await loader.unloadAll();

        // Close store
        sqliteStore.close();

        logger.info('Shutdown complete');
        process.exit(0);
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    });

  // ─── chat ────────────────────────────────────────────────────────────
  program
    .command('chat <message>')
    .description('Send a one-shot message to the agent via CLI')
    .option('-c, --config <path>', 'Path to config file')
    .option('-p, --provider <provider>', 'Provider to use')
    .option('-m, --model <model>', 'Model to use')
    .action(async (message: string, opts: { config?: string; provider?: string; model?: string }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });
      const container = new Container();
      const bus = new MessageBus();

      container.registerInstance('config', config);
      container.registerInstance('logger', logger);
      container.registerInstance('bus', bus);

      const dbPath = resolve(process.cwd(), config.store.path);
      const sqliteStore = new SQLiteStore(dbPath, logger);
      const sessionStore = new SessionStore(sqliteStore);
      const registry = new DefaultPluginRegistry();
      const loader = new PluginLoader(logger, registry);

      // Load the target provider
      const providerId = opts.provider ?? config.agent.defaultProvider;
      const providerConfig = config.providers[providerId];
      if (!providerConfig) {
        console.error(chalk.red(`Provider '${providerId}' not found in config.`));
        process.exit(1);
      }

      const pkg = PROVIDER_PACKAGES[providerId] ?? `@hydraclaw/provider-${providerId}`;
      const provider = await tryImportDefault<AIProvider>(pkg, logger);
      if (!provider) {
        console.error(chalk.red(`Failed to load provider package: ${pkg}`));
        process.exit(1);
      }

      const ctx = createPluginContext(providerConfig as Record<string, unknown>, logger, bus, container);
      await loader.loadPlugin(provider, ctx);

      // Load tools
      for (const [id, toolConfig] of Object.entries(config.tools)) {
        if (toolConfig.enabled === false) continue;
        const toolPkg = TOOL_PACKAGES[id] ?? `@hydraclaw/tool-${id}`;
        const tool = await tryImportDefault<Tool>(toolPkg, logger);
        if (tool) {
          const toolCtx = createPluginContext(toolConfig as Record<string, unknown>, logger, bus, container);
          await loader.loadPlugin(tool, toolCtx);
        }
      }

      const conversationManager = new ConversationManager(sessionStore, config.agent);
      const agent = new Agent(
        { ...config.agent, ...(opts.model ? { defaultModel: opts.model } : {}) },
        registry,
        conversationManager,
        logger,
        bus,
      );

      const inbound: InboundMessage = {
        id: randomUUID(),
        channelId: 'cli',
        senderId: 'cli-user',
        target: 'cli',
        content: message,
        isGroup: false,
        timestamp: Math.floor(Date.now() / 1000),
      };

      try {
        process.stdout.write(chalk.dim('Thinking... '));
        const result = await agent.run({
          message: inbound,
          provider: provider as AIProvider,
          model: opts.model,
          onStream: (chunk) => {
            if (chunk.type === 'text' && chunk.delta) {
              process.stdout.write(chunk.delta);
            }
          },
        });
        // If streaming didn't output anything, print the final content
        if (!result.content.includes('\n')) {
          console.log();
        }
        console.log(chalk.dim(`\n[${result.provider}/${result.model}]`));
      } catch (err) {
        console.error(chalk.red(`Error: ${err}`));
        process.exit(1);
      } finally {
        sqliteStore.close();
        process.exit(0);
      }
    });

  // ─── config ──────────────────────────────────────────────────────────
  program
    .command('config')
    .description('Show current configuration')
    .option('-c, --config <path>', 'Path to config file')
    .action((opts: { config?: string }) => {
      const config = loadConfig(opts.config);
      console.log(chalk.bold.cyan('HydraClaw Configuration\n'));

      console.log(chalk.bold('Gateway:'));
      console.log(`  Host: ${config.gateway.host}`);
      console.log(`  Port: ${config.gateway.port}`);
      console.log(`  WS Port: ${config.gateway.wsPort}`);

      console.log(chalk.bold('\nAgent:'));
      console.log(`  Default Provider: ${config.agent.defaultProvider}`);
      console.log(`  Default Model: ${config.agent.defaultModel}`);
      console.log(`  Max Tokens: ${config.agent.maxTokens}`);
      console.log(`  Temperature: ${config.agent.temperature}`);
      console.log(`  Max History: ${config.agent.maxHistory}`);

      console.log(chalk.bold('\nProviders:'));
      const providerIds = Object.keys(config.providers);
      if (providerIds.length === 0) {
        console.log('  (none configured)');
      } else {
        for (const id of providerIds) {
          const pc = config.providers[id];
          const status = pc.enabled === false ? chalk.red('disabled') : chalk.green('enabled');
          console.log(`  ${id}: ${status}`);
        }
      }

      console.log(chalk.bold('\nChannels:'));
      const channelIds = Object.keys(config.channels);
      if (channelIds.length === 0) {
        console.log('  (none configured)');
      } else {
        for (const id of channelIds) {
          const cc = config.channels[id];
          const status = cc.enabled === false ? chalk.red('disabled') : chalk.green('enabled');
          console.log(`  ${id}: ${status}`);
        }
      }

      console.log(chalk.bold('\nTools:'));
      const toolIds = Object.keys(config.tools);
      if (toolIds.length === 0) {
        console.log('  (none configured - defaults will be auto-loaded)');
      } else {
        for (const id of toolIds) {
          const tc = config.tools[id];
          const status = tc.enabled === false ? chalk.red('disabled') : chalk.green('enabled');
          console.log(`  ${id}: ${status}`);
        }
      }

      console.log(chalk.bold('\nStore:'));
      console.log(`  Path: ${config.store.path}`);
      console.log(`  Vector Store: ${config.store.vectorStore ? 'enabled' : 'disabled'}`);
    });

  // ─── status ──────────────────────────────────────────────────────────
  program
    .command('status')
    .description('Show system status (loaded providers, channels, tools)')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (opts: { config?: string }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });

      console.log(chalk.bold.cyan('HydraClaw Status\n'));

      // Check available providers
      console.log(chalk.bold('Providers:'));
      for (const [id, providerConfig] of Object.entries(config.providers)) {
        const status = providerConfig.enabled === false ? chalk.red('disabled') : chalk.green('configured');
        const hasKey = providerConfig.apiKey ? chalk.green('key set') : chalk.yellow('no key');
        console.log(`  ${id}: ${status} (${hasKey})`);
      }
      if (Object.keys(config.providers).length === 0) {
        console.log('  (none configured)');
      }

      // Check available channels
      console.log(chalk.bold('\nChannels:'));
      for (const [id, channelConfig] of Object.entries(config.channels)) {
        const status = channelConfig.enabled === false ? chalk.red('disabled') : chalk.green('configured');
        console.log(`  ${id}: ${status}`);
      }
      if (Object.keys(config.channels).length === 0) {
        console.log('  (none configured)');
      }

      // Check available tools
      console.log(chalk.bold('\nTools:'));
      const toolIds = Object.keys(config.tools);
      if (toolIds.length === 0) {
        console.log('  (defaults will be auto-loaded on start)');
        for (const [id, pkg] of Object.entries(TOOL_PACKAGES)) {
          const available = await tryImportDefault(pkg, logger);
          const status = available ? chalk.green('available') : chalk.dim('not installed');
          console.log(`  ${id}: ${status}`);
        }
      } else {
        for (const [id, toolConfig] of Object.entries(config.tools)) {
          const status = toolConfig.enabled === false ? chalk.red('disabled') : chalk.green('configured');
          console.log(`  ${id}: ${status}`);
        }
      }

      console.log(chalk.bold('\nGateway:'));
      console.log(`  HTTP: http://${config.gateway.host}:${config.gateway.port}`);
      console.log(`  WS:   ws://${config.gateway.host}:${config.gateway.wsPort}`);

      console.log(chalk.bold('\nStore:'));
      console.log(`  Path: ${resolve(process.cwd(), config.store.path)}`);
    });

  // ─── send ────────────────────────────────────────────────────────────
  program
    .command('send <message>')
    .description('Send a message through a channel')
    .requiredOption('--channel <channel>', 'Channel to send through')
    .requiredOption('--to <target>', 'Target (chat ID, user ID, etc.)')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (message: string, opts: { channel: string; to: string; config?: string }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });
      const container = new Container();
      const bus = new MessageBus();

      container.registerInstance('config', config);
      container.registerInstance('logger', logger);
      container.registerInstance('bus', bus);

      const registry = new DefaultPluginRegistry();
      const loader = new PluginLoader(logger, registry);

      // Load the target channel
      const channelConfig = config.channels[opts.channel];
      if (!channelConfig) {
        console.error(chalk.red(`Channel '${opts.channel}' not found in config.`));
        process.exit(1);
      }

      const pkg = CHANNEL_PACKAGES[opts.channel] ?? `@hydraclaw/channel-${opts.channel}`;
      const channel = await tryImportDefault<Channel>(pkg, logger);
      if (!channel) {
        console.error(chalk.red(`Failed to load channel package: ${pkg}`));
        process.exit(1);
      }

      const ctx = createPluginContext(channelConfig as Record<string, unknown>, logger, bus, container);
      await loader.loadPlugin(channel, ctx);
      await channel.start();

      try {
        const outbound: OutboundMessage = { content: message };
        await channel.send(opts.to, outbound);
        console.log(chalk.green(`Message sent to ${opts.to} via ${opts.channel}`));
      } catch (err) {
        console.error(chalk.red(`Failed to send message: ${err}`));
        process.exit(1);
      } finally {
        await channel.stop();
      }
    });

  // ─── scan ────────────────────────────────────────────────────────────
  program
    .command('scan')
    .description('Scan configuration for security vulnerabilities')
    .option('-c, --config <path>', 'Path to config file')
    .option('--json', 'Output as JSON')
    .action(async (opts: { config?: string; json?: boolean }) => {
      const config = loadConfig(opts.config);

      try {
        const { VulnerabilityScanner, formatReport } = await import('@hydraclaw/security');
        const scanner = new VulnerabilityScanner();
        const report = scanner.scan(config);

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatReport(report));
        }

        if (report.summary.critical > 0) {
          process.exit(1);
        }
      } catch (err) {
        console.error(chalk.red(`Failed to load security module: ${err}`));
        console.error(chalk.dim('Make sure @hydraclaw/security is installed.'));
        process.exit(1);
      }
    });

  return program;
}
