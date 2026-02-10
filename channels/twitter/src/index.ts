import { TwitterApi, type TweetStream, type TweetV2SingleStreamResult } from 'twitter-api-v2';
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

export class TwitterChannel implements Channel {
  readonly id = 'twitter';
  readonly name = 'Twitter';
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

  private client: TwitterApi | null = null;
  private stream: TweetStream<TweetV2SingleStreamResult> | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'twitter' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const appKey = this.config.appKey as string | undefined;
    const appSecret = this.config.appSecret as string | undefined;
    const accessToken = this.config.accessToken as string | undefined;
    const accessSecret = this.config.accessSecret as string | undefined;

    if (!appKey || !appSecret || !accessToken || !accessSecret) {
      throw new Error('Twitter channel requires appKey, appSecret, accessToken, and accessSecret');
    }

    this.client = new TwitterApi({
      appKey,
      appSecret,
      accessToken,
      accessSecret,
    });

    this.logger.info('Twitter channel initialized');
  }

  async start(): Promise<void> {
    if (!this.client) {
      throw new Error('Twitter channel not initialized. Call init() first.');
    }

    this.logger.info('Starting Twitter filtered stream for mentions...');

    try {
      // Get current user info
      const me = await this.client.v2.me();
      const myUsername = me.data.username;

      // Set up filtered stream rules for mentions
      const rules = await this.client.v2.streamRules();
      const existingRules = rules.data ?? [];

      // Delete old rules
      if (existingRules.length > 0) {
        await this.client.v2.updateStreamRules({
          delete: { ids: existingRules.map((r) => r.id) },
        });
      }

      // Add mention rule
      await this.client.v2.updateStreamRules({
        add: [{ value: `@${myUsername}`, tag: 'mentions' }],
      });

      // Start streaming
      this.stream = await this.client.v2.searchStream({
        'tweet.fields': ['author_id', 'conversation_id', 'created_at', 'in_reply_to_user_id', 'referenced_tweets'],
        'user.fields': ['username', 'name'],
        expansions: ['author_id', 'referenced_tweets.id'],
      });

      this.stream.autoReconnect = true;

      this.stream.on('data', async (tweet: TweetV2SingleStreamResult) => {
        try {
          await this.handleTweet(tweet);
        } catch (err) {
          this.logger.error(`Error handling tweet: ${err}`);
        }
      });

      this.stream.on('error', (err) => {
        this.logger.error(`Twitter stream error: ${err}`);
      });

      this.logger.info(`Twitter stream started, listening for @${myUsername} mentions`);
    } catch (err) {
      this.logger.error(`Failed to start Twitter stream: ${err}`);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.stream) {
      this.stream.close();
      this.stream = null;
      this.logger.info('Twitter stream stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.client) {
      throw new Error('Twitter channel not initialized');
    }

    try {
      const tweetOptions: Record<string, unknown> = {};

      // If target is a tweet ID, reply to it
      if (target && target !== '') {
        tweetOptions.reply = { in_reply_to_tweet_id: target };
      }

      // Upload images if present
      if (message.images && message.images.length > 0) {
        const mediaIds: string[] = [];
        for (const image of message.images) {
          const mediaId = await this.client.v1.uploadMedia(Buffer.from(image.data), {
            mimeType: image.mimeType as any,
          });
          mediaIds.push(mediaId);
        }
        tweetOptions.media = { media_ids: mediaIds as any };
      }

      await this.client.v2.tweet(message.content, tweetOptions);
      this.logger.debug(`Sent tweet, reply to: ${target || 'none'}`);
    } catch (err) {
      this.logger.error(`Failed to send tweet: ${err}`);
      throw err;
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private async handleTweet(tweet: TweetV2SingleStreamResult): Promise<void> {
    const data = tweet.data;
    if (!data) return;

    const users = tweet.includes?.users ?? [];
    const author = users.find((u) => u.id === data.author_id);

    // Determine if this is a reply
    const replyRef = data.referenced_tweets?.find((r) => r.type === 'replied_to');

    const inbound: InboundMessage = {
      id: randomUUID(),
      channelId: 'twitter',
      channelMessageId: data.id,
      senderId: data.author_id ?? 'unknown',
      senderName: author?.name ?? author?.username,
      target: data.id,
      content: data.text,
      isGroup: false,
      replyToId: replyRef?.id,
      threadId: data.conversation_id,
      timestamp: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
      raw: tweet,
    };

    await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
  }
}

export default TwitterChannel;
