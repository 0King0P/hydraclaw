import { createRestAPIClient, createStreamingAPIClient, type mastodon } from 'masto';
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

export class MastodonChannel implements Channel {
  readonly id = 'mastodon';
  readonly name = 'Mastodon';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: false,
    video: false,
    files: false,
    reactions: false,
    threads: false,
    editing: false,
    groups: false,
    streaming: false,
  };

  private restClient: mastodon.rest.Client | null = null;
  private streamClient: mastodon.streaming.Client | null = null;
  private subscription: { unsubscribe(): void } | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'mastodon' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const url = this.config.url as string | undefined;
    const accessToken = this.config.accessToken as string | undefined;

    if (!url || !accessToken) {
      throw new Error('Mastodon channel requires url (instance URL) and accessToken');
    }

    this.restClient = createRestAPIClient({
      url,
      accessToken,
    });

    this.streamClient = createStreamingAPIClient({
      streamingApiUrl: url.replace(/\/$/, '') + '/api/v1/streaming',
      accessToken,
    });

    this.logger.info(`Mastodon channel initialized for ${url}`);
  }

  async start(): Promise<void> {
    if (!this.restClient || !this.streamClient) {
      throw new Error('Mastodon channel not initialized. Call init() first.');
    }

    this.logger.info('Starting Mastodon streaming for notifications...');

    try {
      const events = this.streamClient.user.subscribe();
      this.subscription = events;

      for await (const event of events) {
        if (event.event === 'notification') {
          try {
            const notification = event.payload as mastodon.v1.Notification;
            if (notification.type === 'mention' && notification.status) {
              await this.handleMention(notification);
            }
          } catch (err) {
            this.logger.error(`Error handling Mastodon notification: ${err}`);
          }
        }
      }
    } catch (err) {
      this.logger.error(`Mastodon stream error: ${err}`);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
      this.logger.info('Mastodon streaming stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.restClient) {
      throw new Error('Mastodon channel not initialized');
    }

    try {
      const statusOptions: Record<string, unknown> = {
        status: message.content,
      };

      // Reply to a status
      if (target && target !== '') {
        statusOptions.inReplyToId = target;
      }

      // Upload images if present
      if (message.images && message.images.length > 0) {
        const mediaIds: string[] = [];
        for (const image of message.images) {
          const blob = new Blob([image.data], { type: image.mimeType });
          const attachment = await this.restClient.v2.media.create({
            file: blob as any,
            description: image.filename ?? 'image',
          });
          mediaIds.push(attachment.id);
        }
        statusOptions.mediaIds = mediaIds;
      }

      await this.restClient.v1.statuses.create(statusOptions as any);
      this.logger.debug(`Sent Mastodon status, reply to: ${target || 'none'}`);
    } catch (err) {
      this.logger.error(`Failed to send Mastodon status: ${err}`);
      throw err;
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private async handleMention(notification: mastodon.v1.Notification): Promise<void> {
    const status = notification.status;
    if (!status) return;

    const account = notification.account;

    // Strip HTML tags from content for plain text
    const textContent = status.content.replace(/<[^>]*>/g, '').trim();

    const inbound: InboundMessage = {
      id: randomUUID(),
      channelId: 'mastodon',
      channelMessageId: status.id,
      senderId: account.id,
      senderName: account.displayName || account.acct,
      target: status.id,
      content: textContent,
      isGroup: false,
      replyToId: status.inReplyToId ?? undefined,
      threadId: status.inReplyToId ?? status.id,
      timestamp: Math.floor(new Date(status.createdAt).getTime() / 1000),
      raw: notification,
    };

    await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
  }
}

export default MastodonChannel;
