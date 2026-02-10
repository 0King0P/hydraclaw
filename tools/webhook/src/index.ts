import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type {
  Tool,
  ToolDefinition,
  ToolCall,
  ToolResult,
  PluginContext,
  Logger,
} from '@hydraclaw/core';

interface WebhookEndpoint {
  path: string;
  method: string;
  createdAt: string;
  events: WebhookEvent[];
}

interface WebhookEvent {
  timestamp: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  query: string;
  body: string;
  ip: string | undefined;
}

const DEFINITIONS: ToolDefinition[] = [
  {
    name: 'webhook_create',
    description: 'Create an HTTP webhook endpoint that listens for incoming requests. The server listens on a configurable port (default 9876).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'URL path for the webhook (e.g. "/my-hook")',
        },
        method: {
          type: 'string',
          description: 'HTTP method to accept (GET, POST, PUT, DELETE). Defaults to POST. Use "*" for any method.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'webhook_list',
    description: 'List all active webhook endpoints and their event counts.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'webhook_delete',
    description: 'Delete a webhook endpoint and all its stored events.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'URL path of the webhook to delete',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'webhook_get_events',
    description: 'Retrieve events received by a webhook endpoint.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'URL path of the webhook',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of events to return (most recent first). Defaults to 50.',
        },
      },
      required: ['path'],
    },
  },
];

export class WebhookTool implements Tool {
  readonly id = 'webhook';
  readonly name = 'Webhook';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;
  private server: Server | null = null;
  private port = 9876;
  private maxEventsPerHook = 1000;
  private endpoints: Map<string, WebhookEndpoint> = new Map();

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'webhook' });

    const config = ctx.config as Record<string, unknown>;
    if (config.port) this.port = config.port as number;
    if (config.maxEvents) this.maxEventsPerHook = config.maxEvents as number;

    this.startServer();
    this.logger.info(`Webhook tool initialized on port ${this.port}`);
  }

  async destroy(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
    this.endpoints.clear();
    this.logger.info('Webhook tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case 'webhook_create':
          return this.webhookCreate(call);
        case 'webhook_list':
          return this.webhookList(call);
        case 'webhook_delete':
          return this.webhookDelete(call);
        case 'webhook_get_events':
          return this.webhookGetEvents(call);
        default:
          return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Webhook error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private startServer(): void {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
      const path = url.pathname;
      const endpoint = this.endpoints.get(path);

      if (!endpoint) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Webhook not found' }));
        return;
      }

      if (endpoint.method !== '*' && req.method?.toUpperCase() !== endpoint.method) {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // Collect request body
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');

        const event: WebhookEvent = {
          timestamp: new Date().toISOString(),
          method: req.method ?? 'UNKNOWN',
          headers: req.headers as Record<string, string | string[] | undefined>,
          query: url.search,
          body,
          ip: req.socket.remoteAddress,
        };

        endpoint.events.push(event);

        // Trim events if exceeding max
        if (endpoint.events.length > this.maxEventsPerHook) {
          endpoint.events = endpoint.events.slice(-this.maxEventsPerHook);
        }

        this.logger.debug(`Webhook event received: ${req.method} ${path}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', received: true }));
      });
    });

    this.server.listen(this.port, () => {
      this.logger.info(`Webhook server listening on port ${this.port}`);
    });
  }

  private webhookCreate(call: ToolCall): ToolResult {
    const args = call.arguments as { path: string; method?: string };
    const path = args.path.startsWith('/') ? args.path : `/${args.path}`;
    const method = (args.method ?? 'POST').toUpperCase();

    if (this.endpoints.has(path)) {
      return {
        toolCallId: call.id,
        content: `Webhook at "${path}" already exists. Delete it first to recreate.`,
        isError: true,
      };
    }

    const endpoint: WebhookEndpoint = {
      path,
      method,
      createdAt: new Date().toISOString(),
      events: [],
    };

    this.endpoints.set(path, endpoint);
    this.logger.info(`Created webhook: ${method} ${path}`);

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        path,
        method,
        url: `http://localhost:${this.port}${path}`,
        status: 'active',
      }, null, 2),
    };
  }

  private webhookList(call: ToolCall): ToolResult {
    const hooks = Array.from(this.endpoints.values()).map((ep) => ({
      path: ep.path,
      method: ep.method,
      url: `http://localhost:${this.port}${ep.path}`,
      createdAt: ep.createdAt,
      eventCount: ep.events.length,
    }));

    return {
      toolCallId: call.id,
      content: JSON.stringify({ webhooks: hooks, total: hooks.length }, null, 2),
    };
  }

  private webhookDelete(call: ToolCall): ToolResult {
    const args = call.arguments as { path: string };
    const path = args.path.startsWith('/') ? args.path : `/${args.path}`;

    const endpoint = this.endpoints.get(path);
    if (!endpoint) {
      return {
        toolCallId: call.id,
        content: `Webhook at "${path}" not found.`,
        isError: true,
      };
    }

    const eventCount = endpoint.events.length;
    this.endpoints.delete(path);
    this.logger.info(`Deleted webhook: ${path} (had ${eventCount} events)`);

    return {
      toolCallId: call.id,
      content: JSON.stringify({ path, status: 'deleted', eventsRemoved: eventCount }, null, 2),
    };
  }

  private webhookGetEvents(call: ToolCall): ToolResult {
    const args = call.arguments as { path: string; limit?: number };
    const path = args.path.startsWith('/') ? args.path : `/${args.path}`;
    const limit = args.limit ?? 50;

    const endpoint = this.endpoints.get(path);
    if (!endpoint) {
      return {
        toolCallId: call.id,
        content: `Webhook at "${path}" not found.`,
        isError: true,
      };
    }

    // Return most recent events first
    const events = endpoint.events.slice(-limit).reverse();

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        path,
        events,
        returned: events.length,
        total: endpoint.events.length,
      }, null, 2),
    };
  }
}

export default WebhookTool;
