import { Command } from 'commander';
import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
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

// ─── Banner ──────────────────────────────────────────────────────────────────

const BANNER = `
${chalk.bold.cyan('  _   _           _            ____ _')}
${chalk.bold.cyan(' | | | |_   _  __| |_ __ __ _ / ___| | __ ___      __')}
${chalk.bold.cyan(' | |_| | | | |/ _` | \'__/ _` | |   | |/ _` \\ \\ /\\ / /')}
${chalk.bold.cyan(' |  _  | |_| | (_| | | | (_| | |___| | (_| |\\ V  V /')}
${chalk.bold.cyan(' |_| |_|\\__, |\\__,_|_|  \\__,_|\\____|_|\\__,_| \\_/\\_/')}
${chalk.bold.cyan('        |___/')}
${chalk.dim('  Multi-headed AI assistant platform')}
`;

// ─── Spinner utility ─────────────────────────────────────────────────────────

class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  start(): this {
    this.interval = setInterval(() => {
      const frame = chalk.cyan(this.frames[this.frameIndex]);
      process.stderr.write(`\r${frame} ${this.text}`);
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    }, 80);
    return this;
  }

  update(text: string): void {
    this.text = text;
  }

  succeed(text?: string): void {
    this.stop();
    process.stderr.write(`\r${chalk.green('✓')} ${text ?? this.text}\n`);
  }

  fail(text?: string): void {
    this.stop();
    process.stderr.write(`\r${chalk.red('✗')} ${text ?? this.text}\n`);
  }

  warn(text?: string): void {
    this.stop();
    process.stderr.write(`\r${chalk.yellow('!')} ${text ?? this.text}\n`);
  }

  info(text?: string): void {
    this.stop();
    process.stderr.write(`\r${chalk.blue('i')} ${text ?? this.text}\n`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stderr.write('\r' + ' '.repeat(this.text.length + 4) + '\r');
    }
  }
}

// ─── Known plugin package names ──────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/**
 * Check if Ollama is running and reachable at the given URL.
 * Returns { running: true, models: [...] } or { running: false }.
 */
async function checkOllamaHealth(baseUrl: string): Promise<{
  running: boolean;
  models: string[];
  version?: string;
}> {
  // Derive the Ollama native API URL from the OpenAI-compat URL
  // e.g. http://localhost:11434/v1 -> http://localhost:11434
  const ollamaRoot = baseUrl.replace(/\/v1\/?$/, '');

  try {
    // Check if Ollama is reachable
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const versionRes = await fetch(ollamaRoot, { signal: controller.signal });
    clearTimeout(timeout);

    if (!versionRes.ok) return { running: false, models: [] };

    const versionText = await versionRes.text();
    const version = versionText.includes('Ollama') ? versionText.trim() : undefined;

    // Fetch available models
    const modelsController = new AbortController();
    const modelsTimeout = setTimeout(() => modelsController.abort(), 5000);

    const modelsRes = await fetch(`${ollamaRoot}/api/tags`, { signal: modelsController.signal });
    clearTimeout(modelsTimeout);

    if (!modelsRes.ok) return { running: true, models: [], version };

    const modelsData = await modelsRes.json() as { models?: Array<{ name: string; size: number }> };
    const models = (modelsData.models ?? []).map((m) => m.name);

    return { running: true, models, version };
  } catch {
    return { running: false, models: [] };
  }
}

/**
 * Simple stdin line reader for interactive prompts.
 */
async function promptUser(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? chalk.dim(` [${defaultValue}]`) : '';
  process.stdout.write(`${chalk.cyan('?')} ${question}${suffix}: `);

  return new Promise((resolve) => {
    const { stdin } = process;
    const wasRaw = stdin.isRaw;

    stdin.resume();
    stdin.setEncoding('utf-8');

    const onData = (data: string) => {
      stdin.removeListener('data', onData);
      stdin.pause();
      const answer = data.toString().trim();
      resolve(answer || defaultValue || '');
    };

    stdin.on('data', onData);
  });
}

async function promptChoice(question: string, choices: string[], defaultIndex: number = 0): Promise<number> {
  console.log(`\n${chalk.cyan('?')} ${question}`);
  for (let i = 0; i < choices.length; i++) {
    const marker = i === defaultIndex ? chalk.cyan('> ') : '  ';
    const label = i === defaultIndex ? chalk.bold(choices[i]) : choices[i];
    console.log(`  ${marker}${chalk.dim(`${i + 1}.`)} ${label}`);
  }
  const answer = await promptUser('Enter choice number', String(defaultIndex + 1));
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < choices.length) return idx;
  return defaultIndex;
}

// ─── Plugin loading with UX feedback ─────────────────────────────────────────

interface LoadResult {
  loaded: string[];
  failed: string[];
  skipped: string[];
}

async function loadProvidersWithFeedback(
  config: HydraClawConfig,
  logger: Logger,
  bus: MessageBus,
  container: Container,
  registry: DefaultPluginRegistry,
  loader: PluginLoader,
): Promise<LoadResult> {
  const result: LoadResult = { loaded: [], failed: [], skipped: [] };
  const entries = Object.entries(config.providers);

  if (entries.length === 0) {
    return result;
  }

  for (const [id, providerConfig] of entries) {
    if (providerConfig.enabled === false) {
      result.skipped.push(id);
      continue;
    }
    const pkg = PROVIDER_PACKAGES[id] ?? `@hydraclaw/provider-${id}`;
    const spinner = new Spinner(`Loading provider: ${chalk.bold(id)}`);
    spinner.start();

    const provider = await tryImportDefault<AIProvider>(pkg, logger);
    if (provider) {
      try {
        const ctx = createPluginContext(providerConfig as Record<string, unknown>, logger, bus, container);
        await loader.loadPlugin(provider, ctx);
        spinner.succeed(`Provider loaded: ${chalk.green.bold(id)}`);
        result.loaded.push(id);
      } catch (err) {
        spinner.fail(`Provider failed: ${chalk.red.bold(id)} - ${err}`);
        result.failed.push(id);
      }
    } else {
      spinner.fail(`Provider not found: ${chalk.red.bold(id)} (package: ${pkg})`);
      result.failed.push(id);
    }
  }
  return result;
}

async function loadChannelsWithFeedback(
  config: HydraClawConfig,
  logger: Logger,
  bus: MessageBus,
  container: Container,
  registry: DefaultPluginRegistry,
  loader: PluginLoader,
): Promise<LoadResult> {
  const result: LoadResult = { loaded: [], failed: [], skipped: [] };
  const entries = Object.entries(config.channels);

  if (entries.length === 0) {
    return result;
  }

  for (const [id, channelConfig] of entries) {
    if (channelConfig.enabled === false) {
      result.skipped.push(id);
      continue;
    }
    const pkg = CHANNEL_PACKAGES[id] ?? `@hydraclaw/channel-${id}`;
    const spinner = new Spinner(`Loading channel: ${chalk.bold(id)}`);
    spinner.start();

    const channel = await tryImportDefault<Channel>(pkg, logger);
    if (channel) {
      try {
        const ctx = createPluginContext(channelConfig as Record<string, unknown>, logger, bus, container);
        await loader.loadPlugin(channel, ctx);
        spinner.succeed(`Channel loaded: ${chalk.green.bold(id)}`);
        result.loaded.push(id);
      } catch (err) {
        spinner.fail(`Channel failed: ${chalk.red.bold(id)} - ${err}`);
        result.failed.push(id);
      }
    } else {
      spinner.fail(`Channel not found: ${chalk.red.bold(id)} (package: ${pkg})`);
      result.failed.push(id);
    }
  }
  return result;
}

async function loadToolsWithFeedback(
  config: HydraClawConfig,
  logger: Logger,
  bus: MessageBus,
  container: Container,
  registry: DefaultPluginRegistry,
  loader: PluginLoader,
): Promise<LoadResult> {
  const result: LoadResult = { loaded: [], failed: [], skipped: [] };
  const entries = Object.entries(config.tools);

  if (entries.length > 0) {
    for (const [id, toolConfig] of entries) {
      if (toolConfig.enabled === false) {
        result.skipped.push(id);
        continue;
      }
      const pkg = TOOL_PACKAGES[id] ?? `@hydraclaw/tool-${id}`;
      const spinner = new Spinner(`Loading tool: ${chalk.bold(id)}`);
      spinner.start();

      const tool = await tryImportDefault<Tool>(pkg, logger);
      if (tool) {
        try {
          const ctx = createPluginContext(toolConfig as Record<string, unknown>, logger, bus, container);
          await loader.loadPlugin(tool, ctx);
          spinner.succeed(`Tool loaded: ${chalk.green.bold(id)}`);
          result.loaded.push(id);
        } catch (err) {
          spinner.fail(`Tool failed: ${chalk.red.bold(id)} - ${err}`);
          result.failed.push(id);
        }
      } else {
        spinner.fail(`Tool not found: ${chalk.red.bold(id)} (package: ${pkg})`);
        result.failed.push(id);
      }
    }
  } else {
    // Auto-load all tools
    const spinner = new Spinner('Auto-loading default tools...');
    spinner.start();
    spinner.stop();

    for (const [id, pkg] of Object.entries(TOOL_PACKAGES)) {
      const tool = await tryImportDefault<Tool>(pkg, logger);
      if (tool) {
        try {
          const ctx = createPluginContext({}, logger, bus, container);
          await loader.loadPlugin(tool, ctx);
          process.stderr.write(`  ${chalk.green('+')} ${id}\n`);
          result.loaded.push(id);
        } catch {
          process.stderr.write(`  ${chalk.red('-')} ${id} ${chalk.dim('(load error)')}\n`);
          result.failed.push(id);
        }
      }
    }
  }

  return result;
}

function printLoadSummary(label: string, result: LoadResult): void {
  if (result.loaded.length === 0 && result.failed.length === 0 && result.skipped.length === 0) {
    return;
  }
  const parts: string[] = [];
  if (result.loaded.length > 0) parts.push(chalk.green(`${result.loaded.length} loaded`));
  if (result.failed.length > 0) parts.push(chalk.red(`${result.failed.length} failed`));
  if (result.skipped.length > 0) parts.push(chalk.dim(`${result.skipped.length} skipped`));
  console.log(`  ${label}: ${parts.join(', ')}`);
}

// ─── Program ─────────────────────────────────────────────────────────────────

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
    .option('-q, --quiet', 'Suppress banner and non-essential output')
    .action(async (opts: { config?: string; quiet?: boolean }) => {
      if (!opts.quiet) {
        console.log(BANNER);
      }

      // Load config
      const configSpinner = new Spinner('Loading configuration...');
      configSpinner.start();

      let config: HydraClawConfig;
      try {
        config = loadConfig(opts.config);
        configSpinner.succeed('Configuration loaded');
      } catch (err) {
        configSpinner.fail(`Configuration error: ${err}`);
        console.error(chalk.dim('\n  Hint: Run ') + chalk.cyan('hydraclaw init') + chalk.dim(' to create a config file'));
        process.exit(1);
      }

      const logger = createLogger({ name: 'hydraclaw', pretty: true });

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

      if (!opts.quiet) {
        console.log(chalk.dim('\n── Loading Plugins ──────────────────────'));
      }

      // Load providers
      const providerResult = await loadProvidersWithFeedback(config, logger, bus, container, registry, loader);

      // Load channels
      const channelResult = await loadChannelsWithFeedback(config, logger, bus, container, registry, loader);

      // Load tools
      const toolResult = await loadToolsWithFeedback(config, logger, bus, container, registry, loader);

      // Summary
      if (!opts.quiet) {
        console.log(chalk.dim('\n── Plugin Summary ──────────────────────'));
        printLoadSummary('Providers', providerResult);
        printLoadSummary('Channels ', channelResult);
        printLoadSummary('Tools    ', toolResult);
      }

      // Warn if no providers loaded
      if (providerResult.loaded.length === 0) {
        console.log(chalk.yellow('\n  Warning: No AI providers loaded.'));
        console.log(chalk.dim('  The agent needs at least one provider to function.'));
        console.log(chalk.dim('  Run ') + chalk.cyan('hydraclaw setup') + chalk.dim(' for guided configuration.'));
        console.log(chalk.dim('  Or run ') + chalk.cyan('hydraclaw setup ollama') + chalk.dim(' to use a local Ollama instance.\n'));
      }

      // Agent
      const conversationManager = new ConversationManager(sessionStore, config.agent);
      const agent = new Agent(config.agent, registry, conversationManager, logger, bus);

      container.registerInstance('agent', agent);
      container.registerInstance('conversationManager', conversationManager);

      // Security guard (opt-in)
      if (config.security && (config.security as Record<string, unknown>).enabled) {
        const secSpinner = new Spinner('Initializing security guard...');
        secSpinner.start();
        try {
          const { SecurityGuard } = await import('@hydraclaw/security');
          const guard = new SecurityGuard(config.security as Record<string, unknown>, logger, bus);
          await guard.init();
          const toolGuard = guard.getToolExecutionGuard();
          if (toolGuard) {
            agent.setToolGuard(toolGuard);
          }
          secSpinner.succeed('Security guard active');
        } catch (err) {
          secSpinner.warn(`Security module not available: ${err}`);
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
      if (!opts.quiet) {
        console.log(chalk.dim('\n── Starting Services ───────────────────'));
      }

      const gatewaySpinner = new Spinner('Starting gateway server...');
      gatewaySpinner.start();
      const gateway = createGatewayServer(container);
      await gateway.start();
      gatewaySpinner.succeed('Gateway server started');

      // Start all channels
      for (const [, plugin] of registry.channels) {
        const channel = plugin as Channel;
        const chSpinner = new Spinner(`Starting channel: ${chalk.bold(channel.name)}`);
        chSpinner.start();
        try {
          await channel.start();
          chSpinner.succeed(`Channel started: ${chalk.green.bold(channel.name)}`);
          await bus.emit(Events.CHANNEL_CONNECTED, { channelId: channel.id });
        } catch (err) {
          chSpinner.fail(`Channel failed to start: ${chalk.red.bold(channel.name)} - ${err}`);
        }
      }

      // Final ready message
      console.log(chalk.dim('\n── Ready ───────────────────────────────'));
      console.log(chalk.bold.green('\n  HydraClaw is ready!\n'));
      console.log(`  ${chalk.dim('HTTP')}   http://${config.gateway.host}:${config.gateway.port}`);
      console.log(`  ${chalk.dim('WS')}     ws://${config.gateway.host}:${config.gateway.wsPort}`);

      if (providerResult.loaded.length > 0) {
        console.log(`\n  ${chalk.dim('Providers')}  ${providerResult.loaded.map(p => chalk.green(p)).join(', ')}`);
      }
      if (channelResult.loaded.length > 0) {
        console.log(`  ${chalk.dim('Channels')}   ${channelResult.loaded.map(c => chalk.green(c)).join(', ')}`);
      }
      if (toolResult.loaded.length > 0) {
        console.log(`  ${chalk.dim('Tools')}      ${toolResult.loaded.length} loaded`);
      }
      console.log('');

      // Graceful shutdown
      const shutdown = async (signal: string) => {
        console.log(chalk.dim(`\n${signal} received, shutting down gracefully...`));

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

        console.log(chalk.dim('Shutdown complete. Goodbye!'));
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
      let config: HydraClawConfig;
      try {
        config = loadConfig(opts.config);
      } catch (err) {
        console.error(chalk.red(`Config error: ${err}`));
        console.error(chalk.dim('Hint: Run ') + chalk.cyan('hydraclaw init') + chalk.dim(' to create a config file.'));
        process.exit(1);
      }

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
        const available = Object.keys(config.providers);
        if (available.length > 0) {
          console.error(chalk.dim(`Available providers: ${available.join(', ')}`));
        } else {
          console.error(chalk.dim('No providers configured. Run ') + chalk.cyan('hydraclaw setup') + chalk.dim(' first.'));
        }
        process.exit(1);
      }

      const pkg = PROVIDER_PACKAGES[providerId] ?? `@hydraclaw/provider-${providerId}`;
      const provider = await tryImportDefault<AIProvider>(pkg, logger);
      if (!provider) {
        console.error(chalk.red(`Failed to load provider: ${providerId}`));
        console.error(chalk.dim(`Package: ${pkg}`));
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

      // Subscribe to tool events for progress feedback
      let toolCallCount = 0;
      bus.on(Events.TOOL_CALL, (tc: unknown) => {
        toolCallCount++;
        const call = tc as { name: string };
        process.stderr.write(chalk.dim(`  [tool: ${call.name}]\n`));
      });

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
        process.stdout.write(chalk.dim('Thinking...') + '\r');
        let hasOutput = false;

        const result = await agent.run({
          message: inbound,
          provider: provider as AIProvider,
          model: opts.model,
          onStream: (chunk) => {
            if (chunk.type === 'text' && chunk.delta) {
              if (!hasOutput) {
                // Clear the "Thinking..." line
                process.stdout.write('\r' + ' '.repeat(20) + '\r');
                hasOutput = true;
              }
              process.stdout.write(chunk.delta);
            }
          },
        });

        if (!hasOutput) {
          // Clear "Thinking..." and print result
          process.stdout.write('\r' + ' '.repeat(20) + '\r');
          process.stdout.write(result.content);
        }

        if (!result.content.endsWith('\n')) {
          console.log();
        }

        // Show metadata
        const meta: string[] = [`${result.provider}/${result.model}`];
        if (toolCallCount > 0) meta.push(`${toolCallCount} tool call${toolCallCount > 1 ? 's' : ''}`);
        console.log(chalk.dim(`[${meta.join(' | ')}]`));
      } catch (err) {
        const errStr = String(err);
        console.error(chalk.red(`\nError: ${errStr}`));

        // Provide helpful guidance based on common errors
        if (errStr.includes('ECONNREFUSED') || errStr.includes('fetch failed')) {
          console.error(chalk.dim('\nThe provider endpoint is not reachable.'));
          if (providerId === 'ollama') {
            console.error(chalk.dim('Make sure Ollama is running: ') + chalk.cyan('ollama serve'));
          }
        } else if (errStr.includes('401') || errStr.includes('Unauthorized') || errStr.includes('invalid_api_key')) {
          console.error(chalk.dim('\nAuthentication failed. Check your API key in the config.'));
        } else if (errStr.includes('model') && errStr.includes('not found')) {
          console.error(chalk.dim('\nThe specified model was not found.'));
          if (providerId === 'ollama') {
            console.error(chalk.dim('Pull the model first: ') + chalk.cyan(`ollama pull ${opts.model ?? config.agent.defaultModel}`));
          }
        }

        process.exit(1);
      } finally {
        sqliteStore.close();
      }
    });

  // ─── init ───────────────────────────────────────────────────────────
  program
    .command('init')
    .description('Create a new config file with guided setup')
    .option('-o, --output <path>', 'Output path for config file', 'config.yaml')
    .action(async (opts: { output: string }) => {
      console.log(BANNER);
      console.log(chalk.bold('  Welcome to HydraClaw Setup!\n'));

      const outputPath = resolve(process.cwd(), opts.output);

      if (existsSync(outputPath)) {
        const overwrite = await promptUser(`Config file already exists at ${opts.output}. Overwrite? (y/N)`, 'n');
        if (overwrite.toLowerCase() !== 'y') {
          console.log(chalk.dim('Setup cancelled.'));
          return;
        }
      }

      // Step 1: Choose provider
      console.log(chalk.bold('\n  Step 1: Choose your AI provider\n'));
      const providerChoices = [
        'Ollama (local, free, no API key needed)',
        'Anthropic (Claude)',
        'OpenAI (GPT)',
        'Google (Gemini)',
        'LM Studio (local)',
        'Other / configure later',
      ];
      const providerIdx = await promptChoice('Which AI provider do you want to use?', providerChoices, 0);

      const providerMap: Record<number, string> = { 0: 'ollama', 1: 'anthropic', 2: 'openai', 3: 'google', 4: 'lmstudio' };
      const selectedProvider = providerMap[providerIdx] ?? '';

      let providerYaml = '';
      let agentProvider = 'anthropic';
      let agentModel = 'claude-sonnet-4-5-20250929';

      if (selectedProvider === 'ollama') {
        agentProvider = 'ollama';
        agentModel = 'llama3.2';

        // Check if Ollama is running
        const spinner = new Spinner('Checking if Ollama is running...');
        spinner.start();

        const ollamaUrl = 'http://localhost:11434/v1';
        const health = await checkOllamaHealth(ollamaUrl);

        if (health.running) {
          spinner.succeed(`Ollama is running${health.version ? ` (${health.version})` : ''}`);

          if (health.models.length > 0) {
            console.log(chalk.dim(`\n  Available models: ${health.models.join(', ')}`));
            const modelAnswer = await promptUser('Which model do you want to use?', health.models[0]);
            agentModel = modelAnswer;
          } else {
            spinner.info('No models found. Pulling a recommended model...');
            console.log(chalk.dim(`\n  You need to pull a model. Run: `) + chalk.cyan('ollama pull llama3.2'));
            agentModel = 'llama3.2';
          }
        } else {
          spinner.warn('Ollama is not running');
          console.log(chalk.dim('\n  To get started with Ollama:'));
          console.log(chalk.dim('  1. Install Ollama: ') + chalk.cyan('https://ollama.com/download'));
          console.log(chalk.dim('  2. Start Ollama:   ') + chalk.cyan('ollama serve'));
          console.log(chalk.dim('  3. Pull a model:   ') + chalk.cyan('ollama pull llama3.2'));
          console.log(chalk.dim('\n  Your config will be set up for Ollama. Start it before running HydraClaw.'));
        }

        providerYaml = `  ollama:\n    baseUrl: "http://localhost:11434/v1"`;
      } else if (selectedProvider === 'lmstudio') {
        agentProvider = 'lmstudio';
        agentModel = await promptUser('Model name', 'default');
        const lmUrl = await promptUser('LM Studio URL', 'http://localhost:1234/v1');
        providerYaml = `  lmstudio:\n    baseUrl: "${lmUrl}"`;
      } else if (selectedProvider === 'anthropic') {
        agentProvider = 'anthropic';
        agentModel = 'claude-sonnet-4-5-20250929';
        const apiKey = await promptUser('Anthropic API key (or set ANTHROPIC_API_KEY env var)', '${ANTHROPIC_API_KEY}');
        providerYaml = `  anthropic:\n    apiKey: "${apiKey}"`;
      } else if (selectedProvider === 'openai') {
        agentProvider = 'openai';
        agentModel = 'gpt-4o';
        const apiKey = await promptUser('OpenAI API key (or set OPENAI_API_KEY env var)', '${OPENAI_API_KEY}');
        providerYaml = `  openai:\n    apiKey: "${apiKey}"`;
      } else if (selectedProvider === 'google') {
        agentProvider = 'google';
        agentModel = 'gemini-2.0-flash';
        const apiKey = await promptUser('Google API key (or set GOOGLE_API_KEY env var)', '${GOOGLE_API_KEY}');
        providerYaml = `  google:\n    apiKey: "${apiKey}"`;
      } else {
        console.log(chalk.dim('\n  You can configure providers later in config.yaml'));
      }

      // Step 2: Choose tools
      console.log(chalk.bold('\n  Step 2: Select tools\n'));
      const toolChoice = await promptChoice('Which tools do you want to enable?', [
        'All tools (recommended for full functionality)',
        'Safe tools only (filesystem, http, git)',
        'None (configure later)',
      ], 0);

      let toolsYaml = '';
      if (toolChoice === 0) {
        toolsYaml = `  shell:\n    enabled: true\n  filesystem:\n    enabled: true\n  browser:\n    enabled: true\n  http-client:\n    enabled: true\n  scheduler:\n    enabled: true\n  database:\n    enabled: true\n    path: "./data/tools.db"\n  code-runner:\n    enabled: true\n  scraper:\n    enabled: true\n  git:\n    enabled: true\n  docker:\n    enabled: true`;
      } else if (toolChoice === 1) {
        toolsYaml = `  filesystem:\n    enabled: true\n  http-client:\n    enabled: true\n  git:\n    enabled: true`;
      }

      // Step 3: Gateway settings
      console.log(chalk.bold('\n  Step 3: Gateway settings\n'));
      const port = await promptUser('HTTP port', '3000');
      const wsPort = await promptUser('WebSocket port', '3001');

      // Generate config
      const configContent = `# HydraClaw Configuration
# Generated by hydraclaw init

gateway:
  host: "0.0.0.0"
  port: ${port}
  wsPort: ${wsPort}

agent:
  defaultProvider: "${agentProvider}"
  defaultModel: "${agentModel}"
  systemPrompt: "You are HydraClaw, a powerful AI assistant. Help the user with anything they need."
  maxTokens: 8192
  temperature: 0.7
  maxHistory: 100

providers:
${providerYaml || '  # No providers configured yet. Add one to get started.'}

channels:
  # Uncomment and configure channels as needed
  # telegram:
  #   token: "\${TELEGRAM_BOT_TOKEN}"
  # discord:
  #   token: "\${DISCORD_BOT_TOKEN}"

tools:
${toolsYaml || '  # No tools configured. All defaults will be auto-loaded.'}

store:
  path: "./data/hydraclaw.db"
  vectorStore: false
`;

      writeFileSync(outputPath, configContent, 'utf-8');
      console.log(chalk.green(`\n  Config written to ${opts.output}`));

      console.log(chalk.bold('\n  Next steps:\n'));
      if (selectedProvider === 'ollama') {
        console.log(`  1. Make sure Ollama is running: ${chalk.cyan('ollama serve')}`);
        console.log(`  2. Pull your model:             ${chalk.cyan(`ollama pull ${agentModel}`)}`);
        console.log(`  3. Start HydraClaw:             ${chalk.cyan('hydraclaw start')}`);
      } else if (selectedProvider) {
        console.log(`  1. Start HydraClaw: ${chalk.cyan('hydraclaw start')}`);
      } else {
        console.log(`  1. Edit ${chalk.cyan('config.yaml')} to add your provider credentials`);
        console.log(`  2. Start HydraClaw: ${chalk.cyan('hydraclaw start')}`);
      }
      console.log('');
    });

  // ─── setup ollama ──────────────────────────────────────────────────
  const setupCmd = program
    .command('setup')
    .description('Guided setup for providers and configuration');

  setupCmd
    .command('ollama')
    .description('Set up local Ollama provider - auto-detect, connect, and configure')
    .option('-u, --url <url>', 'Ollama server URL', 'http://localhost:11434/v1')
    .option('-m, --model <model>', 'Model to use (auto-detected if not specified)')
    .option('--pull', 'Pull a recommended model if none are available')
    .action(async (opts: { url: string; model?: string; pull?: boolean }) => {
      console.log(BANNER);
      console.log(chalk.bold('  Ollama Setup\n'));
      console.log(chalk.dim('  Setting up local Ollama provider for HydraClaw.\n'));

      // Step 1: Check Ollama connectivity
      console.log(chalk.bold('  Step 1: Checking Ollama connection\n'));
      const spinner = new Spinner('Connecting to Ollama...');
      spinner.start();

      const health = await checkOllamaHealth(opts.url);

      if (!health.running) {
        spinner.fail('Cannot connect to Ollama');
        console.log('');
        console.log(chalk.bold('  Ollama is not running or not reachable.\n'));
        console.log(chalk.dim('  Quick setup guide:\n'));
        console.log(`  ${chalk.bold('Install Ollama')}`);
        console.log(chalk.dim('  macOS / Linux:'));
        console.log(`    ${chalk.cyan('curl -fsSL https://ollama.com/install.sh | sh')}`);
        console.log(chalk.dim('  Or download from:'));
        console.log(`    ${chalk.cyan('https://ollama.com/download')}\n`);
        console.log(`  ${chalk.bold('Start the server')}`);
        console.log(`    ${chalk.cyan('ollama serve')}\n`);
        console.log(`  ${chalk.bold('Then run this setup again')}`);
        console.log(`    ${chalk.cyan('hydraclaw setup ollama')}\n`);

        // Check if maybe it's on a different port
        const altPorts = [11434, 8080, 3000];
        const ollamaHost = new URL(opts.url).hostname;
        for (const port of altPorts) {
          if (opts.url.includes(`:${port}`)) continue;
          const altUrl = `http://${ollamaHost}:${port}/v1`;
          const altHealth = await checkOllamaHealth(altUrl);
          if (altHealth.running) {
            console.log(chalk.yellow(`  Found Ollama running on port ${port} instead!`));
            console.log(`  Run: ${chalk.cyan(`hydraclaw setup ollama --url http://${ollamaHost}:${port}/v1`)}\n`);
            break;
          }
        }

        process.exit(1);
      }

      spinner.succeed(`Connected to Ollama${health.version ? ` (${health.version})` : ''}`);

      // Step 2: Discover models
      console.log(chalk.bold('\n  Step 2: Discovering available models\n'));

      let selectedModel = opts.model;

      if (health.models.length === 0) {
        console.log(chalk.yellow('  No models found locally.'));

        if (opts.pull) {
          console.log(chalk.dim('\n  Pulling recommended model (llama3.2)...\n'));
          console.log(chalk.dim('  This may take a few minutes depending on your internet speed.\n'));
          console.log(`  ${chalk.cyan('ollama pull llama3.2')}\n`);
          console.log(chalk.dim('  After pulling, run this setup again.'));
          process.exit(0);
        }

        console.log(chalk.dim('\n  You need to pull at least one model. Recommended models:\n'));
        console.log(`  ${chalk.bold('General purpose:')}`);
        console.log(`    ${chalk.cyan('ollama pull llama3.2')}        ${chalk.dim('(8B, fast, good all-rounder)')}`);
        console.log(`    ${chalk.cyan('ollama pull mistral')}         ${chalk.dim('(7B, fast, good for chat)')}`);
        console.log(`  ${chalk.bold('Coding:')}`);
        console.log(`    ${chalk.cyan('ollama pull codellama')}       ${chalk.dim('(7B, optimized for code)')}`);
        console.log(`    ${chalk.cyan('ollama pull deepseek-coder')}  ${chalk.dim('(6.7B, strong code model)')}`);
        console.log(`  ${chalk.bold('Vision:')}`);
        console.log(`    ${chalk.cyan('ollama pull llava')}           ${chalk.dim('(7B, understands images)')}\n`);
        console.log(chalk.dim('  After pulling a model, run this setup again.\n'));
        process.exit(0);
      }

      // Display models with details
      console.log(`  Found ${chalk.green(String(health.models.length))} model${health.models.length > 1 ? 's' : ''}:\n`);
      for (const model of health.models) {
        const marker = selectedModel === model ? chalk.green('*') : chalk.dim('-');
        console.log(`  ${marker} ${chalk.bold(model)}`);
      }

      if (!selectedModel) {
        if (health.models.length === 1) {
          selectedModel = health.models[0];
          console.log(chalk.dim(`\n  Auto-selected: ${selectedModel}`));
        } else {
          const answer = await promptUser('\n  Which model do you want to use?', health.models[0]);
          selectedModel = answer;
        }
      }

      // Step 3: Update config
      console.log(chalk.bold('\n  Step 3: Configuring HydraClaw\n'));

      const configPath = resolve(process.cwd(), 'config.yaml');
      const configSpinner = new Spinner('Updating configuration...');
      configSpinner.start();

      if (existsSync(configPath)) {
        // Read existing config and check if ollama is already configured
        const { readFileSync } = await import('node:fs');
        const existingConfig = readFileSync(configPath, 'utf-8');

        if (existingConfig.includes('ollama:') && !existingConfig.includes('# ollama:')) {
          configSpinner.succeed('Ollama already configured in config.yaml');

          // Update model in config if different
          if (selectedModel) {
            const config = loadConfig();
            if (config.agent.defaultModel !== selectedModel || config.agent.defaultProvider !== 'ollama') {
              console.log(chalk.dim(`\n  Updating default provider to ollama and model to ${selectedModel}`));
              let updated = existingConfig;
              updated = updated.replace(
                /defaultProvider:\s*"[^"]*"/,
                `defaultProvider: "ollama"`,
              );
              updated = updated.replace(
                /defaultModel:\s*"[^"]*"/,
                `defaultModel: "${selectedModel}"`,
              );
              writeFileSync(configPath, updated, 'utf-8');
              console.log(chalk.green('  Config updated.'));
            }
          }
        } else {
          // Add Ollama to existing config
          let updated = existingConfig;

          // Uncomment ollama if commented out
          if (existingConfig.includes('# ollama:') || existingConfig.includes('#   baseUrl:')) {
            updated = updated.replace(
              /# +ollama:\n# +baseUrl: +"[^"]*"/,
              `ollama:\n    baseUrl: "${opts.url}"`,
            );
          } else if (existingConfig.includes('providers:')) {
            // Add ollama under providers
            updated = updated.replace(
              /providers:/,
              `providers:\n  ollama:\n    baseUrl: "${opts.url}"`,
            );
          }

          // Update default provider and model
          updated = updated.replace(
            /defaultProvider:\s*"[^"]*"/,
            `defaultProvider: "ollama"`,
          );
          updated = updated.replace(
            /defaultModel:\s*"[^"]*"/,
            `defaultModel: "${selectedModel}"`,
          );

          writeFileSync(configPath, updated, 'utf-8');
          configSpinner.succeed('Configuration updated');
        }
      } else {
        // Create new config
        const configContent = `# HydraClaw Configuration
# Generated by hydraclaw setup ollama

gateway:
  host: "0.0.0.0"
  port: 3000
  wsPort: 3001

agent:
  defaultProvider: "ollama"
  defaultModel: "${selectedModel}"
  systemPrompt: "You are HydraClaw, a powerful AI assistant. Help the user with anything they need."
  maxTokens: 8192
  temperature: 0.7
  maxHistory: 100

providers:
  ollama:
    baseUrl: "${opts.url}"

channels: {}

tools:
  shell:
    enabled: true
  filesystem:
    enabled: true
  http-client:
    enabled: true
  code-runner:
    enabled: true
  git:
    enabled: true

store:
  path: "./data/hydraclaw.db"
  vectorStore: false
`;
        writeFileSync(configPath, configContent, 'utf-8');
        configSpinner.succeed('Configuration created');
      }

      // Step 4: Verify
      console.log(chalk.bold('\n  Step 4: Verification\n'));

      const verifySpinner = new Spinner('Verifying setup...');
      verifySpinner.start();

      // Quick test: check if we can reach the model endpoint
      try {
        const testUrl = opts.url.replace(/\/v1\/?$/, '') + '/api/tags';
        const res = await fetch(testUrl);
        if (res.ok) {
          verifySpinner.succeed('Setup verified - Ollama connection healthy');
        } else {
          verifySpinner.warn('Ollama reachable but returned unexpected status');
        }
      } catch {
        verifySpinner.warn('Could not verify Ollama connection');
      }

      // Done!
      console.log(chalk.bold.green('\n  Ollama setup complete!\n'));

      console.log(`  ${chalk.dim('Provider')}  ollama`);
      console.log(`  ${chalk.dim('Model')}     ${selectedModel}`);
      console.log(`  ${chalk.dim('URL')}       ${opts.url}`);
      console.log(`  ${chalk.dim('Config')}    ${configPath}\n`);

      console.log(chalk.bold('  Start HydraClaw:\n'));
      console.log(`    ${chalk.cyan('hydraclaw start')}\n`);
      console.log(chalk.bold('  Or test with a quick chat:\n'));
      console.log(`    ${chalk.cyan(`hydraclaw chat "Hello, tell me about yourself"`)}\n`);
    });

  // ─── setup (default / guided) ──────────────────────────────────────
  setupCmd
    .action(async () => {
      // Redirect to init
      console.log(chalk.dim('Running guided setup...\n'));
      await program.parseAsync(['', '', 'init']);
    });

  // ─── doctor ─────────────────────────────────────────────────────────
  program
    .command('doctor')
    .description('Check system health and diagnose common issues')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (opts: { config?: string }) => {
      console.log(BANNER);
      console.log(chalk.bold('  System Health Check\n'));

      let issues = 0;
      let warnings = 0;

      // Check config
      const configSpinner = new Spinner('Checking configuration...');
      configSpinner.start();

      let config: HydraClawConfig;
      try {
        config = loadConfig(opts.config);
        configSpinner.succeed('Configuration file found and valid');
      } catch (err) {
        configSpinner.fail(`Configuration error: ${err}`);
        console.log(chalk.dim('  Run ') + chalk.cyan('hydraclaw init') + chalk.dim(' to create one.'));
        issues++;
        return;
      }

      // Check providers
      console.log('');
      const providerCount = Object.keys(config.providers).length;
      if (providerCount === 0) {
        console.log(`${chalk.red('✗')} No providers configured`);
        console.log(chalk.dim('  Add at least one provider to config.yaml'));
        issues++;
      } else {
        console.log(`${chalk.green('✓')} ${providerCount} provider${providerCount > 1 ? 's' : ''} configured`);
      }

      // Check Ollama specifically
      if (config.providers.ollama) {
        const ollamaUrl = (config.providers.ollama.baseUrl as string) ?? 'http://localhost:11434/v1';
        const ollamaSpinner = new Spinner('Checking Ollama connectivity...');
        ollamaSpinner.start();

        const health = await checkOllamaHealth(ollamaUrl);
        if (health.running) {
          ollamaSpinner.succeed(`Ollama is running with ${health.models.length} model${health.models.length !== 1 ? 's' : ''}`);
          if (health.models.length === 0) {
            console.log(chalk.yellow('  ! No models installed. Run: ') + chalk.cyan('ollama pull llama3.2'));
            warnings++;
          }
        } else {
          ollamaSpinner.fail('Ollama is not reachable');
          console.log(chalk.dim(`  Expected at: ${ollamaUrl}`));
          console.log(chalk.dim('  Start with: ') + chalk.cyan('ollama serve'));
          issues++;
        }
      }

      // Check API keys for cloud providers
      const cloudProviders = ['anthropic', 'openai', 'google', 'mistral', 'groq', 'together', 'openrouter', 'deepseek', 'xai', 'perplexity', 'cohere'];
      for (const id of cloudProviders) {
        const pConfig = config.providers[id];
        if (!pConfig || pConfig.enabled === false) continue;

        if (!pConfig.apiKey || pConfig.apiKey === '' || pConfig.apiKey.startsWith('${')) {
          console.log(`${chalk.yellow('!')} ${id}: API key not set or using env var placeholder`);
          warnings++;
        } else {
          console.log(`${chalk.green('✓')} ${id}: API key configured`);
        }
      }

      // Check store path
      const storePath = resolve(process.cwd(), config.store.path);
      const storeDir = resolve(storePath, '..');
      if (!existsSync(storeDir)) {
        console.log(`\n${chalk.yellow('!')} Store directory does not exist: ${storeDir}`);
        console.log(chalk.dim('  It will be created automatically on first run.'));
        warnings++;
      } else {
        console.log(`\n${chalk.green('✓')} Store directory exists`);
      }

      // Check Node version
      const nodeVersion = process.versions.node;
      const major = parseInt(nodeVersion.split('.')[0], 10);
      if (major < 22) {
        console.log(`${chalk.red('✗')} Node.js ${nodeVersion} detected. Requires >= 22.0.0`);
        issues++;
      } else {
        console.log(`${chalk.green('✓')} Node.js ${nodeVersion}`);
      }

      // Summary
      console.log(chalk.dim('\n── Summary ─────────────────────────────\n'));
      if (issues === 0 && warnings === 0) {
        console.log(chalk.bold.green('  Everything looks good!\n'));
      } else {
        if (issues > 0) {
          console.log(chalk.red(`  ${issues} issue${issues > 1 ? 's' : ''} found`));
        }
        if (warnings > 0) {
          console.log(chalk.yellow(`  ${warnings} warning${warnings > 1 ? 's' : ''}`));
        }
        console.log('');
      }
    });

  // ─── config ──────────────────────────────────────────────────────────
  program
    .command('config')
    .description('Show current configuration')
    .option('-c, --config <path>', 'Path to config file')
    .action((opts: { config?: string }) => {
      const config = loadConfig(opts.config);
      console.log(chalk.bold.cyan('\n  HydraClaw Configuration\n'));

      console.log(chalk.bold('  Gateway:'));
      console.log(`    Host: ${config.gateway.host}`);
      console.log(`    Port: ${config.gateway.port}`);
      console.log(`    WS Port: ${config.gateway.wsPort}`);

      console.log(chalk.bold('\n  Agent:'));
      console.log(`    Default Provider: ${chalk.cyan(config.agent.defaultProvider)}`);
      console.log(`    Default Model: ${chalk.cyan(config.agent.defaultModel)}`);
      console.log(`    Max Tokens: ${config.agent.maxTokens}`);
      console.log(`    Temperature: ${config.agent.temperature}`);
      console.log(`    Max History: ${config.agent.maxHistory}`);

      console.log(chalk.bold('\n  Providers:'));
      const providerIds = Object.keys(config.providers);
      if (providerIds.length === 0) {
        console.log(chalk.dim('    (none configured)'));
      } else {
        for (const id of providerIds) {
          const pc = config.providers[id];
          const status = pc.enabled === false ? chalk.red('disabled') : chalk.green('enabled');
          const hasKey = pc.apiKey && pc.apiKey !== '' && !pc.apiKey.startsWith('${') ? chalk.green('key set') : '';
          const isLocal = ['ollama', 'lmstudio', 'vllm'].includes(id) ? chalk.dim('(local)') : '';
          console.log(`    ${id}: ${status} ${hasKey} ${isLocal}`.trimEnd());
        }
      }

      console.log(chalk.bold('\n  Channels:'));
      const channelIds = Object.keys(config.channels);
      if (channelIds.length === 0) {
        console.log(chalk.dim('    (none configured)'));
      } else {
        for (const id of channelIds) {
          const cc = config.channels[id];
          const status = cc.enabled === false ? chalk.red('disabled') : chalk.green('enabled');
          console.log(`    ${id}: ${status}`);
        }
      }

      console.log(chalk.bold('\n  Tools:'));
      const toolIds = Object.keys(config.tools);
      if (toolIds.length === 0) {
        console.log(chalk.dim('    (none configured - defaults will be auto-loaded)'));
      } else {
        for (const id of toolIds) {
          const tc = config.tools[id];
          const status = tc.enabled === false ? chalk.red('disabled') : chalk.green('enabled');
          console.log(`    ${id}: ${status}`);
        }
      }

      console.log(chalk.bold('\n  Store:'));
      console.log(`    Path: ${config.store.path}`);
      console.log(`    Vector Store: ${config.store.vectorStore ? 'enabled' : 'disabled'}`);
      console.log('');
    });

  // ─── status ──────────────────────────────────────────────────────────
  program
    .command('status')
    .description('Show system status (loaded providers, channels, tools)')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (opts: { config?: string }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });

      console.log(chalk.bold.cyan('\n  HydraClaw Status\n'));

      // Check available providers
      console.log(chalk.bold('  Providers:'));
      for (const [id, providerConfig] of Object.entries(config.providers)) {
        const status = providerConfig.enabled === false ? chalk.red('disabled') : chalk.green('configured');
        const isLocal = ['ollama', 'lmstudio', 'vllm'].includes(id);

        if (isLocal) {
          const baseUrl = (providerConfig.baseUrl as string) ?? '';
          if (baseUrl && id === 'ollama') {
            const health = await checkOllamaHealth(baseUrl);
            const connectivity = health.running
              ? chalk.green(`connected, ${health.models.length} models`)
              : chalk.red('not reachable');
            console.log(`    ${id}: ${status} (${connectivity})`);
            continue;
          }
        }

        const hasKey = providerConfig.apiKey && providerConfig.apiKey !== '' && !providerConfig.apiKey.startsWith('${')
          ? chalk.green('key set')
          : chalk.yellow('no key');
        console.log(`    ${id}: ${status} (${hasKey})`);
      }
      if (Object.keys(config.providers).length === 0) {
        console.log(chalk.dim('    (none configured)'));
      }

      // Check available channels
      console.log(chalk.bold('\n  Channels:'));
      for (const [id, channelConfig] of Object.entries(config.channels)) {
        const status = channelConfig.enabled === false ? chalk.red('disabled') : chalk.green('configured');
        console.log(`    ${id}: ${status}`);
      }
      if (Object.keys(config.channels).length === 0) {
        console.log(chalk.dim('    (none configured)'));
      }

      // Check available tools
      console.log(chalk.bold('\n  Tools:'));
      const toolIds = Object.keys(config.tools);
      if (toolIds.length === 0) {
        console.log(chalk.dim('    (defaults will be auto-loaded on start)'));
        for (const [id, pkg] of Object.entries(TOOL_PACKAGES)) {
          const available = await tryImportDefault(pkg, logger);
          const status = available ? chalk.green('available') : chalk.dim('not installed');
          console.log(`    ${id}: ${status}`);
        }
      } else {
        for (const [id, toolConfig] of Object.entries(config.tools)) {
          const status = toolConfig.enabled === false ? chalk.red('disabled') : chalk.green('configured');
          console.log(`    ${id}: ${status}`);
        }
      }

      console.log(chalk.bold('\n  Gateway:'));
      console.log(`    HTTP: http://${config.gateway.host}:${config.gateway.port}`);
      console.log(`    WS:   ws://${config.gateway.host}:${config.gateway.wsPort}`);

      console.log(chalk.bold('\n  Store:'));
      console.log(`    Path: ${resolve(process.cwd(), config.store.path)}`);
      console.log('');
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
        const available = Object.keys(config.channels);
        if (available.length > 0) {
          console.error(chalk.dim(`Available channels: ${available.join(', ')}`));
        }
        process.exit(1);
      }

      const pkg = CHANNEL_PACKAGES[opts.channel] ?? `@hydraclaw/channel-${opts.channel}`;
      const channel = await tryImportDefault<Channel>(pkg, logger);
      if (!channel) {
        console.error(chalk.red(`Failed to load channel: ${opts.channel}`));
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
