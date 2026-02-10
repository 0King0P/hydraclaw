import baileys, {
  DisconnectReason,
  type WASocket,
  type BaileysEventMap,
  type proto,
} from '@whiskeysockets/baileys';
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
import { Boom } from '@hapi/boom';
import path from 'node:path';

export class WhatsAppChannel implements Channel {
  readonly id = 'whatsapp';
  readonly name = 'WhatsApp';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: true,
    video: false,
    files: true,
    reactions: true,
    threads: false,
    editing: false,
    groups: true,
    streaming: false,
  };

  private socket: WASocket | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private authDir!: string;
  private shouldReconnect = true;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'whatsapp' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    this.authDir = (this.config.authDir as string) ?? path.join(process.cwd(), 'data', 'whatsapp-auth');
    this.logger.info('WhatsApp channel initialized');
  }

  async start(): Promise<void> {
    this.shouldReconnect = true;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.shouldReconnect = false;
    if (this.socket) {
      this.logger.info('Stopping WhatsApp connection...');
      this.socket.end(undefined);
      this.socket = null;
      this.logger.info('WhatsApp connection stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.socket) {
      throw new Error('WhatsApp channel not connected');
    }

    const jid = target;

    // Send text content
    if (message.content) {
      await this.socket.sendMessage(jid, { text: message.content });
    }

    // Send images
    if (message.images && message.images.length > 0) {
      for (const image of message.images) {
        await this.socket.sendMessage(jid, {
          image: image.data,
          mimetype: image.mimeType,
          caption: image.filename,
        });
      }
    }

    // Send files as documents
    if (message.files && message.files.length > 0) {
      for (const file of message.files) {
        await this.socket.sendMessage(jid, {
          document: file.data,
          mimetype: file.mimeType,
          fileName: file.filename,
        });
      }
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await (baileys as any).useMultiFileAuthState(this.authDir);

    const makeWASocket = (baileys as any).default ?? baileys;
    this.socket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
    });

    // Save credentials on update
    this.socket!.ev.on('creds.update', saveCreds);

    // Handle connection updates
    this.socket!.ev.on('connection.update', (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.logger.info('QR code displayed in terminal - scan with WhatsApp to authenticate');
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut && this.shouldReconnect;

        this.logger.warn(`WhatsApp connection closed. Reason: ${reason}`);

        if (shouldReconnect) {
          this.logger.info('Reconnecting to WhatsApp...');
          setTimeout(() => this.connect(), 3000);
        } else {
          this.logger.info('WhatsApp logged out or reconnect disabled');
        }
      } else if (connection === 'open') {
        this.logger.info('WhatsApp connection established');
      }
    });

    // Handle incoming messages
    this.socket!.ev.on('messages.upsert', async (upsert: any) => {
      if (upsert.type !== 'notify') return;

      for (const msg of upsert.messages) {
        try {
          // Skip status broadcast messages
          if (msg.key.remoteJid === 'status@broadcast') continue;
          // Skip messages from self
          if (msg.key.fromMe) continue;

          const inbound = await this.convertToInbound(msg);
          if (inbound) {
            await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
          }
        } catch (err) {
          this.logger.error(`Error handling WhatsApp message: ${err}`);
        }
      }
    });
  }

  private async convertToInbound(msg: proto.IWebMessageInfo): Promise<InboundMessage | null> {
    const jid = msg.key?.remoteJid;
    if (!jid) return null;

    const isGroup = jid.endsWith('@g.us');
    const senderId = isGroup ? (msg.key!.participant ?? jid) : jid;
    const senderName = msg.pushName ?? senderId;

    // Extract message content
    const messageContent = msg.message;
    if (!messageContent) return null;

    let content = '';
    const images: ImageInput[] = [];
    const files: FileAttachment[] = [];

    // Text message
    if (messageContent.conversation) {
      content = messageContent.conversation;
    } else if (messageContent.extendedTextMessage?.text) {
      content = messageContent.extendedTextMessage.text;
    }

    // Image message
    if (messageContent.imageMessage) {
      content = messageContent.imageMessage.caption ?? content ?? '[image]';
      try {
        const downloadMediaMessage = (baileys as any).downloadMediaMessage;
        const buffer = downloadMediaMessage ? await downloadMediaMessage(msg, 'buffer', {}) : null;
        if (buffer) {
          images.push({
            type: 'base64',
            data: (buffer as Buffer).toString('base64'),
            mimeType: messageContent.imageMessage.mimetype ?? 'image/jpeg',
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to download WhatsApp image: ${err}`);
      }
    }

    // Document message
    if (messageContent.documentMessage) {
      content = messageContent.documentMessage.caption ?? content ?? '[document]';
      try {
        const downloadMediaMessage = (baileys as any).downloadMediaMessage;
        const buffer = downloadMediaMessage ? await downloadMediaMessage(msg, 'buffer', {}) : null;
        if (buffer) {
          files.push({
            data: buffer as Buffer,
            mimeType: messageContent.documentMessage.mimetype ?? 'application/octet-stream',
            filename: messageContent.documentMessage.fileName ?? 'document',
            size: messageContent.documentMessage.fileLength
              ? Number(messageContent.documentMessage.fileLength)
              : undefined,
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to download WhatsApp document: ${err}`);
      }
    }

    // Audio message
    if (messageContent.audioMessage) {
      content = content || '[audio]';
      try {
        const downloadMediaMessage = (baileys as any).downloadMediaMessage;
        const buffer = downloadMediaMessage ? await downloadMediaMessage(msg, 'buffer', {}) : null;
        if (buffer) {
          files.push({
            data: buffer as Buffer,
            mimeType: messageContent.audioMessage.mimetype ?? 'audio/ogg',
            filename: 'audio.ogg',
            size: messageContent.audioMessage.fileLength
              ? Number(messageContent.audioMessage.fileLength)
              : undefined,
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to download WhatsApp audio: ${err}`);
      }
    }

    if (!content && images.length === 0 && files.length === 0) {
      return null;
    }

    return {
      id: randomUUID(),
      channelId: 'whatsapp',
      channelMessageId: msg.key?.id ?? undefined,
      senderId,
      senderName,
      target: jid,
      content,
      images: images.length > 0 ? images : undefined,
      files: files.length > 0 ? files : undefined,
      replyToId: messageContent.extendedTextMessage?.contextInfo?.stanzaId ?? undefined,
      groupId: isGroup ? jid : undefined,
      groupName: isGroup ? undefined : undefined,
      isGroup,
      timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : Date.now(),
      raw: msg,
    };
  }
}

export default WhatsAppChannel;
