import { App } from '@slack/bolt';
import type {
  Channel,
  ChannelCapabilities,
  InboundMessage,
  OutboundMessage,
  PluginContext,
  FileAttachment,
  Logger,
  MessageBus,
} from '@hydraclaw/core';
import { Events } from '@hydraclaw/core';
import { randomUUID } from 'node:crypto';

export class SlackChannel implements Channel {
  readonly id = 'slack';
  readonly name = 'Slack';
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

  private app: App | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private botUserId: string | null = null;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'slack' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const token = this.config.token as string | undefined;
    const appToken = this.config.appToken as string | undefined;

    if (!token) {
      throw new Error('Slack bot token is required (config.token)');
    }
    if (!appToken) {
      throw new Error('Slack app-level token is required (config.appToken)');
    }

    this.app = new App({
      token,
      appToken,
      socketMode: true,
    });

    this.setupHandlers();
    this.logger.info('Slack channel initialized');
  }

  async start(): Promise<void> {
    if (!this.app) {
      throw new Error('Slack channel not initialized. Call init() first.');
    }

    this.logger.info('Starting Slack bot...');
    await this.app.start();

    // Get bot user ID for filtering self-messages
    try {
      const result = await this.app.client.auth.test();
      this.botUserId = result.user_id as string;
      this.logger.info(`Slack bot started: ${result.user} (${this.botUserId})`);
    } catch (err) {
      this.logger.warn(`Could not get bot user ID: ${err}`);
    }
  }

  async stop(): Promise<void> {
    if (this.app) {
      this.logger.info('Stopping Slack bot...');
      await this.app.stop();
      this.logger.info('Slack bot stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.app) {
      throw new Error('Slack channel not initialized');
    }

    const channelId = target;

    // Send text message
    if (message.content) {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: message.content,
        thread_ts: message.threadId ?? undefined,
      });
    }

    // Upload and send files
    if (message.files && message.files.length > 0) {
      for (const file of message.files) {
        await this.app.client.filesUploadV2({
          channel_id: channelId,
          file: file.data,
          filename: file.filename,
          thread_ts: message.threadId ?? undefined,
        } as any);
      }
    }

    // Upload and send images
    if (message.images && message.images.length > 0) {
      for (const image of message.images) {
        await this.app.client.filesUploadV2({
          channel_id: channelId,
          file: image.data,
          filename: image.filename ?? 'image.png',
          thread_ts: message.threadId ?? undefined,
        } as any);
      }
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private setupHandlers(): void {
    if (!this.app) return;

    this.app.message(async ({ message, client }) => {
      try {
        const msg = message as any;

        // Ignore bot's own messages
        if (msg.bot_id || msg.user === this.botUserId) return;

        const inbound = await this.convertToInbound(msg, client);
        if (inbound) {
          await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
        }
      } catch (err) {
        this.logger.error(`Error handling Slack message: ${err}`);
      }
    });
  }

  private async convertToInbound(
    msg: any,
    client: App['client'],
  ): Promise<InboundMessage | null> {
    const content = msg.text ?? '';

    // Resolve user info for sender name
    let senderName = msg.user;
    try {
      const userInfo = await client.users.info({ user: msg.user });
      senderName = userInfo.user?.real_name ?? userInfo.user?.name ?? msg.user;
    } catch {
      // Fall back to user ID
    }

    // Determine if this is a group (channel) message or DM
    let isGroup = false;
    let groupName: string | undefined;
    try {
      const channelInfo = await client.conversations.info({ channel: msg.channel });
      isGroup = channelInfo.channel?.is_channel === true || channelInfo.channel?.is_group === true;
      groupName = channelInfo.channel?.name ?? undefined;
    } catch {
      // Fall back to assuming non-group
    }

    // Extract file attachments
    const files: FileAttachment[] = [];
    if (msg.files && msg.files.length > 0) {
      for (const file of msg.files) {
        files.push({
          url: file.url_private ?? undefined,
          mimeType: file.mimetype ?? 'application/octet-stream',
          filename: file.name ?? 'file',
          size: file.size ?? undefined,
        });
      }
    }

    if (!content && files.length === 0) {
      return null;
    }

    return {
      id: randomUUID(),
      channelId: 'slack',
      channelMessageId: msg.ts,
      senderId: msg.user,
      senderName,
      target: msg.channel,
      content: content || (files.length > 0 ? '[media]' : ''),
      files: files.length > 0 ? files : undefined,
      replyToId: undefined,
      threadId: msg.thread_ts ?? undefined,
      groupId: isGroup ? msg.channel : undefined,
      groupName,
      isGroup,
      timestamp: Math.floor(parseFloat(msg.ts) * 1000),
      raw: msg,
    };
  }
}

export default SlackChannel;
