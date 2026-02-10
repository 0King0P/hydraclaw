import Imap from 'imap';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { simpleParser } from 'mailparser';
import type {
  Channel,
  ChannelCapabilities,
  InboundMessage,
  OutboundMessage,
  PluginContext,
  FileAttachment,
  Logger,
  MessageBus,
} from '@hydraclaw/core';
import { Events } from '@hydraclaw/core';
import { randomUUID } from 'node:crypto';

export class EmailChannel implements Channel {
  readonly id = 'email';
  readonly name = 'Email';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: false,
    audio: false,
    video: false,
    files: true,
    reactions: false,
    threads: false,
    editing: false,
    groups: false,
    streaming: false,
  };

  private imap: any = null;
  private transporter: Transporter | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private isListening = false;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'email' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const imapConfig = this.config.imap as Record<string, unknown> | undefined;
    const smtpConfig = this.config.smtp as Record<string, unknown> | undefined;

    if (!imapConfig) {
      throw new Error('IMAP configuration is required (config.imap)');
    }
    if (!smtpConfig) {
      throw new Error('SMTP configuration is required (config.smtp)');
    }

    // Create IMAP connection
    this.imap = new Imap({
      user: imapConfig.user as string,
      password: imapConfig.password as string,
      host: imapConfig.host as string,
      port: (imapConfig.port as number) ?? 993,
      tls: (imapConfig.tls as boolean) !== false,
      tlsOptions: { rejectUnauthorized: false },
    });

    // Create SMTP transporter
    this.transporter = nodemailer.createTransport({
      host: smtpConfig.host as string,
      port: (smtpConfig.port as number) ?? 587,
      secure: (smtpConfig.secure as boolean) ?? false,
      auth: {
        user: smtpConfig.user as string,
        pass: smtpConfig.password as string,
      },
    });

    this.logger.info('Email channel initialized');
  }

  async start(): Promise<void> {
    if (!this.imap) {
      throw new Error('Email channel not initialized. Call init() first.');
    }

    this.isListening = true;
    this.logger.info('Starting email listener...');

    return new Promise<void>((resolve, reject) => {
      this.imap!.once('ready', () => {
        this.logger.info('IMAP connection established');
        this.startListening();
        resolve();
      });

      this.imap!.once('error', (err: Error) => {
        this.logger.error(`IMAP connection error: ${err.message}`);
        if (!this.isListening) {
          reject(err);
        }
      });

      this.imap!.once('end', () => {
        this.logger.info('IMAP connection ended');
        if (this.isListening) {
          this.logger.info('Attempting to reconnect IMAP...');
          setTimeout(() => {
            if (this.isListening) {
              try {
                this.imap?.connect();
              } catch (err) {
                this.logger.error(`IMAP reconnect failed: ${err}`);
              }
            }
          }, 5000);
        }
      });

      this.imap!.connect();
    });
  }

  async stop(): Promise<void> {
    this.isListening = false;
    if (this.imap) {
      this.logger.info('Stopping email listener...');
      try {
        this.imap.end();
      } catch {
        // Ignore errors during shutdown
      }
      this.logger.info('Email channel stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email channel not initialized');
    }

    const smtpConfig = this.config.smtp as Record<string, unknown>;
    const from = (this.config.fromAddress as string) ?? (smtpConfig.user as string);

    const mailOptions: Record<string, unknown> = {
      from,
      to: target,
      subject: (message as unknown as Record<string, unknown>).subject ?? 'Message from HydraClaw',
      text: message.content,
    };

    // Add file attachments
    if (message.files && message.files.length > 0) {
      mailOptions.attachments = message.files.map((file) => ({
        filename: file.filename,
        content: file.data,
        contentType: file.mimeType,
      }));
    }

    await this.transporter.sendMail(mailOptions as any);
    this.logger.debug(`Email sent to ${target}`);
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private startListening(): void {
    if (!this.imap) return;

    this.imap.openBox('INBOX', false, (err: any) => {
      if (err) {
        this.logger.error(`Failed to open INBOX: ${err.message}`);
        return;
      }

      this.logger.info('Listening for new emails in INBOX');

      this.imap!.on('mail', () => {
        this.fetchNewEmails();
      });
    });
  }

  private fetchNewEmails(): void {
    if (!this.imap) return;

    // Search for unseen messages
    this.imap.search(['UNSEEN'], (err: any, results: any) => {
      if (err) {
        this.logger.error(`IMAP search error: ${err.message}`);
        return;
      }

      if (!results || results.length === 0) return;

      const fetch = this.imap!.fetch(results, {
        bodies: '',
        markSeen: true,
      });

      fetch.on('message', (msg: any) => {
        let rawEmail = '';

        msg.on('body', (stream: any) => {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          stream.on('end', () => {
            rawEmail = Buffer.concat(chunks).toString('utf-8');
          });
        });

        msg.once('end', () => {
          this.processEmail(rawEmail);
        });
      });

      fetch.once('error', (err: Error) => {
        this.logger.error(`IMAP fetch error: ${err.message}`);
      });
    });
  }

  private async processEmail(rawEmail: string): Promise<void> {
    try {
      const parsed: any = await simpleParser(rawEmail as any);

      const from = parsed.from?.value?.[0];
      if (!from) return;

      const content = parsed.text ?? parsed.html ?? '';
      if (!content) return;

      const files: FileAttachment[] = [];
      if (parsed.attachments && parsed.attachments.length > 0) {
        for (const attachment of parsed.attachments) {
          files.push({
            data: attachment.content,
            mimeType: attachment.contentType,
            filename: attachment.filename ?? 'attachment',
            size: attachment.size,
          });
        }
      }

      const inbound: InboundMessage = {
        id: randomUUID(),
        channelId: 'email',
        channelMessageId: parsed.messageId ?? undefined,
        senderId: from.address ?? 'unknown',
        senderName: from.name ?? from.address ?? 'unknown',
        target: (parsed.to as any)?.value?.[0]?.address ?? '',
        content,
        files: files.length > 0 ? files : undefined,
        isGroup: false,
        timestamp: parsed.date?.getTime() ?? Date.now(),
        raw: parsed,
      };

      await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
    } catch (err) {
      this.logger.error(`Error processing email: ${err}`);
    }
  }
}

export default EmailChannel;
