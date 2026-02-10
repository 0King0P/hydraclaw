import type { Router, Request, Response } from 'express';
import { Router as createRouter } from 'express';
import type { Container, InboundMessage, StreamChunk, Logger } from '@hydraclaw/core';
import type { Agent } from '@hydraclaw/agent';
import { randomUUID } from 'node:crypto';

export function createChatRoutes(container: Container): Router {
  const router = createRouter();

  router.post('/api/chat', async (req: Request, res: Response) => {
    const logger = container.resolve<Logger>('logger');

    try {
      const agent = container.resolve<Agent>('agent');
      const { content, channelId, senderId, senderName, images, files } = req.body as {
        content?: string;
        channelId?: string;
        senderId?: string;
        senderName?: string;
        images?: InboundMessage['images'];
        files?: InboundMessage['files'];
      };

      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "content" field' });
        return;
      }

      const message: InboundMessage = {
        id: randomUUID(),
        channelId: channelId ?? 'gateway-http',
        senderId: senderId ?? 'http-user',
        senderName: senderName ?? 'HTTP User',
        target: 'agent',
        content,
        images,
        files,
        isGroup: false,
        timestamp: Math.floor(Date.now() / 1000),
      };

      const result = await agent.run({ message });

      res.json({
        content: result.content,
        model: result.model,
        provider: result.provider,
        toolCalls: result.toolCalls,
      });
    } catch (err) {
      logger.error(`Chat error: ${err}`);
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post('/api/chat/stream', async (req: Request, res: Response) => {
    const logger = container.resolve<Logger>('logger');

    try {
      const agent = container.resolve<Agent>('agent');
      const { content, channelId, senderId, senderName, images, files } = req.body as {
        content?: string;
        channelId?: string;
        senderId?: string;
        senderName?: string;
        images?: InboundMessage['images'];
        files?: InboundMessage['files'];
      };

      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "content" field' });
        return;
      }

      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const message: InboundMessage = {
        id: randomUUID(),
        channelId: channelId ?? 'gateway-http',
        senderId: senderId ?? 'http-user',
        senderName: senderName ?? 'HTTP User',
        target: 'agent',
        content,
        images,
        files,
        isGroup: false,
        timestamp: Math.floor(Date.now() / 1000),
      };

      const onStream = (chunk: StreamChunk) => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      };

      const result = await agent.run({ message, onStream });

      res.write(`data: ${JSON.stringify({ type: 'complete', content: result.content, model: result.model, provider: result.provider })}\n\n`);
      res.end();
    } catch (err) {
      logger.error(`Stream chat error: ${err}`);
      res.write(`data: ${JSON.stringify({ type: 'error', content: err instanceof Error ? err.message : String(err) })}\n\n`);
      res.end();
    }
  });

  return router;
}
