import express from 'express';
import cors from 'cors';
import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type { Container, GatewayConfig, Logger, MessageBus } from '@hydraclaw/core';
import { Events } from '@hydraclaw/core';
import { createStatusRoutes } from './routes/status.js';
import { createChatRoutes } from './routes/chat.js';
import { SessionManager } from './session.js';
import { createWsHandler } from './ws-handler.js';

export interface GatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  httpServer: HttpServer | null;
  wss: WebSocketServer | null;
  sessions: SessionManager;
}

export function createGatewayServer(container: Container): GatewayServer {
  const config = container.resolve<GatewayConfig>('gatewayConfig');
  const logger = container.resolve<Logger>('logger');
  const bus = container.resolve<MessageBus>('bus');

  const app = express();
  const sessions = new SessionManager();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Routes
  app.use(createStatusRoutes(container));
  app.use(createChatRoutes(container));

  let httpServer: HttpServer | null = null;
  let wss: WebSocketServer | null = null;

  const gateway: GatewayServer = {
    httpServer,
    wss,
    sessions,

    async start(): Promise<void> {
      // Start HTTP server
      await new Promise<void>((resolve) => {
        httpServer = app.listen(config.port, config.host, () => {
          logger.info(`HTTP server listening on ${config.host}:${config.port}`);
          resolve();
        });
        gateway.httpServer = httpServer;
      });

      // Start WebSocket server
      wss = new WebSocketServer({ port: config.wsPort, host: config.host });
      gateway.wss = wss;

      const handleMessage = createWsHandler(container, sessions);

      wss.on('connection', (ws: WebSocket) => {
        const sessionId = randomUUID();
        const session = sessions.create(ws, sessionId);
        logger.info(`WebSocket connected: ${session.id}`);

        ws.on('message', (data) => {
          const raw = typeof data === 'string' ? data : data.toString('utf-8');
          handleMessage(ws, raw).catch((err) => {
            logger.error(`Unhandled WS message error: ${err}`);
          });
        });

        ws.on('close', () => {
          logger.info(`WebSocket disconnected: ${session.id}`);
          sessions.remove(ws);
        });

        ws.on('error', (err) => {
          logger.error(`WebSocket error for ${session.id}: ${err}`);
          sessions.remove(ws);
        });
      });

      logger.info(`WebSocket server listening on ${config.host}:${config.wsPort}`);
      await bus.emit(Events.GATEWAY_READY, { httpPort: config.port, wsPort: config.wsPort });
    },

    async stop(): Promise<void> {
      logger.info('Shutting down gateway...');

      // Close all WebSocket connections
      if (wss) {
        for (const client of wss.clients) {
          client.close(1001, 'Server shutting down');
        }
        await new Promise<void>((resolve, reject) => {
          wss!.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        wss = null;
        gateway.wss = null;
      }

      // Close HTTP server
      if (httpServer) {
        await new Promise<void>((resolve, reject) => {
          httpServer!.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        httpServer = null;
        gateway.httpServer = null;
      }

      await bus.emit(Events.GATEWAY_SHUTDOWN, {});
      logger.info('Gateway shut down');
    },
  };

  return gateway;
}
