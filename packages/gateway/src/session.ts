import type { WebSocket } from 'ws';

export interface WsSession {
  id: string;
  ws: WebSocket;
  channelId: string;
  senderId: string;
  senderName: string;
  conversationId?: string;
  connectedAt: number;
}

export class SessionManager {
  private sessions = new Map<string, WsSession>();
  private wsSessions = new Map<WebSocket, string>();

  create(ws: WebSocket, sessionId: string, senderId?: string, senderName?: string): WsSession {
    const session: WsSession = {
      id: sessionId,
      ws,
      channelId: 'gateway-ws',
      senderId: senderId ?? `ws-${sessionId}`,
      senderName: senderName ?? `WS User ${sessionId.slice(0, 8)}`,
      connectedAt: Date.now(),
    };

    this.sessions.set(sessionId, session);
    this.wsSessions.set(ws, sessionId);

    return session;
  }

  get(sessionId: string): WsSession | undefined {
    return this.sessions.get(sessionId);
  }

  getByWs(ws: WebSocket): WsSession | undefined {
    const sessionId = this.wsSessions.get(ws);
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  remove(ws: WebSocket): void {
    const sessionId = this.wsSessions.get(ws);
    if (sessionId) {
      this.sessions.delete(sessionId);
      this.wsSessions.delete(ws);
    }
  }

  all(): WsSession[] {
    return Array.from(this.sessions.values());
  }

  count(): number {
    return this.sessions.size;
  }
}
