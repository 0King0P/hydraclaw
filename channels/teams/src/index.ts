import {
  BotFrameworkAdapter,
  TurnContext,
  ConversationReference,
  ActivityTypes,
  type Activity,
} from 'botbuilder';
import express from 'express';
import type { Server } from 'node:http';
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

export class TeamsChannel implements Channel {
  readonly id = 'teams';
  readonly name = 'Microsoft Teams';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: false,
    video: false,
    files: true,
    reactions: false,
    threads: true,
    editing: false,
    groups: true,
    streaming: false,
  };

  private adapter: BotFrameworkAdapter | null = null;
  private server: Server | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private conversationRefs = new Map<string, Partial<ConversationReference>>();

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'teams' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const appId = this.config.appId as string | undefined;
    const appPassword = this.config.appPassword as string | undefined;

    if (!appId || !appPassword) {
      throw new Error('Teams channel requires appId and appPassword');
    }

    this.adapter = new BotFrameworkAdapter({
      appId,
      appPassword,
    });

    // Error handler
    this.adapter.onTurnError = async (context: TurnContext, error: Error) => {
      this.logger.error(`Teams adapter error: ${error.message}`);
      try {
        await context.sendActivity('An error occurred processing your message.');
      } catch (sendErr) {
        this.logger.error(`Failed to send error response: ${sendErr}`);
      }
    };

    this.logger.info('Teams channel initialized');
  }

  async start(): Promise<void> {
    if (!this.adapter) {
      throw new Error('Teams channel not initialized. Call init() first.');
    }

    const port = (this.config.port as number | undefined) ?? 3978;
    const app = express();

    app.use(express.json());

    app.post('/api/messages', (req: any, res: any) => {
      this.adapter!.processActivity(req, res, async (context: TurnContext) => {
        try {
          await this.handleActivity(context);
        } catch (err) {
          this.logger.error(`Error handling Teams activity: ${err}`);
        }
      });
    });

    await new Promise<void>((resolve) => {
      this.server = app.listen(port, () => {
        this.logger.info(`Teams webhook server listening on port ${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          if (err) {
            this.logger.error(`Error stopping Teams webhook server: ${err}`);
            reject(err);
          } else {
            this.logger.info('Teams webhook server stopped');
            resolve();
          }
        });
      });
      this.server = null;
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.adapter) {
      throw new Error('Teams channel not initialized');
    }

    const conversationRef = this.conversationRefs.get(target);
    if (!conversationRef) {
      this.logger.error(`No conversation reference found for target: ${target}`);
      throw new Error(`Unknown conversation target: ${target}`);
    }

    try {
      await this.adapter.continueConversation(conversationRef, async (context: TurnContext) => {
        const activity: Partial<Activity> = {
          type: ActivityTypes.Message,
          text: message.content,
        };

        // Attach images
        if (message.images && message.images.length > 0) {
          activity.attachments = message.images.map((image: any) => ({
            contentType: image.mimeType,
            contentUrl: `data:${image.mimeType};base64,${image.data.toString('base64')}`,
            name: image.filename ?? 'image',
          }));
        }

        // Attach files
        if (message.files && message.files.length > 0) {
          const fileAttachments = message.files.map((file: any) => ({
            contentType: file.mimeType,
            contentUrl: `data:${file.mimeType};base64,${file.data.toString('base64')}`,
            name: file.filename,
          }));
          activity.attachments = [...(activity.attachments ?? []), ...fileAttachments];
        }

        // Thread support
        if (message.replyToId) {
          activity.replyToId = message.replyToId;
        }

        await context.sendActivity(activity);
      });

      this.logger.debug(`Sent Teams message to ${target}`);
    } catch (err) {
      this.logger.error(`Failed to send Teams message to ${target}: ${err}`);
      throw err;
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private async handleActivity(context: TurnContext): Promise<void> {
    const activity = context.activity;

    if (activity.type !== ActivityTypes.Message) return;

    // Store conversation reference for proactive messaging
    const conversationRef = TurnContext.getConversationReference(activity);
    const conversationId = activity.conversation?.id ?? randomUUID();
    this.conversationRefs.set(conversationId, conversationRef);

    const isGroup = activity.conversation?.isGroup === true ||
      activity.conversation?.conversationType === 'channel' ||
      activity.conversation?.conversationType === 'groupChat';

    const inbound: InboundMessage = {
      id: randomUUID(),
      channelId: 'teams',
      channelMessageId: activity.id ?? randomUUID(),
      senderId: activity.from?.id ?? 'unknown',
      senderName: activity.from?.name,
      target: conversationId,
      content: activity.text ?? '',
      isGroup,
      groupId: isGroup ? conversationId : undefined,
      groupName: activity.conversation?.name ?? undefined,
      threadId: activity.conversation?.id,
      replyToId: activity.replyToId ?? undefined,
      timestamp: activity.timestamp ? Math.floor(new Date(activity.timestamp as any).getTime() / 1000) : Math.floor(Date.now() / 1000),
      raw: activity,
    };

    // Handle attachments (images/files)
    if (activity.attachments && activity.attachments.length > 0) {
      const images: InboundMessage['images'] = [];
      const files: InboundMessage['files'] = [];

      for (const attachment of activity.attachments) {
        if (attachment.contentType?.startsWith('image/')) {
          images.push({
            type: 'url',
            data: attachment.contentUrl ?? '',
            mimeType: attachment.contentType,
          });
        } else if (attachment.contentUrl) {
          files.push({
            url: attachment.contentUrl,
            mimeType: attachment.contentType ?? 'application/octet-stream',
            filename: attachment.name ?? 'file',
          });
        }
      }

      if (images.length > 0) inbound.images = images;
      if (files.length > 0) inbound.files = files;
    }

    await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
  }
}

export default TeamsChannel;
