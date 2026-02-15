import type { WebSocket } from 'ws';
import type { Logger, MessageBus } from '@hydraclaw/core';
import type { SessionManager, WsSession } from './session.js';

/**
 * Serialisable message structure for broadcast payloads.
 */
export interface BroadcastMessage {
  type: 'broadcast';
  topic?: string;
  groupId?: string;
  data: unknown;
  timestamp: number;
}

/**
 * Manages message broadcasting across WebSocket clients.
 *
 * Features:
 *   - Channel-scoped broadcasting
 *   - Group-level broadcasting across channels
 *   - Pub/sub topic subscriptions
 */
export class BroadcastManager {
  private sessions: SessionManager;
  private logger: Logger;
  private bus: MessageBus;

  /** topic -> Set of session IDs */
  private subscriptions = new Map<string, Set<string>>();
  /** session ID -> Set of topics */
  private sessionTopics = new Map<string, Set<string>>();

  constructor(sessions: SessionManager, logger: Logger, bus: MessageBus) {
    this.sessions = sessions;
    this.logger = logger;
    this.bus = bus;
  }

  // ---------------------------------------------------------------------------
  // Broadcasting
  // ---------------------------------------------------------------------------

  /**
   * Broadcast a message to all connected clients, optionally filtered by
   * channel IDs.
   *
   * @returns The number of clients the message was sent to.
   */
  broadcast(message: unknown, channelIds?: string[]): number {
    const payload = this.wrap(message);
    let sent = 0;

    for (const session of this.sessions.all()) {
      if (channelIds && channelIds.length > 0 && !channelIds.includes(session.channelId)) {
        continue;
      }
      if (this.send(session.ws, payload)) {
        sent++;
      }
    }

    this.logger.debug(`Broadcast sent to ${sent} client(s)`);
    this.bus.emitSync('broadcast:sent', { sent, channelIds });
    return sent;
  }

  /**
   * Broadcast a message to every client whose session belongs to the given group.
   *
   * Group membership is determined by the `groupId` field on `InboundMessage`;
   * if sessions have been created with a matching sender/group association this
   * method targets them regardless of the underlying channel.
   *
   * Because `WsSession` does not natively carry a `groupId`, this method
   * matches sessions whose `senderId` starts with the group prefix convention
   * `group:<groupId>:*` or whose channelId matches.  Alternatively callers
   * can pass explicit channel IDs as a secondary filter.
   */
  broadcastToGroup(groupId: string, message: unknown, channelIds?: string[]): number {
    const payload = this.wrapGroup(groupId, message);
    let sent = 0;

    for (const session of this.sessions.all()) {
      if (channelIds && channelIds.length > 0 && !channelIds.includes(session.channelId)) {
        continue;
      }
      // Match sessions associated with this group
      if (
        session.senderId.startsWith(`group:${groupId}:`) ||
        session.channelId === groupId
      ) {
        if (this.send(session.ws, payload)) {
          sent++;
        }
      }
    }

    this.logger.debug(`Group broadcast (${groupId}) sent to ${sent} client(s)`);
    return sent;
  }

  // ---------------------------------------------------------------------------
  // Pub/Sub topics
  // ---------------------------------------------------------------------------

  /**
   * Subscribe a client (identified by session ID) to one or more topics.
   */
  subscribe(clientId: string, topics: string[]): void {
    const session = this.sessions.get(clientId);
    if (!session) {
      this.logger.warn(`Cannot subscribe unknown session: ${clientId}`);
      return;
    }

    let clientTopics = this.sessionTopics.get(clientId);
    if (!clientTopics) {
      clientTopics = new Set();
      this.sessionTopics.set(clientId, clientTopics);
    }

    for (const topic of topics) {
      // Topic -> sessions
      let subscribers = this.subscriptions.get(topic);
      if (!subscribers) {
        subscribers = new Set();
        this.subscriptions.set(topic, subscribers);
      }
      subscribers.add(clientId);

      // Session -> topics
      clientTopics.add(topic);
    }

    this.logger.debug(
      `Session ${clientId} subscribed to: ${topics.join(', ')}`,
    );
  }

  /**
   * Unsubscribe a client from one or more topics. If `topics` is omitted the
   * client is unsubscribed from everything.
   */
  unsubscribe(clientId: string, topics?: string[]): void {
    const clientTopics = this.sessionTopics.get(clientId);
    if (!clientTopics) return;

    const toRemove = topics ?? Array.from(clientTopics);

    for (const topic of toRemove) {
      clientTopics.delete(topic);
      const subscribers = this.subscriptions.get(topic);
      if (subscribers) {
        subscribers.delete(clientId);
        if (subscribers.size === 0) {
          this.subscriptions.delete(topic);
        }
      }
    }

    if (clientTopics.size === 0) {
      this.sessionTopics.delete(clientId);
    }
  }

  /**
   * Publish data to all clients subscribed to the given topic.
   *
   * @returns The number of clients the message was delivered to.
   */
  publish(topic: string, data: unknown): number {
    const subscribers = this.subscriptions.get(topic);
    if (!subscribers || subscribers.size === 0) {
      return 0;
    }

    const payload = this.wrapTopic(topic, data);
    let sent = 0;

    for (const sessionId of subscribers) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        // Stale subscription – clean up
        subscribers.delete(sessionId);
        continue;
      }
      if (this.send(session.ws, payload)) {
        sent++;
      }
    }

    this.logger.debug(`Published to topic "${topic}": ${sent} recipient(s)`);
    this.bus.emitSync('broadcast:publish', { topic, sent });
    return sent;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Remove all subscriptions for a client (e.g. on disconnect).
   */
  removeClient(clientId: string): void {
    this.unsubscribe(clientId);
  }

  /**
   * Return current subscription statistics.
   */
  stats(): { topics: number; subscriptions: number } {
    let totalSubs = 0;
    for (const subs of this.subscriptions.values()) {
      totalSubs += subs.size;
    }
    return { topics: this.subscriptions.size, subscriptions: totalSubs };
  }

  /**
   * List all topics a given session is subscribed to.
   */
  getTopics(clientId: string): string[] {
    const topics = this.sessionTopics.get(clientId);
    return topics ? Array.from(topics) : [];
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private send(ws: WebSocket, payload: string): boolean {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
      return true;
    }
    return false;
  }

  private wrap(data: unknown): string {
    const msg: BroadcastMessage = {
      type: 'broadcast',
      data,
      timestamp: Date.now(),
    };
    return JSON.stringify(msg);
  }

  private wrapGroup(groupId: string, data: unknown): string {
    const msg: BroadcastMessage = {
      type: 'broadcast',
      groupId,
      data,
      timestamp: Date.now(),
    };
    return JSON.stringify(msg);
  }

  private wrapTopic(topic: string, data: unknown): string {
    const msg: BroadcastMessage = {
      type: 'broadcast',
      topic,
      data,
      timestamp: Date.now(),
    };
    return JSON.stringify(msg);
  }
}
