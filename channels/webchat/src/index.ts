import type {
  Channel,
  ChannelCapabilities,
  InboundMessage,
  OutboundMessage,
  PluginContext,
  Logger,
  MessageBus,
  Container,
} from '@hydraclaw/core';
import { Events } from '@hydraclaw/core';
import { randomUUID } from 'node:crypto';

/**
 * WebChat channel - a bridge between the gateway's HTTP/WS endpoints
 * and the HydraClaw message bus.
 *
 * This channel does not run its own server. Instead it relies on the
 * gateway package to handle HTTP and WebSocket connections. It registers
 * itself so the gateway can route web-client messages through it.
 *
 * Inbound messages arrive via the gateway's /api/chat endpoint or
 * WebSocket connections. The gateway calls handleWebMessage() to inject
 * them into the bus.
 *
 * Outbound messages are broadcast to all connected WebSocket clients
 * via the container-registered broadcast function.
 */

type WsBroadcastFn = (data: string) => void;

export class WebChatChannel implements Channel {
  readonly id = 'webchat';
  readonly name = 'WebChat';
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
    streaming: true,
  };

  private logger!: Logger;
  private bus!: MessageBus;
  private container!: Container;
  private config!: Record<string, unknown>;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'webchat' });
    this.bus = ctx.bus;
    this.container = ctx.container;
    this.config = ctx.config;

    // Register this channel instance in the container so the gateway
    // can access it to forward web messages
    this.container.registerInstance('channel:webchat', this);

    this.logger.info('WebChat channel initialized');
  }

  async start(): Promise<void> {
    // No-op: the gateway handles HTTP/WS server lifecycle.
    // We just confirm we are ready.
    this.logger.info('WebChat channel started (gateway handles connections)');
  }

  async stop(): Promise<void> {
    this.logger.info('WebChat channel stopped');
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    // Broadcast to connected WebSocket clients via the gateway
    let broadcast: WsBroadcastFn | undefined;
    if (this.container.has('ws:broadcast')) {
      broadcast = this.container.resolve<WsBroadcastFn>('ws:broadcast');
    }

    const payload = JSON.stringify({
      type: 'message',
      target,
      content: message.content,
      images: message.images?.map((img: any) => ({
        data: img.data.toString('base64'),
        mimeType: img.mimeType,
        filename: img.filename,
      })),
      files: message.files?.map((f: any) => ({
        data: f.data.toString('base64'),
        mimeType: f.mimeType,
        filename: f.filename,
      })),
      replyToId: message.replyToId,
      threadId: message.threadId,
      timestamp: Date.now(),
    });

    if (broadcast) {
      broadcast(payload);
    } else {
      this.logger.warn('No WebSocket broadcast function registered; message not sent to web clients');
    }
  }

  /**
   * Called by the gateway when a message arrives from a web client
   * (via REST or WebSocket).
   */
  async handleWebMessage(data: {
    content: string;
    senderId?: string;
    senderName?: string;
    sessionId?: string;
    images?: Array<{ data: string; mimeType: string }>;
    files?: Array<{ data: string; mimeType: string; filename: string }>;
  }): Promise<void> {
    const inbound: InboundMessage = {
      id: randomUUID(),
      channelId: 'webchat',
      senderId: data.senderId ?? data.sessionId ?? 'web-anonymous',
      senderName: data.senderName ?? 'Web User',
      target: data.sessionId ?? 'webchat',
      content: data.content,
      images: data.images?.map((img) => ({
        type: 'base64' as const,
        data: img.data,
        mimeType: img.mimeType,
      })),
      files: data.files?.map((f) => ({
        data: Buffer.from(f.data, 'base64'),
        mimeType: f.mimeType,
        filename: f.filename,
      })),
      isGroup: false,
      timestamp: Date.now(),
    };

    await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
  }

  async destroy(): Promise<void> {
    await this.stop();
  }
}

export default WebChatChannel;
