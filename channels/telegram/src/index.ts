import { Bot, InputFile, type Context } from 'grammy';
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

export class TelegramChannel implements Channel {
  readonly id = 'telegram';
  readonly name = 'Telegram';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: true,
    video: false,
    files: true,
    reactions: false,
    threads: true,
    editing: true,
    groups: true,
    streaming: false,
  };

  private bot: Bot | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'telegram' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const token = this.config.token as string | undefined;
    if (!token) {
      throw new Error('Telegram bot token is required (config.token)');
    }

    this.bot = new Bot(token);
    this.setupHandlers();
    this.logger.info('Telegram channel initialized');
  }

  async start(): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram channel not initialized. Call init() first.');
    }

    this.logger.info('Starting Telegram bot polling...');
    // Start polling in the background (non-blocking)
    this.bot.start({
      onStart: (botInfo) => {
        this.logger.info(`Telegram bot started: @${botInfo.username}`);
      },
    });
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.logger.info('Stopping Telegram bot...');
      await this.bot.stop();
      this.logger.info('Telegram bot stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram channel not initialized');
    }

    const chatId = target;
    const replyParams = message.replyToId
      ? { reply_parameters: { message_id: parseInt(message.replyToId, 10) } }
      : {};

    // Send text content
    if (message.content) {
      await this.bot.api.sendMessage(chatId, message.content, {
        parse_mode: 'Markdown',
        ...replyParams,
      });
    }

    // Send images
    if (message.images && message.images.length > 0) {
      for (const image of message.images) {
        await this.bot.api.sendPhoto(chatId, new InputFile(image.data, image.filename ?? 'image.png'), {
          caption: image.filename,
          ...replyParams,
        });
      }
    }

    // Send files
    if (message.files && message.files.length > 0) {
      for (const file of message.files) {
        await this.bot.api.sendDocument(chatId, new InputFile(file.data, file.filename), {
          caption: file.filename,
          ...replyParams,
        });
      }
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private setupHandlers(): void {
    if (!this.bot) return;

    // Handle all message types
    this.bot.on('message', async (ctx: Context) => {
      try {
        const msg = ctx.message;
        if (!msg) return;

        const inbound = await this.convertToInbound(ctx);
        if (inbound) {
          await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
        }
      } catch (err) {
        this.logger.error(`Error handling Telegram message: ${err}`);
      }
    });
  }

  private async convertToInbound(ctx: Context): Promise<InboundMessage | null> {
    const msg = ctx.message;
    if (!msg) return null;

    const chat = msg.chat;
    const from = msg.from;
    if (!from) return null;

    const isGroup = chat.type === 'group' || chat.type === 'supergroup';

    // Extract text content
    let content = msg.text ?? msg.caption ?? '';

    // Extract images from photo messages
    const images: ImageInput[] = [];
    if (msg.photo && msg.photo.length > 0) {
      // Get the largest photo (last in array)
      const largestPhoto = msg.photo[msg.photo.length - 1];
      try {
        const file = await ctx.api.getFile(largestPhoto.file_id);
        if (file.file_path) {
          const token = this.config.token as string;
          const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
          images.push({
            type: 'url',
            data: url,
            mimeType: 'image/jpeg',
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to get photo file: ${err}`);
      }
    }

    // Extract file attachments
    const files: FileAttachment[] = [];
    if (msg.document) {
      try {
        const file = await ctx.api.getFile(msg.document.file_id);
        if (file.file_path) {
          const token = this.config.token as string;
          const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
          files.push({
            url,
            mimeType: msg.document.mime_type ?? 'application/octet-stream',
            filename: msg.document.file_name ?? 'document',
            size: msg.document.file_size,
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to get document file: ${err}`);
      }
    }

    // Handle voice messages
    if (msg.voice) {
      try {
        const file = await ctx.api.getFile(msg.voice.file_id);
        if (file.file_path) {
          const token = this.config.token as string;
          const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
          files.push({
            url,
            mimeType: msg.voice.mime_type ?? 'audio/ogg',
            filename: 'voice.ogg',
            size: msg.voice.file_size,
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to get voice file: ${err}`);
      }
    }

    // If no text and no caption, but has media, set a placeholder
    if (!content && (images.length > 0 || files.length > 0)) {
      content = '[media]';
    }

    // Skip entirely empty messages
    if (!content && images.length === 0 && files.length === 0) {
      return null;
    }

    const inbound: InboundMessage = {
      id: randomUUID(),
      channelId: 'telegram',
      channelMessageId: String(msg.message_id),
      senderId: String(from.id),
      senderName: from.first_name + (from.last_name ? ` ${from.last_name}` : ''),
      target: String(chat.id),
      content,
      images: images.length > 0 ? images : undefined,
      files: files.length > 0 ? files : undefined,
      replyToId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined,
      groupId: isGroup ? String(chat.id) : undefined,
      groupName: isGroup && 'title' in chat ? (chat.title ?? undefined) : undefined,
      isGroup,
      timestamp: msg.date,
      raw: msg,
    };

    return inbound;
  }
}

export default TelegramChannel;
