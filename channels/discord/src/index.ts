import {
  Client,
  GatewayIntentBits,
  type Message as DiscordMessage,
  type TextChannel,
  EmbedBuilder,
  AttachmentBuilder,
} from 'discord.js';
import type {
  Channel,
  ChannelCapabilities,
  InboundMessage,
  OutboundMessage,
  PluginContext,
  ImageInput,
  FileAttachment,
  Logger,
  MessageBus,
} from '@hydraclaw/core';
import { Events } from '@hydraclaw/core';
import { randomUUID } from 'node:crypto';

export class DiscordChannel implements Channel {
  readonly id = 'discord';
  readonly name = 'Discord';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: false,
    video: false,
    files: true,
    reactions: true,
    threads: true,
    editing: true,
    groups: true,
    streaming: false,
  };

  private client: Client | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'discord' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const token = this.config.token as string | undefined;
    if (!token) {
      throw new Error('Discord bot token is required (config.token)');
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.setupHandlers();
    this.logger.info('Discord channel initialized');
  }

  async start(): Promise<void> {
    if (!this.client) {
      throw new Error('Discord channel not initialized. Call init() first.');
    }

    const token = this.config.token as string;
    this.logger.info('Starting Discord bot...');

    await this.client.login(token);
    this.logger.info(`Discord bot started: ${this.client.user?.tag}`);
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.logger.info('Stopping Discord bot...');
      this.client.destroy();
      this.client = null;
      this.logger.info('Discord bot stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.client) {
      throw new Error('Discord channel not initialized');
    }

    const channel = await this.client.channels.fetch(target);
    if (!channel || !('send' in channel)) {
      throw new Error(`Cannot send to channel: ${target}`);
    }

    const textChannel = channel as TextChannel;
    const attachments: AttachmentBuilder[] = [];

    // Build image attachments
    if (message.images && message.images.length > 0) {
      for (const image of message.images) {
        attachments.push(
          new AttachmentBuilder(image.data, {
            name: image.filename ?? 'image.png',
          }),
        );
      }
    }

    // Build file attachments
    if (message.files && message.files.length > 0) {
      for (const file of message.files) {
        attachments.push(
          new AttachmentBuilder(file.data, {
            name: file.filename,
          }),
        );
      }
    }

    const sendOptions: Record<string, unknown> = {};

    if (message.content) {
      sendOptions.content = message.content;
    }

    if (attachments.length > 0) {
      sendOptions.files = attachments;
    }

    if (message.replyToId) {
      sendOptions.reply = { messageReference: message.replyToId };
    }

    if (message.threadId) {
      const thread = await textChannel.threads.fetch(message.threadId);
      if (thread) {
        await thread.send(sendOptions);
        return;
      }
    }

    await textChannel.send(sendOptions);
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private setupHandlers(): void {
    if (!this.client) return;

    this.client.on('messageCreate', async (msg: DiscordMessage) => {
      try {
        // Ignore messages from the bot itself
        if (msg.author.id === this.client?.user?.id) return;

        const inbound = this.convertToInbound(msg);
        await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
      } catch (err) {
        this.logger.error(`Error handling Discord message: ${err}`);
      }
    });

    this.client.on('error', (err) => {
      this.logger.error(`Discord client error: ${err}`);
    });

    this.client.on('warn', (warning) => {
      this.logger.warn(`Discord warning: ${warning}`);
    });
  }

  private convertToInbound(msg: DiscordMessage): InboundMessage {
    const isGroup = msg.guild !== null;

    // Extract text content
    let content = msg.content ?? '';

    // Extract images from attachments
    const images: ImageInput[] = [];
    for (const attachment of msg.attachments.values()) {
      if (attachment.contentType?.startsWith('image/')) {
        images.push({
          type: 'url',
          data: attachment.url,
          mimeType: attachment.contentType ?? 'image/png',
        });
      }
    }

    // Extract file attachments (non-image)
    const files: FileAttachment[] = [];
    for (const attachment of msg.attachments.values()) {
      if (!attachment.contentType?.startsWith('image/')) {
        files.push({
          url: attachment.url,
          mimeType: attachment.contentType ?? 'application/octet-stream',
          filename: attachment.name ?? 'file',
          size: attachment.size,
        });
      }
    }

    // Handle embed content
    if (!content && msg.embeds.length > 0) {
      content = msg.embeds.map((e) => e.description ?? e.title ?? '').join('\n');
    }

    if (!content && (images.length > 0 || files.length > 0)) {
      content = '[media]';
    }

    return {
      id: randomUUID(),
      channelId: 'discord',
      channelMessageId: msg.id,
      senderId: msg.author.id,
      senderName: msg.author.displayName ?? msg.author.username,
      target: msg.channelId,
      content,
      images: images.length > 0 ? images : undefined,
      files: files.length > 0 ? files : undefined,
      replyToId: msg.reference?.messageId ?? undefined,
      threadId: msg.thread?.id ?? undefined,
      groupId: isGroup ? msg.guildId ?? undefined : undefined,
      groupName: isGroup ? msg.guild?.name ?? undefined : undefined,
      isGroup,
      timestamp: msg.createdTimestamp,
      raw: msg,
    };
  }
}

export default DiscordChannel;
