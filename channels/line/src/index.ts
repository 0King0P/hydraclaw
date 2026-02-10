import { messagingApi, middleware, type MessageEvent as LineMessageEvent, type WebhookEvent } from '@line/bot-sdk';
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

const { MessagingApiClient } = messagingApi;

export class LineChannel implements Channel {
  readonly id = 'line';
  readonly name = 'LINE';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: false,
    video: false,
    files: true,
    reactions: false,
    threads: false,
    editing: false,
    groups: false,
    streaming: false,
  };

  private lineClient: InstanceType<typeof MessagingApiClient> | null = null;
  private server: Server | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'line' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const channelAccessToken = this.config.channelAccessToken as string | undefined;
    const channelSecret = this.config.channelSecret as string | undefined;

    if (!channelAccessToken || !channelSecret) {
      throw new Error('LINE channel requires channelAccessToken and channelSecret');
    }

    this.lineClient = new MessagingApiClient({
      channelAccessToken,
    });

    this.logger.info('LINE channel initialized');
  }

  async start(): Promise<void> {
    if (!this.lineClient) {
      throw new Error('LINE channel not initialized. Call init() first.');
    }

    const port = (this.config.port as number | undefined) ?? 3100;
    const channelSecret = this.config.channelSecret as string;

    const app = express();

    // LINE webhook middleware validates signature
    app.post(
      '/webhook',
      middleware({ channelSecret }),
      (req: any, res: any) => {
        const events: WebhookEvent[] = req.body.events;

        // Process events asynchronously
        Promise.all(events.map((event) => this.handleEvent(event))).catch((err) => {
          this.logger.error(`Error processing LINE events: ${err}`);
        });

        res.status(200).json({ status: 'ok' });
      },
    );

    await new Promise<void>((resolve) => {
      this.server = app.listen(port, () => {
        this.logger.info(`LINE webhook server listening on port ${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          if (err) {
            this.logger.error(`Error stopping LINE webhook server: ${err}`);
            reject(err);
          } else {
            this.logger.info('LINE webhook server stopped');
            resolve();
          }
        });
      });
      this.server = null;
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.lineClient) {
      throw new Error('LINE channel not initialized');
    }

    try {
      const messages: any[] = [];

      // Text message
      if (message.content) {
        messages.push({
          type: 'text',
          text: message.content,
        });
      }

      // Image messages
      if (message.images && message.images.length > 0) {
        for (const image of message.images) {
          // LINE requires a URL for images; convert buffer to base64 data URI
          const base64 = image.data.toString('base64');
          const dataUri = `data:${image.mimeType};base64,${base64}`;
          messages.push({
            type: 'image',
            originalContentUrl: dataUri,
            previewImageUrl: dataUri,
          });
        }
      }

      // File messages (as text with download link, since LINE SDK doesn't support arbitrary files natively)
      if (message.files && message.files.length > 0) {
        for (const file of message.files) {
          messages.push({
            type: 'text',
            text: `[File: ${file.filename}]`,
          });
        }
      }

      if (messages.length === 0) return;

      // Determine if target is a reply token or a user/group ID
      // Reply tokens start with a specific format; user IDs are longer hex strings
      if (target.startsWith('reply:')) {
        const replyToken = target.slice(6);
        await this.lineClient.replyMessage({
          replyToken,
          messages,
        });
      } else {
        // Push message to user or group
        await this.lineClient.pushMessage({
          to: target,
          messages,
        });
      }

      this.logger.debug(`Sent LINE message to ${target}`);
    } catch (err) {
      this.logger.error(`Failed to send LINE message to ${target}: ${err}`);
      throw err;
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private async handleEvent(event: WebhookEvent): Promise<void> {
    if (event.type !== 'message') return;

    const messageEvent = event as LineMessageEvent;
    const source = messageEvent.source;

    // Only handle text messages for now
    if (messageEvent.message.type !== 'text') return;

    const textMessage = messageEvent.message as any;
    const isGroup = source.type === 'group' || source.type === 'room';
    const senderId = source.userId ?? 'unknown';
    const groupId = source.type === 'group' ? (source as any).groupId : source.type === 'room' ? (source as any).roomId : undefined;

    const inbound: InboundMessage = {
      id: randomUUID(),
      channelId: 'line',
      channelMessageId: messageEvent.message.id,
      senderId,
      senderName: undefined,
      target: `reply:${messageEvent.replyToken}`,
      content: textMessage.text ?? '',
      isGroup,
      groupId,
      timestamp: Math.floor(messageEvent.timestamp / 1000),
      raw: event,
    };

    await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
  }
}

export default LineChannel;
