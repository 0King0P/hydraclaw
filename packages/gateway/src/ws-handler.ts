import type { WebSocket } from 'ws';
import type { Container, InboundMessage, StreamChunk, Logger } from '@hydraclaw/core';
import type { Agent } from '@hydraclaw/agent';
import type { SessionManager } from './session.js';
import { randomUUID } from 'node:crypto';

export interface WsIncomingMessage {
  type: 'chat';
  content: string;
  channelId?: string;
  senderId?: string;
  senderName?: string;
  images?: InboundMessage['images'];
  files?: InboundMessage['files'];
}

interface WsStreamMessage {
  type: 'stream';
  chunk: StreamChunk;
}

interface WsCompleteMessage {
  type: 'complete';
  result: {
    content: string;
    model: string;
    provider: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  };
}

interface WsErrorMessage {
  type: 'error';
  error: string;
}

type WsOutgoingMessage = WsStreamMessage | WsCompleteMessage | WsErrorMessage;

function sendWsMessage(ws: WebSocket, message: WsOutgoingMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export function createWsHandler(container: Container, sessions: SessionManager) {
  const logger = container.resolve<Logger>('logger');

  return async (ws: WebSocket, raw: string): Promise<void> => {
    let parsed: WsIncomingMessage;

    try {
      parsed = JSON.parse(raw) as WsIncomingMessage;
    } catch {
      sendWsMessage(ws, { type: 'error', error: 'Invalid JSON' });
      return;
    }

    if (parsed.type !== 'chat') {
      sendWsMessage(ws, { type: 'error', error: `Unknown message type: ${parsed.type}` });
      return;
    }

    if (!parsed.content || typeof parsed.content !== 'string') {
      sendWsMessage(ws, { type: 'error', error: 'Missing or invalid "content" field' });
      return;
    }

    const session = sessions.getByWs(ws);
    if (!session) {
      sendWsMessage(ws, { type: 'error', error: 'No session found for this connection' });
      return;
    }

    try {
      const agent = container.resolve<Agent>('agent');

      const message: InboundMessage = {
        id: randomUUID(),
        channelId: parsed.channelId ?? session.channelId,
        senderId: parsed.senderId ?? session.senderId,
        senderName: parsed.senderName ?? session.senderName,
        target: 'agent',
        content: parsed.content,
        images: parsed.images,
        files: parsed.files,
        isGroup: false,
        timestamp: Math.floor(Date.now() / 1000),
      };

      const onStream = (chunk: StreamChunk) => {
        sendWsMessage(ws, { type: 'stream', chunk });
      };

      const result = await agent.run({ message, onStream });

      sendWsMessage(ws, {
        type: 'complete',
        result: {
          content: result.content,
          model: result.model,
          provider: result.provider,
          toolCalls: result.toolCalls,
        },
      });
    } catch (err) {
      logger.error(`WebSocket handler error: ${err}`);
      sendWsMessage(ws, {
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
