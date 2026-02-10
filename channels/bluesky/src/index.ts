import { BskyAgent, type AtpSessionData } from '@atproto/api';
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

export class BlueskyChannel implements Channel {
  readonly id = 'bluesky';
  readonly name = 'Bluesky';
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

  private agent: BskyAgent | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeenAt: string | undefined;
  private myDid: string | null = null;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'bluesky' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const service = (this.config.service as string | undefined) ?? 'https://bsky.social';
    const identifier = this.config.identifier as string | undefined;
    const password = this.config.password as string | undefined;

    if (!identifier || !password) {
      throw new Error('Bluesky channel requires identifier and password');
    }

    this.agent = new BskyAgent({ service });

    await this.agent.login({ identifier, password });
    this.myDid = this.agent.session?.did ?? null;

    this.logger.info(`Bluesky channel initialized as ${identifier}`);
  }

  async start(): Promise<void> {
    if (!this.agent) {
      throw new Error('Bluesky channel not initialized. Call init() first.');
    }

    const pollInterval = (this.config.pollInterval as number | undefined) ?? 15000;

    this.logger.info('Starting Bluesky notification polling...');

    this.pollTimer = setInterval(async () => {
      try {
        await this.pollNotifications();
      } catch (err) {
        this.logger.error(`Error polling Bluesky notifications: ${err}`);
      }
    }, pollInterval);

    // Initial poll
    try {
      await this.pollNotifications();
    } catch (err) {
      this.logger.error(`Error during initial Bluesky poll: ${err}`);
    }
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.logger.info('Bluesky polling stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.agent) {
      throw new Error('Bluesky channel not initialized');
    }

    try {
      const record: Record<string, unknown> = {
        $type: 'app.bsky.feed.post',
        text: message.content,
        createdAt: new Date().toISOString(),
      };

      // If replying to a post, set the reply reference
      // target format: "did:uri:cid" e.g., "at://did:plc:.../app.bsky.feed.post/...|cid"
      if (message.replyToId || target) {
        const replyTarget = message.replyToId ?? target;
        const parts = replyTarget.split('|');
        if (parts.length === 2) {
          const [uri, cid] = parts;
          record.reply = {
            root: { uri, cid },
            parent: { uri, cid },
          };
        }
      }

      // Upload images if present
      if (message.images && message.images.length > 0) {
        const images: Array<Record<string, unknown>> = [];
        for (const image of message.images) {
          const uploadResp = await this.agent.uploadBlob(image.data, {
            encoding: image.mimeType,
          });
          images.push({
            alt: image.filename ?? 'image',
            image: uploadResp.data.blob,
          });
        }
        record.embed = {
          $type: 'app.bsky.embed.images',
          images,
        };
      }

      await this.agent.post(record as any);
      this.logger.debug(`Sent Bluesky post, reply to: ${target || 'none'}`);
    } catch (err) {
      this.logger.error(`Failed to send Bluesky post: ${err}`);
      throw err;
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private async pollNotifications(): Promise<void> {
    if (!this.agent) return;

    try {
      const params: Record<string, unknown> = { limit: 50 };
      if (this.lastSeenAt) {
        // Only pass seenAt for update, still fetch all recent
      }

      const response = await this.agent.listNotifications(params as any);
      const notifications = response.data.notifications ?? [];

      for (const notif of notifications) {
        // Skip already-read notifications
        if (notif.isRead && this.lastSeenAt) continue;

        // Only handle mentions (replies and quotes that mention us)
        if (notif.reason !== 'mention' && notif.reason !== 'reply') continue;

        const record = notif.record as Record<string, unknown>;
        if (!record || record.$type !== 'app.bsky.feed.post') continue;

        const text = (record.text as string) ?? '';
        const uri = notif.uri;
        const cid = notif.cid;

        const replyRef = record.reply as Record<string, any> | undefined;

        const inbound: InboundMessage = {
          id: randomUUID(),
          channelId: 'bluesky',
          channelMessageId: uri,
          senderId: notif.author.did,
          senderName: notif.author.displayName || notif.author.handle,
          target: `${uri}|${cid}`,
          content: text,
          isGroup: false,
          replyToId: replyRef?.parent?.uri,
          threadId: replyRef?.root?.uri ?? uri,
          timestamp: Math.floor(new Date(notif.indexedAt).getTime() / 1000),
          raw: notif,
        };

        await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
      }

      // Mark notifications as seen
      await this.agent.updateSeenNotifications();
      this.lastSeenAt = new Date().toISOString();
    } catch (err) {
      this.logger.error(`Error polling Bluesky notifications: ${err}`);
    }
  }
}

export default BlueskyChannel;
