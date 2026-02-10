import { client as xmppClient, xml, jid as parseJid } from '@xmpp/client';
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

export class XmppChannel implements Channel {
  readonly id = 'xmpp';
  readonly name = 'XMPP';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: false,
    audio: false,
    video: false,
    files: false,
    reactions: false,
    threads: false,
    editing: false,
    groups: true,
    streaming: false,
  };

  private xmpp: ReturnType<typeof xmppClient> | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private myJid: string | null = null;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'xmpp' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    const service = this.config.service as string | undefined;
    const username = this.config.username as string | undefined;
    const password = this.config.password as string | undefined;

    if (!service || !username || !password) {
      throw new Error('XMPP channel requires service, username, and password');
    }

    this.xmpp = xmppClient({
      service,
      username,
      password,
    });

    this.setupHandlers();
    this.logger.info('XMPP channel initialized');
  }

  async start(): Promise<void> {
    if (!this.xmpp) {
      throw new Error('XMPP channel not initialized. Call init() first.');
    }

    this.logger.info('Connecting XMPP client...');

    try {
      await this.xmpp.start();
      this.logger.info('XMPP client connected and online');
    } catch (err) {
      this.logger.error(`Failed to start XMPP client: ${err}`);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.xmpp) {
      try {
        await this.xmpp.stop();
        this.logger.info('XMPP client disconnected');
      } catch (err) {
        this.logger.error(`Error stopping XMPP client: ${err}`);
      }
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (!this.xmpp) {
      throw new Error('XMPP channel not initialized');
    }

    try {
      // Determine if target is a groupchat (MUC) or direct message
      // Target format: "chat:user@server" or "groupchat:room@conference.server"
      const [type, to] = target.includes(':') ? target.split(':', 2) : ['chat', target];
      const msgType = type === 'groupchat' ? 'groupchat' : 'chat';

      const stanza = xml(
        'message',
        { type: msgType, to },
        xml('body', {}, message.content),
      );

      await this.xmpp.send(stanza);
      this.logger.debug(`Sent XMPP message to ${to} (${msgType})`);
    } catch (err) {
      this.logger.error(`Failed to send XMPP message to ${target}: ${err}`);
      throw err;
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private setupHandlers(): void {
    if (!this.xmpp) return;

    this.xmpp.on('online', (address: any) => {
      this.myJid = address?.toString() ?? null;
      this.logger.info(`XMPP online as ${this.myJid}`);

      // Send presence to indicate availability
      this.xmpp!.send(xml('presence'));
    });

    this.xmpp.on('stanza', async (stanza: any) => {
      try {
        if (!stanza.is('message')) return;

        const type = stanza.attrs.type;
        // Only handle chat and groupchat messages
        if (type !== 'chat' && type !== 'groupchat') return;

        const body = stanza.getChildText('body');
        if (!body) return;

        const from = stanza.attrs.from;
        if (!from) return;

        // Skip messages from ourselves
        const fromJid = parseJid(from);
        if (this.myJid && fromJid.bare().toString() === parseJid(this.myJid).bare().toString()) {
          return;
        }

        const isGroup = type === 'groupchat';
        const senderId = fromJid.bare().toString();
        const senderResource = fromJid.resource;

        const inbound: InboundMessage = {
          id: randomUUID(),
          channelId: 'xmpp',
          channelMessageId: stanza.attrs.id ?? randomUUID(),
          senderId,
          senderName: senderResource ?? senderId,
          target: isGroup ? `groupchat:${fromJid.bare().toString()}` : `chat:${senderId}`,
          content: body,
          isGroup,
          groupId: isGroup ? fromJid.bare().toString() : undefined,
          groupName: isGroup ? fromJid.local : undefined,
          threadId: stanza.getChild('thread')?.text() ?? undefined,
          timestamp: Math.floor(Date.now() / 1000),
          raw: stanza,
        };

        await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
      } catch (err) {
        this.logger.error(`Error handling XMPP stanza: ${err}`);
      }
    });

    this.xmpp.on('error', (err: Error) => {
      this.logger.error(`XMPP error: ${err.message}`);
    });

    this.xmpp.on('offline', () => {
      this.logger.warn('XMPP client went offline');
    });
  }
}

export default XmppChannel;
