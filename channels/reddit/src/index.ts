import Snoowrap from 'snoowrap';
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

export class RedditChannel implements Channel {
  readonly id = 'reddit';
  readonly name = 'Reddit';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: false,
    audio: false,
    video: false,
    files: false,
    reactions: false,
    threads: true,
    editing: false,
    groups: true,
    streaming: false,
  };

  private client: Snoowrap | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seenIds = new Set<string>();

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'reddit' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const clientId = this.config.clientId as string | undefined;
    const clientSecret = this.config.clientSecret as string | undefined;
    const username = this.config.username as string | undefined;
    const password = this.config.password as string | undefined;

    if (!clientId || !clientSecret || !username || !password) {
      throw new Error('Reddit channel requires clientId, clientSecret, username, and password');
    }

    this.client = new Snoowrap({
      userAgent: `hydraclaw:reddit-channel:v${this.version}`,
      clientId,
      clientSecret,
      username,
      password,
    });

    this.logger.info('Reddit channel initialized');
  }

  async start(): Promise<void> {
    if (!this.client) {
      throw new Error('Reddit channel not initialized. Call init() first.');
    }

    const subreddits = (this.config.subreddits as string[] | undefined) ?? [];
    const pollInterval = (this.config.pollInterval as number | undefined) ?? 30000;
    const botUsername = this.config.username as string;

    if (subreddits.length === 0) {
      this.logger.warn('No subreddits configured for Reddit channel');
    }

    this.logger.info(`Starting Reddit polling for subreddits: ${subreddits.join(', ')}`);

    this.pollTimer = setInterval(async () => {
      try {
        await this.pollSubreddits(subreddits, botUsername);
      } catch (err) {
        this.logger.error(`Error polling Reddit: ${err}`);
      }
    }, pollInterval);

    // Initial poll
    try {
      await this.pollSubreddits(subreddits, botUsername);
    } catch (err) {
      this.logger.error(`Error during initial Reddit poll: ${err}`);
    }
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.logger.info('Reddit polling stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.client) {
      throw new Error('Reddit channel not initialized');
    }

    try {
      // Target format: "comment:<id>" or "submission:<id>"
      const [type, id] = target.split(':');

      if (type === 'comment') {
        const comment: any = this.client.getComment(id);
        await comment.reply(message.content);
      } else if (type === 'submission') {
        const submission: any = this.client.getSubmission(id);
        await submission.reply(message.content);
      } else {
        // Default: treat as comment id
        const comment: any = this.client.getComment(target);
        await comment.reply(message.content);
      }

      this.logger.debug(`Sent reply to Reddit ${type ?? 'comment'}: ${id ?? target}`);
    } catch (err) {
      this.logger.error(`Failed to send Reddit message to ${target}: ${err}`);
      throw err;
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private async pollSubreddits(subreddits: string[], botUsername: string): Promise<void> {
    if (!this.client) return;

    for (const sub of subreddits) {
      try {
        // Fetch new comments
        const comments: any[] = await (this.client.getSubreddit(sub).getNewComments({ limit: 25 }) as any);
        for (const comment of comments) {
          if (this.seenIds.has(comment.id)) continue;
          this.seenIds.add(comment.id);

          // Check if the comment mentions the bot
          const body = comment.body ?? '';
          if (!body.toLowerCase().includes(`u/${botUsername.toLowerCase()}`)) continue;

          const inbound: InboundMessage = {
            id: randomUUID(),
            channelId: 'reddit',
            channelMessageId: comment.id,
            senderId: comment.author?.name ?? 'unknown',
            senderName: comment.author?.name,
            target: `comment:${comment.id}`,
            content: body,
            isGroup: true,
            groupId: sub,
            groupName: `r/${sub}`,
            threadId: comment.link_id,
            replyToId: comment.parent_id,
            timestamp: Math.floor(comment.created_utc),
            raw: comment,
          };

          await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
        }

        // Fetch new submissions
        const submissions: any[] = await (this.client.getSubreddit(sub).getNew({ limit: 10 }) as any);
        for (const submission of submissions) {
          if (this.seenIds.has(submission.id)) continue;
          this.seenIds.add(submission.id);

          const title = submission.title ?? '';
          const selftext = (submission as any).selftext ?? '';
          const combined = `${title}\n${selftext}`.trim();

          if (!combined.toLowerCase().includes(`u/${botUsername.toLowerCase()}`)) continue;

          const inbound: InboundMessage = {
            id: randomUUID(),
            channelId: 'reddit',
            channelMessageId: submission.id,
            senderId: submission.author?.name ?? 'unknown',
            senderName: submission.author?.name,
            target: `submission:${submission.id}`,
            content: combined,
            isGroup: true,
            groupId: sub,
            groupName: `r/${sub}`,
            threadId: submission.id,
            timestamp: Math.floor(submission.created_utc),
            raw: submission,
          };

          await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
        }
      } catch (err) {
        this.logger.error(`Error polling subreddit r/${sub}: ${err}`);
      }
    }

    // Prune seen IDs to prevent memory leak
    if (this.seenIds.size > 10000) {
      const arr = [...this.seenIds];
      this.seenIds = new Set(arr.slice(arr.length - 5000));
    }
  }
}

export default RedditChannel;
