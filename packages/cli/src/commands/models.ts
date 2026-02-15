import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadConfig,
  createLogger,
  Container,
  MessageBus,
  DefaultPluginRegistry,
  PluginLoader,
} from '@hydraclaw/core';
import type {
  AIProvider,
  ModelInfo,
  Logger,
  PluginContext,
} from '@hydraclaw/core';

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

/**
 * Create the `hydraclaw models` command group.
 *
 * Subcommands:
 *   hydraclaw models list          - List all available models across providers
 *   hydraclaw models info <model>  - Show model details
 *   hydraclaw models test <model>  - Test a model with a sample prompt
 *   hydraclaw models cost          - Show cost comparison
 */
export function createModelsCommand(): Command {
  const command = new Command('models');
  command.description('Manage and inspect AI models');

  // ─── list ───────────────────────────────────────────────────────────
  command
    .command('list')
    .description('List all available models across configured providers')
    .option('-c, --config <path>', 'Path to config file')
    .option('-p, --provider <provider>', 'Filter by provider')
    .option('--json', 'Output as JSON')
    .action(async (opts: { config?: string; provider?: string; json?: boolean }) => {
      const { logger, registry } = await loadProviders(opts.config, opts.provider);
      const models = collectModels(registry, opts.provider);

      if (models.length === 0) {
        console.log(chalk.yellow('No models found. Check your provider configuration.'));
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(models, null, 2));
        return;
      }

      console.log(chalk.bold.cyan('\nAvailable Models\n'));

      // Group by provider
      const byProvider = new Map<string, ModelInfo[]>();
      for (const model of models) {
        const group = byProvider.get(model.provider) ?? [];
        group.push(model);
        byProvider.set(model.provider, group);
      }

      for (const [providerId, providerModels] of byProvider) {
        console.log(chalk.bold(`  ${providerId}:`));
        for (const m of providerModels) {
          const features: string[] = [];
          if (m.supportsVision) features.push('vision');
          if (m.supportsTools) features.push('tools');
          if (m.supportsStreaming) features.push('streaming');
          const featureStr = features.length > 0 ? chalk.dim(` [${features.join(', ')}]`) : '';
          const ctx = m.contextWindow ? chalk.dim(` (${formatTokens(m.contextWindow)} ctx)`) : '';
          console.log(`    ${chalk.green(m.id)}${ctx}${featureStr}`);
        }
        console.log();
      }

      console.log(chalk.dim(`  Total: ${models.length} model(s) across ${byProvider.size} provider(s)`));
    });

  // ─── info ───────────────────────────────────────────────────────────
  command
    .command('info <model>')
    .description('Show detailed information about a specific model')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (modelId: string, opts: { config?: string }) => {
      const { registry } = await loadProviders(opts.config);
      const models = collectModels(registry);
      const model = models.find((m) => m.id === modelId);

      if (!model) {
        console.error(chalk.red(`Model "${modelId}" not found.`));
        console.error(chalk.dim('Run `hydraclaw models list` to see available models.'));
        process.exit(1);
      }

      console.log(chalk.bold.cyan(`\nModel: ${model.id}\n`));
      console.log(`  Name:            ${model.name}`);
      console.log(`  Provider:        ${model.provider}`);
      console.log(`  Context Window:  ${formatTokens(model.contextWindow)}`);
      if (model.maxOutputTokens) {
        console.log(`  Max Output:      ${formatTokens(model.maxOutputTokens)}`);
      }
      console.log(`  Vision:          ${model.supportsVision ? chalk.green('yes') : chalk.dim('no')}`);
      console.log(`  Tools:           ${model.supportsTools ? chalk.green('yes') : chalk.dim('no')}`);
      console.log(`  Streaming:       ${model.supportsStreaming ? chalk.green('yes') : chalk.dim('no')}`);
      if (model.inputCostPer1M !== undefined) {
        console.log(`  Input Cost:      $${model.inputCostPer1M.toFixed(2)} / 1M tokens`);
      }
      if (model.outputCostPer1M !== undefined) {
        console.log(`  Output Cost:     $${model.outputCostPer1M.toFixed(2)} / 1M tokens`);
      }
    });

  // ─── test ───────────────────────────────────────────────────────────
  command
    .command('test <model>')
    .description('Test a model with a sample prompt')
    .option('-c, --config <path>', 'Path to config file')
    .option('--prompt <prompt>', 'Custom test prompt', 'Say "Hello from HydraClaw!" in exactly those words.')
    .action(async (modelId: string, opts: { config?: string; prompt: string }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });
      const container = new Container();
      const bus = new MessageBus();

      container.registerInstance('config', config);
      container.registerInstance('logger', logger);
      container.registerInstance('bus', bus);

      const registry = new DefaultPluginRegistry();
      const loader = new PluginLoader(logger, registry);

      // Load all enabled providers
      for (const [id, providerConfig] of Object.entries(config.providers)) {
        if (providerConfig.enabled === false) continue;
        const pkg = PROVIDER_PACKAGES[id] ?? `@hydraclaw/provider-${id}`;
        const provider = await tryImportDefault<AIProvider>(pkg, logger);
        if (provider) {
          const ctx = createPluginContext(providerConfig as Record<string, unknown>, logger, bus, container);
          await loader.loadPlugin(provider, ctx);
        }
      }

      // Find the model
      const models = collectModels(registry);
      const model = models.find((m) => m.id === modelId);
      if (!model) {
        console.error(chalk.red(`Model "${modelId}" not found.`));
        process.exit(1);
      }

      // Find the provider
      const provider = registry.getProvider(model.provider) as AIProvider | undefined;
      if (!provider) {
        console.error(chalk.red(`Provider "${model.provider}" not available.`));
        process.exit(1);
      }

      console.log(chalk.cyan(`Testing ${modelId} via ${model.provider}...`));
      console.log(chalk.dim(`Prompt: "${opts.prompt}"\n`));

      const start = Date.now();

      try {
        const result = await provider.complete({
          model: modelId,
          messages: [{ role: 'user', content: opts.prompt }],
          maxTokens: 256,
          temperature: 0.7,
        });

        const elapsed = Date.now() - start;

        console.log(chalk.green('Response:'));
        console.log(`  ${result.content}\n`);
        console.log(chalk.dim(`  Model:    ${result.model}`));
        console.log(chalk.dim(`  Tokens:   ${result.usage.promptTokens} in / ${result.usage.completionTokens} out`));
        console.log(chalk.dim(`  Latency:  ${elapsed}ms`));
        console.log(chalk.dim(`  Reason:   ${result.finishReason}`));
      } catch (err) {
        console.error(chalk.red(`Test failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  // ─── cost ───────────────────────────────────────────────────────────
  command
    .command('cost')
    .description('Show cost comparison for all available models')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (opts: { config?: string }) => {
      const { registry } = await loadProviders(opts.config);
      const models = collectModels(registry).filter(
        (m) => m.inputCostPer1M !== undefined || m.outputCostPer1M !== undefined,
      );

      if (models.length === 0) {
        console.log(chalk.yellow('No models with cost information found.'));
        return;
      }

      // Sort by input cost
      models.sort((a, b) => (a.inputCostPer1M ?? Infinity) - (b.inputCostPer1M ?? Infinity));

      console.log(chalk.bold.cyan('\nModel Cost Comparison\n'));
      console.log(
        chalk.bold(
          `  ${'Model'.padEnd(40)} ${'Provider'.padEnd(14)} ${'Input $/1M'.padStart(12)} ${'Output $/1M'.padStart(12)}`,
        ),
      );
      console.log(chalk.dim(`  ${'─'.repeat(40)} ${'─'.repeat(14)} ${'─'.repeat(12)} ${'─'.repeat(12)}`));

      for (const m of models) {
        const inputCost = m.inputCostPer1M !== undefined ? `$${m.inputCostPer1M.toFixed(2)}` : '-';
        const outputCost = m.outputCostPer1M !== undefined ? `$${m.outputCostPer1M.toFixed(2)}` : '-';
        console.log(
          `  ${m.id.padEnd(40)} ${m.provider.padEnd(14)} ${inputCost.padStart(12)} ${outputCost.padStart(12)}`,
        );
      }

      console.log(chalk.dim(`\n  ${models.length} model(s) with pricing data`));
    });

  return command;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadProviders(
  configPath?: string,
  filterProvider?: string,
): Promise<{ logger: Logger; registry: DefaultPluginRegistry }> {
  const config = loadConfig(configPath);
  const logger = createLogger({ name: 'hydraclaw', level: 'warn' });
  const container = new Container();
  const bus = new MessageBus();

  container.registerInstance('config', config);
  container.registerInstance('logger', logger);
  container.registerInstance('bus', bus);

  const registry = new DefaultPluginRegistry();
  const loader = new PluginLoader(logger, registry);

  for (const [id, providerConfig] of Object.entries(config.providers)) {
    if (providerConfig.enabled === false) continue;
    if (filterProvider && id !== filterProvider) continue;
    const pkg = PROVIDER_PACKAGES[id] ?? `@hydraclaw/provider-${id}`;
    const provider = await tryImportDefault<AIProvider>(pkg, logger);
    if (provider) {
      const ctx = createPluginContext(providerConfig as Record<string, unknown>, logger, bus, container);
      await loader.loadPlugin(provider, ctx);
    }
  }

  return { logger, registry };
}

function collectModels(registry: DefaultPluginRegistry, filterProvider?: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const [id, plugin] of registry.providers) {
    if (filterProvider && id !== filterProvider) continue;
    const provider = plugin as AIProvider;
    try {
      models.push(...provider.models());
    } catch {
      // Skip providers that don't support model listing
    }
  }
  return models;
}

function createPluginContext(
  config: Record<string, unknown>,
  logger: Logger,
  bus: MessageBus,
  container: Container,
): PluginContext {
  return { config, logger, bus, container };
}

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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
