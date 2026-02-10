import { Client as IrcClient } from 'irc-framework';
import type {
  Channel,
  ChannelCapabilities,
  InboundMessage,
  OutboundMessage,
  PluginContext,
  Logger,
  MessageBus,
} from '@hydraclaw/core';
import { Events } from '@hydraclaw/core';
import { randomUUID } from 'node:crypto';

export class IrcChannel implements Channel {
  readonly id = 'irc';
  readonly name = 'IRC';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: false,
    audio: false,
    video: false,
    files: false,
    reactions: false,
    threads: false,
    editing: false,
    groups: true,
    streaming: false,
  };

  private client: any = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private channelsToJoin: string[] = [];

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'irc' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const host = this.config.host as string | undefined;
    if (!host) {
      throw new Error('IRC host is required (config.host)');
    }

    const nick = this.config.nick as string | undefined;
    if (!nick) {
      throw new Error('IRC nick is required (config.nick)');
    }

    this.channelsToJoin = (this.config.channels as string[]) ?? [];

    this.client = new IrcClient();
    this.logger.info('IRC channel initialized');
  }

  async start(): Promise<void> {
    if (!this.client) {
      throw new Error('IRC channel not initialized. Call init() first.');
    }

    const host = this.config.host as string;
    const port = (this.config.port as number) ?? 6667;
    const nick = this.config.nick as string;
    const tls = (this.config.tls as boolean) ?? false;
    const password = this.config.password as string | undefined;

    this.logger.info(`Connecting to IRC: ${host}:${port} as ${nick}`);

    return new Promise<void>((resolve, reject) => {
      this.setupHandlers();

      this.client!.connect({
        host,
        port,
        nick,
        tls,
        password,
      });

      const onRegistered = () => {
        this.client!.removeListener('registered', onRegistered);
        this.client!.removeListener('error' as any, onError);

        // Join configured channels
        for (const channel of this.channelsToJoin) {
          this.client!.join(channel);
          this.logger.info(`Joining IRC channel: ${channel}`);
        }

        this.logger.info('IRC bot connected and registered');
        resolve();
      };

      const onError = (err: Error) => {
        this.client!.removeListener('registered', onRegistered);
        this.client!.removeListener('error' as any, onError);
        reject(err);
      };

      this.client!.on('registered', onRegistered);
      this.client!.on('error' as any, onError);
    });
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.logger.info('Stopping IRC client...');
      this.client.quit('HydraClaw shutting down');
      this.client = null;
      this.logger.info('IRC client stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.client) {
      throw new Error('IRC channel not initialized');
    }

    if (message.content) {
      // IRC messages need to be split by newlines and sent as individual lines
      const lines = message.content.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.client.say(target, line);
        }
      }
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private setupHandlers(): void {
    if (!this.client) return;

    // Handle channel messages
    this.client.on('message', (event: any) => {
      try {
        const isGroup = event.target?.startsWith('#') ?? false;

        const inbound: InboundMessage = {
          id: randomUUID(),
          channelId: 'irc',
          channelMessageId: undefined,
          senderId: event.nick ?? 'unknown',
          senderName: event.nick ?? 'unknown',
          target: event.target ?? '',
          content: event.message ?? '',
          isGroup,
          groupId: isGroup ? event.target : undefined,
          groupName: isGroup ? event.target : undefined,
          timestamp: Date.now(),
          raw: event,
        };

        this.bus.emit(Events.MESSAGE_INBOUND, inbound).catch((err) => {
          this.logger.error(`Error emitting IRC message: ${err}`);
        });
      } catch (err) {
        this.logger.error(`Error handling IRC message: ${err}`);
      }
    });

    // Handle private messages
    this.client.on('privmsg', (event: any) => {
      try {
        // If target is a channel (starts with #), it's a group message (handled above)
        if (event.target?.startsWith('#')) return;

        const inbound: InboundMessage = {
          id: randomUUID(),
          channelId: 'irc',
          channelMessageId: undefined,
          senderId: event.nick ?? 'unknown',
          senderName: event.nick ?? 'unknown',
          target: event.nick ?? '',
          content: event.message ?? '',
          isGroup: false,
          timestamp: Date.now(),
          raw: event,
        };

        this.bus.emit(Events.MESSAGE_INBOUND, inbound).catch((err) => {
          this.logger.error(`Error emitting IRC private message: ${err}`);
        });
      } catch (err) {
        this.logger.error(`Error handling IRC private message: ${err}`);
      }
    });

    // Handle errors
    this.client.on('error' as any, (err: any) => {
      this.logger.error(`IRC error: ${err.message ?? err}`);
    });

    // Handle disconnection
    this.client.on('close', () => {
      this.logger.warn('IRC connection closed');
    });

    // Handle reconnection
    this.client.on('reconnecting', () => {
      this.logger.info('IRC reconnecting...');
    });
  }
}

export default IrcChannel;
