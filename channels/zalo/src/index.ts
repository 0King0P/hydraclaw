import express from 'express';
import type { Server } from 'node:http';
import { createHmac } from 'node:crypto';
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

const ZALO_OA_API_BASE = 'https://openapi.zalo.me/v3.0/oa';

export class ZaloChannel implements Channel {
  readonly id = 'zalo';
  readonly name = 'Zalo';
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

  private server: Server | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private accessToken!: string;
  private secretKey!: string;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'zalo' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const oaId = this.config.oaId as string | undefined;
    const secretKey = this.config.secretKey as string | undefined;
    const accessToken = this.config.accessToken as string | undefined;

    if (!oaId || !secretKey || !accessToken) {
      throw new Error('Zalo channel requires oaId, secretKey, and accessToken');
    }

    this.accessToken = accessToken;
    this.secretKey = secretKey;

    this.logger.info(`Zalo channel initialized for OA: ${oaId}`);
  }

  async start(): Promise<void> {
    const port = (this.config.port as number | undefined) ?? 3200;

    const app = express();
    app.use(express.json());

    // Webhook endpoint for Zalo events
    app.post('/webhook', async (req: any, res: any) => {
      try {
        // Verify webhook signature
        if (!this.verifySignature(req)) {
          this.logger.warn('Invalid Zalo webhook signature');
          res.status(403).json({ error: 'Invalid signature' });
          return;
        }

        const body = req.body;
        await this.handleWebhookEvent(body);
        res.status(200).json({ status: 'ok' });
      } catch (err) {
        this.logger.error(`Error handling Zalo webhook: ${err}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    await new Promise<void>((resolve) => {
      this.server = app.listen(port, () => {
        this.logger.info(`Zalo webhook server listening on port ${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          if (err) {
            this.logger.error(`Error stopping Zalo webhook server: ${err}`);
            reject(err);
          } else {
            this.logger.info('Zalo webhook server stopped');
            resolve();
          }
        });
      });
      this.server = null;
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    try {
      // Send text message
      if (message.content) {
        await this.callZaloApi('/message/cs', {
          recipient: { user_id: target },
          message: { text: message.content },
        });
      }

      // Send images
      if (message.images && message.images.length > 0) {
        for (const image of message.images) {
          const base64 = image.data.toString('base64');
          // Upload image first, then send
          await this.callZaloApi('/message/cs', {
            recipient: { user_id: target },
            message: {
              attachment: {
                type: 'template',
                payload: {
                  template_type: 'media',
                  elements: [{
                    media_type: 'image',
                    attachment_id: base64, // In practice, upload via Zalo upload API
                  }],
                },
              },
            },
          });
        }
      }

      // Send files
      if (message.files && message.files.length > 0) {
        for (const file of message.files) {
          await this.callZaloApi('/message/cs', {
            recipient: { user_id: target },
            message: {
              attachment: {
                type: 'file',
                payload: {
                  token: file.filename, // In practice, upload via Zalo file upload API first
                },
              },
            },
          });
        }
      }

      this.logger.debug(`Sent Zalo message to ${target}`);
    } catch (err) {
      this.logger.error(`Failed to send Zalo message to ${target}: ${err}`);
      throw err;
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private verifySignature(req: any): boolean {
    try {
      const signature = req.headers['x-zalooa-signature'] as string;
      if (!signature) return false;

      const body = JSON.stringify(req.body);
      const expectedSig = createHmac('sha256', this.secretKey)
        .update(body)
        .digest('hex');

      return signature === expectedSig;
    } catch {
      return false;
    }
  }

  private async handleWebhookEvent(body: Record<string, unknown>): Promise<void> {
    const eventName = body.event_name as string;

    // Handle user-sent messages
    if (eventName === 'user_send_text' || eventName === 'user_send_image' || eventName === 'user_send_file') {
      const sender = body.sender as Record<string, unknown> | undefined;
      const messageData = body.message as Record<string, unknown> | undefined;

      if (!sender || !messageData) return;

      const senderId = sender.id as string;
      const msgId = messageData.msg_id as string ?? randomUUID();
      const text = (messageData.text as string) ?? '';

      const inbound: InboundMessage = {
        id: randomUUID(),
        channelId: 'zalo',
        channelMessageId: msgId,
        senderId,
        senderName: undefined,
        target: senderId,
        content: text || `[${eventName}]`,
        isGroup: false,
        timestamp: Math.floor((body.timestamp as number ?? Date.now()) / 1000),
        raw: body,
      };

      // Handle image attachments
      if (eventName === 'user_send_image') {
        const url = messageData.url as string | undefined;
        if (url) {
          inbound.images = [{
            type: 'url',
            data: url,
            mimeType: 'image/jpeg',
          }];
        }
      }

      // Handle file attachments
      if (eventName === 'user_send_file') {
        const url = messageData.url as string | undefined;
        const name = (messageData.name as string) ?? 'file';
        const size = messageData.size as number | undefined;
        if (url) {
          inbound.files = [{
            url,
            mimeType: 'application/octet-stream',
            filename: name,
            size,
          }];
        }
      }

      await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
    }
  }

  private async callZaloApi(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${ZALO_OA_API_BASE}${path}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': this.accessToken,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Zalo API error ${response.status}: ${text}`);
    }

    const data = await response.json() as Record<string, unknown>;

    if ((data.error as number) !== 0) {
      throw new Error(`Zalo API error: ${data.message ?? 'Unknown error'}`);
    }

    return data;
  }
}

export default ZaloChannel;
