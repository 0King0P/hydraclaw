import type { HydraClawConfig, ProviderConfig, ChannelConfig, ToolConfig } from '@hydraclaw/core';
import {
  askOptionalApiKey,
  askMultiSelect,
  askText,
  askConfirm,
  askSelect,
  askApiKey,
} from './prompts.js';

// ---------------------------------------------------------------------------
// WizardContext -- mutable state accumulated across steps
// ---------------------------------------------------------------------------

export interface WizardContext {
  /** The config object being built up throughout the wizard. */
  config: Partial<HydraClawConfig>;
  /** Working directory for data / config file output. */
  workDir: string;
  /** Whether the user wants to install the daemon at the end. */
  installDaemon: boolean;
}

// ---------------------------------------------------------------------------
// WizardStep interface
// ---------------------------------------------------------------------------

export interface WizardStep {
  /** Unique identifier for the step. */
  id: string;
  /** Human-readable title shown in the wizard progress. */
  title: string;
  /** Short description of what this step does. */
  description: string;
  /** Execute the step, mutating the context as needed. Returns `true` to continue, `false` to abort. */
  run(ctx: WizardContext): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// ProviderStep
// ---------------------------------------------------------------------------

interface ProviderChoice {
  name: string;
  value: string;
  envVar: string;
  description: string;
}

const AVAILABLE_PROVIDERS: ProviderChoice[] = [
  { name: 'Anthropic (Claude)', value: 'anthropic', envVar: 'ANTHROPIC_API_KEY', description: 'Claude models from Anthropic' },
  { name: 'OpenAI (GPT)', value: 'openai', envVar: 'OPENAI_API_KEY', description: 'GPT models from OpenAI' },
  { name: 'OpenRouter', value: 'openrouter', envVar: 'OPENROUTER_API_KEY', description: 'Multi-provider routing via OpenRouter' },
  { name: 'Google (Gemini)', value: 'google', envVar: 'GOOGLE_API_KEY', description: 'Gemini models from Google' },
  { name: 'Mistral', value: 'mistral', envVar: 'MISTRAL_API_KEY', description: 'Models from Mistral AI' },
  { name: 'Groq', value: 'groq', envVar: 'GROQ_API_KEY', description: 'Ultra-fast inference via Groq' },
  { name: 'Together AI', value: 'together', envVar: 'TOGETHER_API_KEY', description: 'Open-source models via Together' },
  { name: 'Cohere', value: 'cohere', envVar: 'COHERE_API_KEY', description: 'Cohere Command models' },
  { name: 'DeepSeek', value: 'deepseek', envVar: 'DEEPSEEK_API_KEY', description: 'DeepSeek models' },
  { name: 'xAI (Grok)', value: 'xai', envVar: 'XAI_API_KEY', description: 'Grok models from xAI' },
  { name: 'Perplexity', value: 'perplexity', envVar: 'PERPLEXITY_API_KEY', description: 'Perplexity search-augmented models' },
];

export class ProviderStep implements WizardStep {
  readonly id = 'providers';
  readonly title = 'AI Provider Configuration';
  readonly description = 'Select and configure AI providers with API keys.';

  async run(ctx: WizardContext): Promise<boolean> {
    console.log('\n  You need at least one AI provider to use HydraClaw.');
    console.log('  Select the providers you want to enable:\n');

    const selected = await askMultiSelect<string>(
      'Choose providers to configure:',
      AVAILABLE_PROVIDERS.map((p) => ({
        name: p.name,
        value: p.value,
        description: p.description,
        checked: p.value === 'anthropic',
      })),
    );

    if (selected.length === 0) {
      console.log('\n  Warning: No providers selected. You will need to configure at least one provider manually.');
      return true;
    }

    const providers: Record<string, ProviderConfig> = {};

    for (const providerId of selected) {
      const provider = AVAILABLE_PROVIDERS.find((p) => p.value === providerId)!;
      console.log(`\n  Configuring ${provider.name}...`);

      // Check for existing env var first
      const existingKey = process.env[provider.envVar];
      if (existingKey) {
        const useExisting = await askConfirm(
          `Found ${provider.envVar} in environment. Use it?`,
          true,
        );
        if (useExisting) {
          providers[providerId] = {
            apiKey: `\${${provider.envVar}}`,
            enabled: true,
          };
          continue;
        }
      }

      const apiKey = await askOptionalApiKey(provider.name);
      providers[providerId] = {
        apiKey: apiKey || undefined,
        enabled: apiKey.length > 0,
      };
    }

    // Choose default provider
    const enabledProviders = Object.entries(providers)
      .filter(([, cfg]) => cfg.enabled)
      .map(([id]) => id);

    if (enabledProviders.length > 0) {
      const defaultProvider = enabledProviders.length === 1
        ? enabledProviders[0]
        : await askSelect(
            'Which provider should be the default?',
            enabledProviders.map((id) => ({
              name: AVAILABLE_PROVIDERS.find((p) => p.value === id)!.name,
              value: id,
            })),
          );

      ctx.config.agent = {
        ...ctx.config.agent,
        defaultProvider,
      } as HydraClawConfig['agent'];
    }

    ctx.config.providers = providers;
    return true;
  }
}

// ---------------------------------------------------------------------------
// ChannelStep
// ---------------------------------------------------------------------------

interface ChannelChoice {
  name: string;
  value: string;
  tokenFields: Array<{ key: string; label: string; envVar: string }>;
  description: string;
}

const AVAILABLE_CHANNELS: ChannelChoice[] = [
  {
    name: 'Telegram',
    value: 'telegram',
    description: 'Telegram bot integration',
    tokenFields: [{ key: 'token', label: 'Telegram Bot Token', envVar: 'TELEGRAM_BOT_TOKEN' }],
  },
  {
    name: 'Discord',
    value: 'discord',
    description: 'Discord bot integration',
    tokenFields: [{ key: 'token', label: 'Discord Bot Token', envVar: 'DISCORD_BOT_TOKEN' }],
  },
  {
    name: 'Slack',
    value: 'slack',
    description: 'Slack app integration',
    tokenFields: [
      { key: 'token', label: 'Slack Bot Token', envVar: 'SLACK_BOT_TOKEN' },
      { key: 'signingSecret', label: 'Slack Signing Secret', envVar: 'SLACK_SIGNING_SECRET' },
    ],
  },
  {
    name: 'WhatsApp',
    value: 'whatsapp',
    description: 'WhatsApp Business API integration',
    tokenFields: [
      { key: 'token', label: 'WhatsApp Access Token', envVar: 'WHATSAPP_ACCESS_TOKEN' },
      { key: 'phoneNumberId', label: 'Phone Number ID', envVar: 'WHATSAPP_PHONE_NUMBER_ID' },
    ],
  },
  {
    name: 'Matrix',
    value: 'matrix',
    description: 'Matrix / Element integration',
    tokenFields: [
      { key: 'homeserverUrl', label: 'Homeserver URL', envVar: 'MATRIX_HOMESERVER_URL' },
      { key: 'accessToken', label: 'Access Token', envVar: 'MATRIX_ACCESS_TOKEN' },
    ],
  },
];

export class ChannelStep implements WizardStep {
  readonly id = 'channels';
  readonly title = 'Messaging Channel Configuration';
  readonly description = 'Set up messaging channels like Telegram, Discord, Slack, and more.';

  async run(ctx: WizardContext): Promise<boolean> {
    console.log('\n  Channels allow users to interact with HydraClaw via');
    console.log('  messaging platforms. You can add channels later too.\n');

    const selected = await askMultiSelect<string>(
      'Select channels to configure:',
      AVAILABLE_CHANNELS.map((c) => ({
        name: c.name,
        value: c.value,
        description: c.description,
      })),
    );

    if (selected.length === 0) {
      console.log('\n  No channels selected. The gateway will still be accessible via HTTP/WebSocket.');
      ctx.config.channels = {};
      return true;
    }

    const channels: Record<string, ChannelConfig> = {};

    for (const channelId of selected) {
      const channel = AVAILABLE_CHANNELS.find((c) => c.value === channelId)!;
      console.log(`\n  Configuring ${channel.name}...`);

      const channelConfig: ChannelConfig = { enabled: true };

      for (const field of channel.tokenFields) {
        const existingValue = process.env[field.envVar];

        if (existingValue) {
          const useExisting = await askConfirm(
            `Found ${field.envVar} in environment. Use it?`,
            true,
          );
          if (useExisting) {
            channelConfig[field.key] = `\${${field.envVar}}`;
            continue;
          }
        }

        const isSensitive = field.key.toLowerCase().includes('token') ||
                            field.key.toLowerCase().includes('secret');
        if (isSensitive) {
          channelConfig[field.key] = await askApiKey(`Enter ${field.label}:`);
        } else {
          channelConfig[field.key] = await askText(`Enter ${field.label}:`);
        }
      }

      channels[channelId] = channelConfig;
    }

    ctx.config.channels = channels;
    return true;
  }
}

// ---------------------------------------------------------------------------
// SecurityStep
// ---------------------------------------------------------------------------

export class SecurityStep implements WizardStep {
  readonly id = 'security';
  readonly title = 'Security Configuration';
  readonly description = 'Configure security settings and safeguards.';

  async run(ctx: WizardContext): Promise<boolean> {
    console.log('\n  HydraClaw includes several security features.');
    console.log('  It is strongly recommended to enable them.\n');

    const enableInjectionDetection = await askConfirm(
      'Enable prompt injection detection?',
      true,
    );

    const enableAuditLog = await askConfirm(
      'Enable audit logging for all tool executions?',
      true,
    );

    const enableToolPolicies = await askConfirm(
      'Enable tool policy engine (restrict dangerous operations)?',
      true,
    );

    let shellPolicy = 'deny' as string;
    let filesystemPolicy = 'read-only' as string;

    if (enableToolPolicies) {
      shellPolicy = await askSelect(
        'Shell command execution policy:',
        [
          { name: 'Deny all shell commands', value: 'deny', description: 'Safest option' },
          { name: 'Allow with allowlist only', value: 'allowlist', description: 'Only pre-approved commands' },
          { name: 'Allow all (dangerous!)', value: 'allow', description: 'No restrictions' },
        ],
      );

      filesystemPolicy = await askSelect(
        'Filesystem access policy:',
        [
          { name: 'Read-only', value: 'read-only', description: 'Can read files but not modify' },
          { name: 'Sandboxed read/write', value: 'sandboxed', description: 'Write only to designated directories' },
          { name: 'Full access (dangerous!)', value: 'full', description: 'Unrestricted filesystem access' },
        ],
      );
    }

    const rateLimitEnabled = await askConfirm(
      'Enable rate limiting?',
      true,
    );

    let maxRequestsPerMinute = 30;
    if (rateLimitEnabled) {
      const rateStr = await askText('Max requests per minute per user:', {
        defaultValue: '30',
        validate: (val) => {
          const n = parseInt(val, 10);
          if (isNaN(n) || n <= 0) return 'Please enter a positive number.';
          return true;
        },
      });
      maxRequestsPerMinute = parseInt(rateStr, 10);
    }

    ctx.config.security = {
      injectionDetection: enableInjectionDetection,
      auditLog: enableAuditLog,
      toolPolicies: enableToolPolicies,
      shell: { policy: shellPolicy },
      filesystem: { policy: filesystemPolicy },
      rateLimit: rateLimitEnabled
        ? { enabled: true, maxRequestsPerMinute }
        : { enabled: false },
    };

    return true;
  }
}
