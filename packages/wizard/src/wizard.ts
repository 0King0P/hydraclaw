import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { stringify as yamlStringify } from 'yaml';
import { createLogger } from '@hydraclaw/core';
import type { HydraClawConfig, GatewayConfig, ToolConfig } from '@hydraclaw/core';
import { showBanner, askText, askConfirm, askMultiSelect, askSelect } from './prompts.js';
import type { WizardStep, WizardContext } from './steps.js';
import { ProviderStep, ChannelStep, SecurityStep } from './steps.js';

const logger = createLogger({ name: 'wizard' });

const MIN_NODE_VERSION = 18;

// ---------------------------------------------------------------------------
// Tool catalog for the configureTools step
// ---------------------------------------------------------------------------

interface ToolChoice {
  name: string;
  value: string;
  description: string;
  dangerous: boolean;
}

const AVAILABLE_TOOLS: ToolChoice[] = [
  { name: 'Web Search', value: 'web-search', description: 'Search the web with multiple engines', dangerous: false },
  { name: 'Web Scraper', value: 'web-scraper', description: 'Fetch and parse web pages', dangerous: false },
  { name: 'Image Generation', value: 'image-gen', description: 'Generate images via DALL-E / Stable Diffusion', dangerous: false },
  { name: 'Code Interpreter', value: 'code-runner', description: 'Execute code in a sandboxed environment', dangerous: true },
  { name: 'Shell Execution', value: 'shell', description: 'Run shell commands (DANGEROUS)', dangerous: true },
  { name: 'File Manager', value: 'file-manager', description: 'Read and write files on the host system', dangerous: true },
  { name: 'Database Query', value: 'database', description: 'Execute SQL queries against configured databases', dangerous: true },
  { name: 'HTTP Client', value: 'http-client', description: 'Make arbitrary HTTP requests', dangerous: false },
  { name: 'Calculator', value: 'calculator', description: 'Evaluate mathematical expressions', dangerous: false },
  { name: 'Memory / Knowledge Base', value: 'memory', description: 'Store and retrieve long-term memories', dangerous: false },
];

// ---------------------------------------------------------------------------
// OnboardingWizard
// ---------------------------------------------------------------------------

export class OnboardingWizard {
  private steps: WizardStep[];
  private ctx: WizardContext;

  constructor(workDir?: string) {
    const resolvedWorkDir = workDir ?? process.cwd();

    this.ctx = {
      config: {},
      workDir: resolvedWorkDir,
      installDaemon: false,
    };

    this.steps = [
      new ProviderStep(),
      new ChannelStep(),
      new SecurityStep(),
    ];
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Main entry point: runs through every onboarding step in order.
   */
  async run(): Promise<void> {
    showBanner();

    logger.info('Starting onboarding wizard');

    if (!(await this.checkPrerequisites())) {
      return;
    }

    await this.configureGateway();

    for (const step of this.steps) {
      console.log(`\n  === Step: ${step.title} ===`);
      console.log(`  ${step.description}\n`);

      const shouldContinue = await step.run(this.ctx);
      if (!shouldContinue) {
        console.log('\n  Wizard aborted.');
        return;
      }
    }

    await this.configureTools();
    await this.writeConfig();
    await this.installDaemon();

    console.log('\n  ============================================');
    console.log('  HydraClaw setup complete!');
    console.log('  ============================================');
    console.log(`\n  Your configuration has been written.`);
    console.log('  Run `hydraclaw start` to launch the gateway.\n');
  }

  // -----------------------------------------------------------------------
  // Step: Check Prerequisites
  // -----------------------------------------------------------------------

  /**
   * Verify Node.js version and ensure necessary data directories exist.
   */
  async checkPrerequisites(): Promise<boolean> {
    console.log('  Checking prerequisites...\n');

    // Check Node version
    const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
    if (nodeVersion < MIN_NODE_VERSION) {
      console.error(
        `  Error: Node.js v${MIN_NODE_VERSION}+ is required (found v${process.versions.node}).`,
      );
      console.error('  Please upgrade Node.js and try again.');
      return false;
    }
    console.log(`  Node.js v${process.versions.node} - OK`);

    // Ensure data directories exist
    const dataDir = resolve(homedir(), '.hydraclaw');
    const dirs = [dataDir, resolve(dataDir, 'data'), resolve(dataDir, 'logs')];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        console.log(`  Created directory: ${dir}`);
      }
    }
    console.log('  Data directories - OK\n');

    return true;
  }

  // -----------------------------------------------------------------------
  // Step: Configure Gateway
  // -----------------------------------------------------------------------

  /**
   * Prompt the user for gateway host/port settings.
   */
  async configureGateway(): Promise<void> {
    console.log('\n  === Step: Gateway Configuration ===');
    console.log('  Configure the HTTP and WebSocket server.\n');

    const host = await askText('Gateway host:', { defaultValue: '0.0.0.0' });

    const portStr = await askText('Gateway HTTP port:', {
      defaultValue: '3000',
      validate: (val) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 1 || n > 65535) return 'Port must be between 1 and 65535.';
        return true;
      },
    });

    const wsPortStr = await askText('Gateway WebSocket port:', {
      defaultValue: '3001',
      validate: (val) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 1 || n > 65535) return 'Port must be between 1 and 65535.';
        return true;
      },
    });

    const gatewayConfig: GatewayConfig = {
      host,
      port: parseInt(portStr, 10),
      wsPort: parseInt(wsPortStr, 10),
    };

    this.ctx.config.gateway = gatewayConfig;
  }

  // -----------------------------------------------------------------------
  // Step: Configure Providers (delegated to ProviderStep)
  // -----------------------------------------------------------------------

  /**
   * Walk user through API key setup for each selected provider.
   * This is handled by the ProviderStep in the steps array, but exposed
   * as a public method for programmatic use.
   */
  async configureProviders(): Promise<void> {
    const step = this.steps.find((s) => s.id === 'providers');
    if (step) {
      await step.run(this.ctx);
    }
  }

  // -----------------------------------------------------------------------
  // Step: Configure Channels (delegated to ChannelStep)
  // -----------------------------------------------------------------------

  /**
   * Set up messaging channel integrations.
   * Delegated to the ChannelStep in the steps array.
   */
  async configureChannels(): Promise<void> {
    const step = this.steps.find((s) => s.id === 'channels');
    if (step) {
      await step.run(this.ctx);
    }
  }

  // -----------------------------------------------------------------------
  // Step: Configure Tools
  // -----------------------------------------------------------------------

  /**
   * Enable or disable tools, with clear security warnings for dangerous ones.
   */
  async configureTools(): Promise<void> {
    console.log('\n  === Step: Tool Configuration ===');
    console.log('  Choose which tools the AI agent can use.\n');

    const selected = await askMultiSelect<string>(
      'Select tools to enable:',
      AVAILABLE_TOOLS.map((t) => ({
        name: t.dangerous ? `${t.name} [DANGEROUS]` : t.name,
        value: t.value,
        description: t.description,
        checked: !t.dangerous,
      })),
    );

    // Warn about dangerous tools
    const dangerousSelected = selected.filter((id) =>
      AVAILABLE_TOOLS.find((t) => t.value === id)?.dangerous,
    );

    if (dangerousSelected.length > 0) {
      console.log('\n  ============================================');
      console.log('  WARNING: You have selected dangerous tools!');
      console.log('  ============================================');
      console.log('  The following tools can execute arbitrary code,');
      console.log('  access the filesystem, or modify your system:\n');

      for (const id of dangerousSelected) {
        const tool = AVAILABLE_TOOLS.find((t) => t.value === id)!;
        console.log(`    - ${tool.name}: ${tool.description}`);
      }

      console.log('');
      const confirmDangerous = await askConfirm(
        'Are you sure you want to enable these dangerous tools?',
        false,
      );

      if (!confirmDangerous) {
        // Remove dangerous tools from selection
        const safeSelected = selected.filter(
          (id) => !AVAILABLE_TOOLS.find((t) => t.value === id)?.dangerous,
        );
        const tools: Record<string, ToolConfig> = {};
        for (const id of safeSelected) {
          tools[id] = { enabled: true };
        }
        this.ctx.config.tools = tools;
        console.log('  Dangerous tools have been removed from the selection.');
        return;
      }
    }

    const tools: Record<string, ToolConfig> = {};
    for (const id of selected) {
      tools[id] = { enabled: true };
    }
    this.ctx.config.tools = tools;
  }

  // -----------------------------------------------------------------------
  // Step: Configure Security (delegated to SecurityStep)
  // -----------------------------------------------------------------------

  /**
   * Set up security options (injection detection, policies, rate limiting).
   * Delegated to the SecurityStep in the steps array.
   */
  async configureSecurity(): Promise<void> {
    const step = this.steps.find((s) => s.id === 'security');
    if (step) {
      await step.run(this.ctx);
    }
  }

  // -----------------------------------------------------------------------
  // Step: Write Config
  // -----------------------------------------------------------------------

  /**
   * Write the accumulated configuration to a config.yaml file.
   */
  async writeConfig(): Promise<void> {
    console.log('\n  === Step: Write Configuration ===\n');

    const defaultPath = resolve(this.ctx.workDir, 'config.yaml');
    const configPath = await askText('Config file path:', { defaultValue: defaultPath });

    // Build the final config
    const finalConfig: Partial<HydraClawConfig> = {
      gateway: this.ctx.config.gateway ?? {
        host: '0.0.0.0',
        port: 3000,
        wsPort: 3001,
      },
      agent: this.ctx.config.agent ?? {
        defaultProvider: 'anthropic',
        defaultModel: 'claude-sonnet-4-5-20250929',
        systemPrompt: 'You are a helpful AI assistant.',
        maxTokens: 8192,
        temperature: 0.7,
        maxHistory: 100,
      },
      providers: this.ctx.config.providers ?? {},
      channels: this.ctx.config.channels ?? {},
      tools: this.ctx.config.tools ?? {},
      store: {
        path: './data/hydraclaw.db',
        vectorStore: false,
      },
    };

    if (this.ctx.config.security) {
      (finalConfig as Record<string, unknown>).security = this.ctx.config.security;
    }

    const yamlContent = yamlStringify(finalConfig, {
      indent: 2,
      lineWidth: 120,
    });

    // Ensure directory exists
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Check for existing file
    if (existsSync(configPath)) {
      const overwrite = await askConfirm(
        `File ${configPath} already exists. Overwrite?`,
        false,
      );
      if (!overwrite) {
        console.log('  Skipping config write. You can save manually.');
        console.log(`\n  Generated YAML:\n\n${yamlContent}`);
        return;
      }
    }

    writeFileSync(configPath, yamlContent, 'utf-8');
    console.log(`\n  Configuration written to: ${configPath}`);
    logger.info('Config written to %s', configPath);
  }

  // -----------------------------------------------------------------------
  // Step: Install Daemon
  // -----------------------------------------------------------------------

  /**
   * Optionally set up the daemon for running HydraClaw as a background service.
   */
  async installDaemon(): Promise<void> {
    console.log('\n  === Step: Daemon Setup ===\n');

    const install = await askConfirm(
      'Would you like to set up HydraClaw to run as a background daemon?',
      false,
    );

    this.ctx.installDaemon = install;

    if (!install) {
      console.log('  Skipping daemon setup. You can set it up later with `hydraclaw daemon install`.');
      return;
    }

    const autoStart = await askConfirm(
      'Start the daemon automatically on system boot?',
      false,
    );

    const healthCheck = await askConfirm(
      'Enable watchdog health monitoring (auto-restart on crash)?',
      true,
    );

    const healthIntervalStr = healthCheck
      ? await askText('Health check interval (seconds):', {
          defaultValue: '30',
          validate: (val) => {
            const n = parseInt(val, 10);
            if (isNaN(n) || n < 5) return 'Interval must be at least 5 seconds.';
            return true;
          },
        })
      : '30';

    const daemonConfig = {
      enabled: true,
      autoStart,
      healthCheck: {
        enabled: healthCheck,
        intervalSeconds: parseInt(healthIntervalStr, 10),
      },
    };

    console.log('\n  Daemon configuration:');
    console.log(`    Auto-start:    ${autoStart ? 'Yes' : 'No'}`);
    console.log(`    Health check:  ${healthCheck ? `Every ${healthIntervalStr}s` : 'Disabled'}`);

    // Store daemon config for later use
    const daemonConfigPath = resolve(homedir(), '.hydraclaw', 'daemon.json');
    const dir = dirname(daemonConfigPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(daemonConfigPath, JSON.stringify(daemonConfig, null, 2), 'utf-8');
    console.log(`\n  Daemon config written to: ${daemonConfigPath}`);
    logger.info('Daemon config written to %s', daemonConfigPath);
  }
}
