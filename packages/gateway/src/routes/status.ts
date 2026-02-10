import type { Router, Request, Response } from 'express';
import { Router as createRouter } from 'express';
import type { Container, DefaultPluginRegistry } from '@hydraclaw/core';

export function createStatusRoutes(container: Container): Router {
  const router = createRouter();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      uptime: process.uptime(),
    });
  });

  router.get('/status', (_req: Request, res: Response) => {
    try {
      const registry = container.resolve<DefaultPluginRegistry>('registry');

      const providers = Array.from(registry.providers.keys());
      const channels = Array.from(registry.channels.keys());
      const tools = Array.from(registry.tools.keys());

      res.json({
        status: 'running',
        providers,
        channels,
        tools,
        timestamp: Date.now(),
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
