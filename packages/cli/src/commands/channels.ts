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
  Channel,
  Logger,
  PluginContext,
} from '@hydraclaw/core';

/** Maps channel config IDs to their npm package names. */
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

/**
 * Create the `hydraclaw channels` command group.
 *
 * Subcommands:
 *   hydraclaw channels list              - List all channels with status
 *   hydraclaw channels enable <channel>  - Enable a channel
 *   hydraclaw channels disable <channel> - Disable a channel
 *   hydraclaw channels test <channel>    - Send a test message
 */
export function createChannelsCommand(): Command {
  const command = new Command('channels');
  command.description('Manage messaging channels');

  // ─── list ───────────────────────────────────────────────────────────
  command
    .command('list')
    .description('List all channels with their current status')
    .option('-c, --config <path>', 'Path to config file')
    .option('--json', 'Output as JSON')
    .action(async (opts: { config?: string; json?: boolean }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });

      const configured = Object.entries(config.channels);
      const allKnown = Object.keys(CHANNEL_PACKAGES);

      interface ChannelInfo {
        id: string;
        configured: boolean;
        enabled: boolean;
        installed: boolean;
      }

      const channels: ChannelInfo[] = [];

      // Configured channels
      for (const [id, channelConfig] of configured) {
        const pkg = CHANNEL_PACKAGES[id] ?? `@hydraclaw/channel-${id}`;
        const installed = await isPackageInstalled(pkg, logger);
        channels.push({
          id,
          configured: true,
          enabled: channelConfig.enabled !== false,
          installed,
        });
      }

      // Known but unconfigured channels
      for (const id of allKnown) {
        if (config.channels[id]) continue;
        const pkg = CHANNEL_PACKAGES[id];
        const installed = await isPackageInstalled(pkg, logger);
        channels.push({
          id,
          configured: false,
          enabled: false,
          installed,
        });
      }

      if (opts.json) {
        console.log(JSON.stringify(channels, null, 2));
        return;
      }

      console.log(chalk.bold.cyan('\nChannels\n'));

      if (channels.length === 0) {
        console.log(chalk.yellow('  No channels found.'));
        return;
      }

      // Configured channels first
      const configuredChannels = channels.filter((c) => c.configured);
      const unconfiguredChannels = channels.filter((c) => !c.configured);

      if (configuredChannels.length > 0) {
        console.log(chalk.bold('  Configured:'));
        for (const ch of configuredChannels) {
          const status = ch.enabled ? chalk.green('enabled') : chalk.red('disabled');
          const install = ch.installed ? '' : chalk.yellow(' (not installed)');
          console.log(`    ${ch.id.padEnd(16)} ${status}${install}`);
        }
      }

      if (unconfiguredChannels.length > 0) {
        console.log(chalk.bold('\n  Available (not configured):'));
        for (const ch of unconfiguredChannels) {
          const install = ch.installed ? chalk.dim('installed') : chalk.dim('not installed');
          console.log(`    ${ch.id.padEnd(16)} ${install}`);
        }
      }

      console.log(chalk.dim(`\n  Total: ${configuredChannels.length} configured, ${unconfiguredChannels.length} available`));
    });

  // ─── enable ─────────────────────────────────────────────────────────
  command
    .command('enable <channel>')
    .description('Enable a channel in the configuration')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (channelId: string, opts: { config?: string }) => {
      const config = loadConfig(opts.config);

      if (!config.channels[channelId]) {
        console.error(chalk.red(`Channel "${channelId}" is not configured.`));
        console.error(chalk.dim('Add it to your config.yaml first, or run `hydraclaw onboard`.'));
        process.exit(1);
      }

      if (config.channels[channelId].enabled !== false) {
        console.log(chalk.yellow(`Channel "${channelId}" is already enabled.`));
        return;
      }

      // We cannot modify the config file here without a config writer,
      // so we inform the user what to change.
      console.log(chalk.cyan(`To enable the "${channelId}" channel, update your config.yaml:`));
      console.log(chalk.dim(`\n  channels:`));
      console.log(chalk.dim(`    ${channelId}:`));
      console.log(chalk.green(`      enabled: true`));
      console.log(chalk.dim('\n  Then restart HydraClaw.'));
    });

  // ─── disable ────────────────────────────────────────────────────────
  command
    .command('disable <channel>')
    .description('Disable a channel in the configuration')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (channelId: string, opts: { config?: string }) => {
      const config = loadConfig(opts.config);

      if (!config.channels[channelId]) {
        console.error(chalk.red(`Channel "${channelId}" is not configured.`));
        process.exit(1);
      }

      if (config.channels[channelId].enabled === false) {
        console.log(chalk.yellow(`Channel "${channelId}" is already disabled.`));
        return;
      }

      console.log(chalk.cyan(`To disable the "${channelId}" channel, update your config.yaml:`));
      console.log(chalk.dim(`\n  channels:`));
      console.log(chalk.dim(`    ${channelId}:`));
      console.log(chalk.red(`      enabled: false`));
      console.log(chalk.dim('\n  Then restart HydraClaw.'));
    });

  // ─── test ───────────────────────────────────────────────────────────
  command
    .command('test <channel>')
    .description('Send a test message through a channel')
    .option('-c, --config <path>', 'Path to config file')
    .option('--to <target>', 'Target (chat ID, user ID, etc.)')
    .option('--message <msg>', 'Custom test message', 'Hello from HydraClaw! This is a test message.')
    .action(async (channelId: string, opts: { config?: string; to?: string; message: string }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });
      const container = new Container();
      const bus = new MessageBus();

      container.registerInstance('config', config);
      container.registerInstance('logger', logger);
      container.registerInstance('bus', bus);

      const channelConfig = config.channels[channelId];
      if (!channelConfig) {
        console.error(chalk.red(`Channel "${channelId}" not found in config.`));
        process.exit(1);
      }

      if (channelConfig.enabled === false) {
        console.error(chalk.red(`Channel "${channelId}" is disabled. Enable it first.`));
        process.exit(1);
      }

      const pkg = CHANNEL_PACKAGES[channelId] ?? `@hydraclaw/channel-${channelId}`;
      const registry = new DefaultPluginRegistry();
      const loader = new PluginLoader(logger, registry);

      const channel = await tryImportDefault<Channel>(pkg, logger);
      if (!channel) {
        console.error(chalk.red(`Failed to load channel package: ${pkg}`));
        console.error(chalk.dim('Make sure the package is installed.'));
        process.exit(1);
      }

      const ctx = createPluginContext(channelConfig as Record<string, unknown>, logger, bus, container);
      await loader.loadPlugin(channel, ctx);
      await channel.start();

      const target = opts.to ?? 'test';

      console.log(chalk.cyan(`Sending test message to "${target}" via ${channelId}...`));

      try {
        await channel.send(target, { content: opts.message });
        console.log(chalk.green('Test message sent successfully!'));
      } catch (err) {
        console.error(chalk.red(`Test failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      } finally {
        await channel.stop();
      }
    });

  return command;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isPackageInstalled(pkg: string, logger: Logger): Promise<boolean> {
  try {
    await import(pkg);
    return true;
  } catch {
    return false;
  }
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

function createPluginContext(
  config: Record<string, unknown>,
  logger: Logger,
  bus: MessageBus,
  container: Container,
): PluginContext {
  return { config, logger, bus, container };
}
