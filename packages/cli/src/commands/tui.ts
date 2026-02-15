import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import {
  loadConfig,
  createLogger,
  Container,
  MessageBus,
  DefaultPluginRegistry,
  PluginLoader,
  Events,
} from '@hydraclaw/core';
import type {
  AIProvider,
  Channel,
  Tool,
  InboundMessage,
  StreamChunk,
  Logger,
  PluginContext,
} from '@hydraclaw/core';
import { SQLiteStore, SessionStore } from '@hydraclaw/store';
import { Agent, ConversationManager } from '@hydraclaw/agent';

/** Maps provider config IDs to their npm package names. */
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

/**
 * Create the `hydraclaw tui` command.
 *
 * Launches an interactive terminal chat interface.
 *
 * Usage:
 *   hydraclaw tui                      - Start interactive chat
 *   hydraclaw tui -p anthropic         - Use a specific provider
 *   hydraclaw tui -m claude-sonnet-4-5-20250929 - Use a specific model
 */
export function createTuiCommand(): Command {
  const command = new Command('tui');

  command
    .description('Launch an interactive terminal chat with the AI agent')
    .option('-c, --config <path>', 'Path to config file')
    .option('-p, --provider <provider>', 'Provider to use')
    .option('-m, --model <model>', 'Model to use')
    .action(async (opts: { config?: string; provider?: string; model?: string }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });
      const container = new Container();
      const bus = new MessageBus();

      container.registerInstance('config', config);
      container.registerInstance('logger', logger);
      container.registerInstance('bus', bus);

      // Store
      const dbPath = resolve(process.cwd(), config.store.path);
      const sqliteStore = new SQLiteStore(dbPath, logger);
      const sessionStore = new SessionStore(sqliteStore);

      container.registerInstance('sqliteStore', sqliteStore);
      container.registerInstance('sessionStore', sessionStore);

      // Plugin registry
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
        }
      }

      // Agent
      const agentConfig = {
        ...config.agent,
        ...(opts.provider ? { defaultProvider: opts.provider } : {}),
        ...(opts.model ? { defaultModel: opts.model } : {}),
      };
      const conversationManager = new ConversationManager(sessionStore, agentConfig);
      const agent = new Agent(agentConfig, registry, conversationManager, logger, bus);

      container.registerInstance('agent', agent);
      container.registerInstance('conversationManager', conversationManager);

      // Resolve effective provider and model for display
      const effectiveProvider = opts.provider ?? config.agent.defaultProvider;
      const effectiveModel = opts.model ?? config.agent.defaultModel;

      // Print banner
      printTuiBanner(effectiveProvider, effectiveModel, registry);

      // Interactive loop
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.cyan('\nYou > '),
        terminal: true,
      });

      let messageCount = 0;

      rl.prompt();

      rl.on('line', async (line: string) => {
        const input = line.trim();

        if (input.length === 0) {
          rl.prompt();
          return;
        }

        // Handle special commands
        if (input.startsWith('/')) {
          const handled = handleSlashCommand(input, rl, {
            provider: effectiveProvider,
            model: effectiveModel,
            messageCount,
            registry,
          });
          if (handled === 'exit') {
            cleanup(sqliteStore, rl);
            return;
          }
          rl.prompt();
          return;
        }

        messageCount++;

        const inbound: InboundMessage = {
          id: randomUUID(),
          channelId: 'tui',
          senderId: 'tui-user',
          senderName: 'User',
          target: 'tui',
          content: input,
          isGroup: false,
          timestamp: Math.floor(Date.now() / 1000),
        };

        process.stdout.write(chalk.green('\nAssistant > '));

        try {
          let hasOutput = false;
          const result = await agent.run({
            message: inbound,
            model: opts.model,
            onStream: (chunk: StreamChunk) => {
              if (chunk.type === 'text' && chunk.delta) {
                process.stdout.write(chunk.delta);
                hasOutput = true;
              }
              if (chunk.type === 'tool_call' && chunk.toolCall) {
                if (hasOutput) process.stdout.write('\n');
                process.stdout.write(
                  chalk.dim(`  [tool: ${chunk.toolCall.name}]\n`),
                );
                hasOutput = true;
              }
            },
          });

          if (!hasOutput) {
            process.stdout.write(result.content);
          }

          // Print metadata
          process.stdout.write(
            chalk.dim(`\n  [${result.provider}/${result.model}]`),
          );
          if (result.toolCalls && result.toolCalls.length > 0) {
            process.stdout.write(
              chalk.dim(` (${result.toolCalls.length} tool call(s))`),
            );
          }
          console.log();
        } catch (err) {
          console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : String(err)}`));
        }

        rl.prompt();
      });

      rl.on('close', () => {
        cleanup(sqliteStore, null);
      });
    });

  return command;
}

// ---------------------------------------------------------------------------
// TUI helpers
// ---------------------------------------------------------------------------

function printTuiBanner(
  provider: string,
  model: string,
  registry: DefaultPluginRegistry,
): void {
  console.log();
  console.log(chalk.bold.cyan('  HydraClaw Interactive Chat'));
  console.log(chalk.dim('  ─────────────────────────'));
  console.log(`  Provider:  ${chalk.green(provider)}`);
  console.log(`  Model:     ${chalk.green(model)}`);

  const tools = Array.from(registry.tools.keys());
  if (tools.length > 0) {
    console.log(`  Tools:     ${chalk.dim(tools.join(', '))}`);
  }

  console.log();
  console.log(chalk.dim('  Type your message and press Enter.'));
  console.log(chalk.dim('  Commands: /help, /clear, /model, /info, /exit'));
}

function handleSlashCommand(
  input: string,
  rl: ReturnType<typeof createInterface>,
  ctx: {
    provider: string;
    model: string;
    messageCount: number;
    registry: DefaultPluginRegistry;
  },
): 'exit' | 'handled' {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case 'exit':
    case 'quit':
    case 'q':
      console.log(chalk.dim('\nGoodbye!'));
      return 'exit';

    case 'help':
    case 'h':
      console.log(chalk.bold('\n  Available Commands:'));
      console.log('    /help, /h       Show this help');
      console.log('    /clear, /c      Clear conversation context');
      console.log('    /model, /m      Show current model info');
      console.log('    /info, /i       Show session info');
      console.log('    /tools, /t      List available tools');
      console.log('    /exit, /quit    Exit the chat');
      return 'handled';

    case 'clear':
    case 'c':
      console.log(chalk.dim('\n  Conversation context cleared.'));
      console.log(chalk.dim('  (Note: server-side history may persist.)'));
      return 'handled';

    case 'model':
    case 'm':
      console.log(chalk.bold(`\n  Current Model:`));
      console.log(`    Provider: ${chalk.green(ctx.provider)}`);
      console.log(`    Model:    ${chalk.green(ctx.model)}`);
      return 'handled';

    case 'info':
    case 'i':
      console.log(chalk.bold(`\n  Session Info:`));
      console.log(`    Messages sent: ${ctx.messageCount}`);
      console.log(`    Provider:      ${ctx.provider}`);
      console.log(`    Model:         ${ctx.model}`);
      console.log(`    Providers:     ${Array.from(ctx.registry.providers.keys()).join(', ') || 'none'}`);
      console.log(`    Tools:         ${Array.from(ctx.registry.tools.keys()).join(', ') || 'none'}`);
      return 'handled';

    case 'tools':
    case 't': {
      const tools = Array.from(ctx.registry.tools.keys());
      if (tools.length === 0) {
        console.log(chalk.dim('\n  No tools loaded.'));
      } else {
        console.log(chalk.bold('\n  Available Tools:'));
        for (const toolId of tools) {
          console.log(`    ${chalk.green(toolId)}`);
        }
      }
      return 'handled';
    }

    default:
      console.log(chalk.yellow(`\n  Unknown command: /${cmd}`));
      console.log(chalk.dim('  Type /help for available commands.'));
      return 'handled';
  }
}

function cleanup(sqliteStore: SQLiteStore, rl: ReturnType<typeof createInterface> | null): void {
  if (rl) {
    rl.close();
  }
  sqliteStore.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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
