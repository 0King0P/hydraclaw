import {
  createClient,
  type MatrixClient,
  type IEvent,
  type Room,
  MsgType,
  EventType,
} from 'matrix-js-sdk';
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

export class MatrixChannel implements Channel {
  readonly id = 'matrix';
  readonly name = 'Matrix';
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

  private client: MatrixClient | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private userId!: string;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'matrix' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const homeserverUrl = this.config.homeserverUrl as string | undefined;
    const accessToken = this.config.accessToken as string | undefined;
    const userId = this.config.userId as string | undefined;

    if (!homeserverUrl) {
      throw new Error('Matrix homeserver URL is required (config.homeserverUrl)');
    }
    if (!accessToken) {
      throw new Error('Matrix access token is required (config.accessToken)');
    }
    if (!userId) {
      throw new Error('Matrix user ID is required (config.userId)');
    }

    this.userId = userId;

    this.client = createClient({
      baseUrl: homeserverUrl,
      accessToken,
      userId,
    });

    this.logger.info('Matrix channel initialized');
  }

  async start(): Promise<void> {
    if (!this.client) {
      throw new Error('Matrix channel not initialized. Call init() first.');
    }

    this.logger.info('Starting Matrix client...');
    this.setupHandlers();
    await this.client.startClient({ initialSyncLimit: 0 });
    this.logger.info('Matrix client started and syncing');
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.logger.info('Stopping Matrix client...');
      this.client.stopClient();
      this.client = null;
      this.logger.info('Matrix client stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.client) {
      throw new Error('Matrix channel not initialized');
    }

    const roomId = target;

    // Send text content
    if (message.content) {
      const content: Record<string, unknown> = {
        msgtype: MsgType.Text,
        body: message.content,
      };

      if (message.threadId) {
        content['m.relates_to'] = {
          rel_type: 'm.thread',
          event_id: message.threadId,
        };
      }

      if (message.replyToId) {
        content['m.relates_to'] = {
          ...(content['m.relates_to'] as Record<string, unknown> ?? {}),
          'm.in_reply_to': { event_id: message.replyToId },
        };
      }

      await this.client.sendEvent(roomId, EventType.RoomMessage, content as any);
    }

    // Upload and send images
    if (message.images && message.images.length > 0) {
      for (const image of message.images) {
        try {
          const uploadResponse = await this.client.uploadContent(image.data, {
            type: image.mimeType,
            name: image.filename ?? 'image.png',
          });

          await this.client.sendEvent(roomId, EventType.RoomMessage, {
            msgtype: MsgType.Image,
            body: image.filename ?? 'image.png',
            url: uploadResponse.content_uri,
            info: { mimetype: image.mimeType },
          } as any);
        } catch (err) {
          this.logger.error(`Failed to upload image to Matrix: ${err}`);
        }
      }
    }

    // Upload and send files
    if (message.files && message.files.length > 0) {
      for (const file of message.files) {
        try {
          const uploadResponse = await this.client.uploadContent(file.data, {
            type: file.mimeType,
            name: file.filename,
          });

          await this.client.sendEvent(roomId, EventType.RoomMessage, {
            msgtype: MsgType.File,
            body: file.filename,
            url: uploadResponse.content_uri,
            info: { mimetype: file.mimeType, size: file.data.length },
          } as any);
        } catch (err) {
          this.logger.error(`Failed to upload file to Matrix: ${err}`);
        }
      }
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private setupHandlers(): void {
    if (!this.client) return;

    this.client.on('Room.timeline' as any, async (event: any, room: Room | undefined) => {
      try {
        // Only process room messages
        if (event.getType() !== EventType.RoomMessage) return;

        // Ignore own messages
        if (event.getSender() === this.userId) return;

        // Ignore historical messages (only process live events)
        const content = event.getContent();
        if (!content) return;

        const inbound = this.convertToInbound(event, room);
        if (inbound) {
          await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
        }
      } catch (err) {
        this.logger.error(`Error handling Matrix message: ${err}`);
      }
    });
  }

  private convertToInbound(event: any, room: Room | undefined): InboundMessage | null {
    const content = event.getContent();
    const sender = event.getSender();
    const roomId = event.getRoomId();

    let textContent = '';
    const images: ImageInput[] = [];
    const files: FileAttachment[] = [];

    const msgtype = content.msgtype;

    if (msgtype === MsgType.Text || msgtype === MsgType.Notice) {
      textContent = content.body ?? '';
    } else if (msgtype === MsgType.Image) {
      textContent = content.body ?? '[image]';
      if (content.url && this.client) {
        const httpUrl = this.client.mxcUrlToHttp(content.url);
        if (httpUrl) {
          images.push({
            type: 'url',
            data: httpUrl,
            mimeType: content.info?.mimetype ?? 'image/png',
          });
        }
      }
    } else if (msgtype === MsgType.File || msgtype === MsgType.Audio || msgtype === MsgType.Video) {
      textContent = content.body ?? '[file]';
      if (content.url && this.client) {
        const httpUrl = this.client.mxcUrlToHttp(content.url);
        if (httpUrl) {
          files.push({
            url: httpUrl,
            mimeType: content.info?.mimetype ?? 'application/octet-stream',
            filename: content.body ?? 'file',
            size: content.info?.size,
          });
        }
      }
    } else {
      textContent = content.body ?? '';
    }

    if (!textContent && images.length === 0 && files.length === 0) {
      return null;
    }

    // Determine group info
    const isGroup = (room?.getJoinedMemberCount() ?? 0) > 2;

    // Extract thread info
    const relatesTo = content['m.relates_to'];
    const threadId = relatesTo?.rel_type === 'm.thread' ? relatesTo.event_id : undefined;
    const replyToId = relatesTo?.['m.in_reply_to']?.event_id ?? undefined;

    return {
      id: randomUUID(),
      channelId: 'matrix',
      channelMessageId: event.getId(),
      senderId: sender,
      senderName: room?.getMember(sender)?.name ?? sender,
      target: roomId,
      content: textContent,
      images: images.length > 0 ? images : undefined,
      files: files.length > 0 ? files : undefined,
      replyToId,
      threadId,
      groupId: isGroup ? roomId : undefined,
      groupName: isGroup ? room?.name ?? undefined : undefined,
      isGroup,
      timestamp: event.getTs(),
      raw: event,
    };
  }
}

export default MatrixChannel;
