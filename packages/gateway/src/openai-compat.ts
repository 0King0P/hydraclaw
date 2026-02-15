import type { Router, Request, Response } from 'express';
import { Router as createRouter } from 'express';
import { randomUUID } from 'node:crypto';
import type {
  Container,
  Logger,
  InboundMessage,
  StreamChunk,
  AIProvider,
  ModelInfo,
  DefaultPluginRegistry,
} from '@hydraclaw/core';
import type { Agent } from '@hydraclaw/agent';

// ---------------------------------------------------------------------------
// OpenAI-compatible request/response types
// ---------------------------------------------------------------------------

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
  n?: number;
  user?: string;
}

interface OpenAIChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunkResponse {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<OpenAIChatMessage>;
    finish_reason: string | null;
  }>;
}

interface OpenAIModelObject {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

interface OpenAIModelListResponse {
  object: 'list';
  data: OpenAIModelObject[];
}

// ---------------------------------------------------------------------------
// Route creation
// ---------------------------------------------------------------------------

/**
 * Create Express routes that expose an OpenAI-compatible API.
 *
 * This makes HydraClaw act as a drop-in replacement for the OpenAI API so
 * any tool or library that supports the OpenAI chat completions format can
 * talk to HydraClaw directly.
 *
 * Supported endpoints:
 *   - `POST /v1/chat/completions` - Chat completions (streaming and non-streaming)
 *   - `GET  /v1/models`           - List available models
 *   - `GET  /v1/models/:model`    - Retrieve model details
 */
export function createOpenAICompatRoutes(container: Container): Router {
  const router = createRouter();

  // ─── POST /v1/chat/completions ──────────────────────────────────────
  router.post('/v1/chat/completions', async (req: Request, res: Response) => {
    const logger = container.resolve<Logger>('logger');

    try {
      const body = req.body as OpenAIChatCompletionRequest;

      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        res.status(400).json({
          error: { message: 'messages is required and must be a non-empty array', type: 'invalid_request_error', code: 'invalid_messages' },
        });
        return;
      }

      const agent = container.resolve<Agent>('agent');

      // Derive content from the last user message
      const lastUserMessage = [...body.messages].reverse().find((m) => m.role === 'user');
      const content = lastUserMessage?.content ?? '';

      if (typeof content !== 'string' || content.length === 0) {
        res.status(400).json({
          error: { message: 'No user message content found', type: 'invalid_request_error', code: 'missing_content' },
        });
        return;
      }

      const inbound: InboundMessage = {
        id: randomUUID(),
        channelId: 'openai-compat',
        senderId: body.user ?? 'openai-compat-user',
        senderName: body.user ?? 'OpenAI Compat User',
        target: 'agent',
        content,
        isGroup: false,
        timestamp: Math.floor(Date.now() / 1000),
      };

      const completionId = `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 29)}`;
      const created = Math.floor(Date.now() / 1000);

      // ── Streaming ──────────────────────────────────────────────
      if (body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Send initial role chunk
        const roleChunk: OpenAIStreamChunkResponse = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: body.model,
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: '' },
            finish_reason: null,
          }],
        };
        res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);

        const onStream = (chunk: StreamChunk) => {
          if (chunk.type === 'text' && chunk.delta) {
            const streamChunk: OpenAIStreamChunkResponse = {
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: body.model,
              choices: [{
                index: 0,
                delta: { content: chunk.delta },
                finish_reason: null,
              }],
            };
            res.write(`data: ${JSON.stringify(streamChunk)}\n\n`);
          }

          if (chunk.type === 'done') {
            const doneChunk: OpenAIStreamChunkResponse = {
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: body.model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: mapFinishReason(chunk.finishReason),
              }],
            };
            res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
          }
        };

        try {
          await agent.run({ message: inbound, onStream });

          // Send final [DONE] sentinel
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (err) {
          logger.error(`OpenAI compat stream error: ${err}`);
          const errorChunk = {
            error: { message: err instanceof Error ? err.message : String(err), type: 'server_error' },
          };
          res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
        return;
      }

      // ── Non-streaming ──────────────────────────────────────────
      const result = await agent.run({ message: inbound });

      const response: OpenAIChatCompletionResponse = {
        id: completionId,
        object: 'chat.completion',
        created,
        model: result.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: result.content,
            ...(result.toolCalls && result.toolCalls.length > 0
              ? {
                  tool_calls: result.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: { name: tc.name, arguments: tc.arguments },
                  })),
                }
              : {}),
          },
          finish_reason: result.toolCalls && result.toolCalls.length > 0 ? 'tool_calls' : 'stop',
        }],
        usage: {
          prompt_tokens: 0,  // Not tracked at this layer
          completion_tokens: 0,
          total_tokens: 0,
        },
      };

      res.json(response);
    } catch (err) {
      logger.error(`OpenAI compat error: ${err}`);
      res.status(500).json({
        error: {
          message: err instanceof Error ? err.message : String(err),
          type: 'server_error',
          code: 'internal_error',
        },
      });
    }
  });

  // ─── GET /v1/models ─────────────────────────────────────────────────
  router.get('/v1/models', (_req: Request, res: Response) => {
    const logger = container.resolve<Logger>('logger');

    try {
      const models = collectAllModels(container);

      const response: OpenAIModelListResponse = {
        object: 'list',
        data: models.map((m) => ({
          id: m.id,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: m.provider,
        })),
      };

      res.json(response);
    } catch (err) {
      logger.error(`OpenAI compat models error: ${err}`);
      res.status(500).json({
        error: { message: err instanceof Error ? err.message : String(err), type: 'server_error' },
      });
    }
  });

  // ─── GET /v1/models/:model ──────────────────────────────────────────
  router.get('/v1/models/:model', (req: Request, res: Response) => {
    const logger = container.resolve<Logger>('logger');
    const modelId = req.params.model;

    try {
      const models = collectAllModels(container);
      const model = models.find((m) => m.id === modelId);

      if (!model) {
        res.status(404).json({
          error: { message: `Model "${modelId}" not found`, type: 'invalid_request_error', code: 'model_not_found' },
        });
        return;
      }

      const response: OpenAIModelObject = {
        id: model.id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: model.provider,
      };

      res.json(response);
    } catch (err) {
      logger.error(`OpenAI compat model detail error: ${err}`);
      res.status(500).json({
        error: { message: err instanceof Error ? err.message : String(err), type: 'server_error' },
      });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect all model definitions from every registered provider.
 */
function collectAllModels(container: Container): ModelInfo[] {
  const registry = container.resolve<DefaultPluginRegistry>('registry');
  const models: ModelInfo[] = [];

  for (const [, plugin] of registry.providers) {
    const provider = plugin as AIProvider;
    try {
      models.push(...provider.models());
    } catch {
      // Provider may not support listing models
    }
  }

  return models;
}

/**
 * Map HydraClaw finish reasons to OpenAI-compatible finish reasons.
 */
function mapFinishReason(reason?: string): string {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    default:
      return 'stop';
  }
}
