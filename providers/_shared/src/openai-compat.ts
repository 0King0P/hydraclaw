import OpenAI from 'openai';
import type {
  AIProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  TokenUsage,
  ToolDefinitionForProvider,
  PluginContext,
  ChatMessage,
  ImageInput,
  Logger,
} from '@hydraclaw/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAICompatConfig {
  /** Unique provider id (e.g. "mistral", "groq") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Default base URL if the user does not supply one */
  defaultBaseUrl: string;
  /** Static list of models (used when dynamicModels is not set) */
  models: ModelInfo[];
  /** If true, the provider does not require an API key */
  apiKeyOptional?: boolean;
  /** Extra default headers sent with every request */
  defaultHeaders?: Record<string, string>;
  /**
   * A callback invoked during init to build extra headers from the
   * plugin context (e.g. OpenRouter needs HTTP-Referer from config).
   */
  extraHeaders?: (ctx: PluginContext) => Record<string, string>;
  /** When set, models are fetched from the remote /models endpoint at init */
  dynamicModels?: DynamicModelLoader;
  /**
   * If true, skip sending `stream_options` in streaming requests.
   * Some providers (e.g. older vLLM) do not support it.
   */
  skipStreamOptions?: boolean;
}

export interface DynamicModelLoader {
  /** Provider string to set on each ModelInfo */
  provider: string;
  /** Fallback models if the remote endpoint is unreachable */
  fallback: ModelInfo[];
}

// ---------------------------------------------------------------------------
// Message conversion helpers (mirrored from the OpenAI provider)
// ---------------------------------------------------------------------------

type OpenAIRole = 'system' | 'user' | 'assistant' | 'tool';

interface OpenAIImageContentPart {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

interface OpenAITextContentPart {
  type: 'text';
  text: string;
}

type OpenAIContentPart = OpenAITextContentPart | OpenAIImageContentPart;

interface OpenAIMessage {
  role: OpenAIRole;
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function buildImageUrl(image: ImageInput): string {
  if (image.type === 'url') return image.data;
  const mimeType = image.mimeType ?? 'image/png';
  return `data:${mimeType};base64,${image.data}`;
}

function convertMessages(messages: ChatMessage[], systemPrompt?: string): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];

  if (systemPrompt) {
    out.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (!systemPrompt) {
        out.push({ role: 'system', content: msg.content });
      }
      continue;
    }

    if (msg.role === 'tool') {
      out.push({ role: 'tool', content: msg.content, tool_call_id: msg.toolCallId ?? '' });
      continue;
    }

    if (msg.role === 'assistant') {
      const assistantMsg: OpenAIMessage = { role: 'assistant', content: msg.content || null };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      out.push(assistantMsg);
      continue;
    }

    // User message – may contain images
    if (msg.images && msg.images.length > 0) {
      const parts: OpenAIContentPart[] = [];
      for (const image of msg.images) {
        parts.push({ type: 'image_url', image_url: { url: buildImageUrl(image) } });
      }
      if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
      }
      out.push({ role: 'user', content: parts });
      continue;
    }

    out.push({ role: 'user', content: msg.content, ...(msg.name ? { name: msg.name } : {}) });
  }

  return out;
}

function convertTools(tools: ToolDefinitionForProvider[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function mapFinishReason(reason: string | null): CompletionResponse['finishReason'] {
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

function appendRequestImages(messages: OpenAIMessage[], images: ImageInput[]): void {
  const lastUserIdx = messages.findLastIndex((m) => m.role === 'user');
  if (lastUserIdx < 0) return;
  const lastUser = messages[lastUserIdx];
  const imageParts: OpenAIContentPart[] = images.map((img) => ({
    type: 'image_url' as const,
    image_url: { url: buildImageUrl(img) },
  }));
  if (typeof lastUser.content === 'string') {
    messages[lastUserIdx] = {
      ...lastUser,
      content: [...imageParts, { type: 'text', text: lastUser.content }],
    };
  } else if (Array.isArray(lastUser.content)) {
    messages[lastUserIdx] = { ...lastUser, content: [...imageParts, ...lastUser.content] };
  }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export function createOpenAICompatProvider(cfg: OpenAICompatConfig): AIProvider {
  let client: OpenAI;
  let logger: Logger;
  let resolvedModels: ModelInfo[] = cfg.models;

  const provider: AIProvider = {
    id: cfg.id,
    name: cfg.name,
    version: '1.0.0',
    type: 'provider' as const,

    // ---- lifecycle -------------------------------------------------------

    async init(ctx: PluginContext): Promise<void> {
      logger = ctx.logger.child({ plugin: cfg.id });

      const apiKey = (ctx.config.apiKey as string | undefined) ?? '';
      if (!apiKey && !cfg.apiKeyOptional) {
        throw new Error(`${cfg.name} provider requires config.apiKey`);
      }

      const baseURL = (ctx.config.baseUrl as string | undefined) ?? cfg.defaultBaseUrl;

      const headers: Record<string, string> = {
        ...(cfg.defaultHeaders ?? {}),
        ...(cfg.extraHeaders ? cfg.extraHeaders(ctx) : {}),
      };

      client = new OpenAI({
        apiKey: apiKey || 'unused',
        baseURL,
        defaultHeaders: Object.keys(headers).length > 0 ? headers : undefined,
      });

      // Dynamic model loading
      if (cfg.dynamicModels) {
        try {
          const list = await client.models.list();
          const fetched: ModelInfo[] = [];
          for await (const m of list) {
            fetched.push({
              id: m.id,
              name: m.id,
              provider: cfg.dynamicModels.provider,
              contextWindow: 4096,
              supportsVision: false,
              supportsTools: false,
              supportsStreaming: true,
            });
          }
          if (fetched.length > 0) {
            resolvedModels = fetched;
            logger.info('Discovered %d models from %s', fetched.length, baseURL);
          } else {
            resolvedModels = cfg.dynamicModels.fallback;
            logger.info('No models found at %s, using %d fallback models', baseURL, cfg.dynamicModels.fallback.length);
          }
        } catch (err) {
          const errStr = String(err);
          if (errStr.includes('ECONNREFUSED') || errStr.includes('fetch failed')) {
            logger.warn(
              'Cannot reach %s at %s - make sure the server is running',
              cfg.name,
              baseURL,
            );
            if (cfg.id === 'ollama') {
              logger.warn('Start Ollama with: ollama serve');
            }
          } else {
            logger.warn('Could not fetch models from %s: %s', baseURL, errStr);
          }
          resolvedModels = cfg.dynamicModels.fallback;
        }
      }

      logger.info('%s provider initialized (baseURL=%s)', cfg.name, baseURL);
    },

    async destroy(): Promise<void> {
      logger.info('%s provider destroyed', cfg.name);
    },

    // ---- models ----------------------------------------------------------

    models(): ModelInfo[] {
      return resolvedModels;
    },

    // ---- complete --------------------------------------------------------

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const messages = convertMessages(req.messages, req.systemPrompt);

      if (req.images && req.images.length > 0) {
        appendRequestImages(messages, req.images);
      }

      const params: OpenAI.ChatCompletionCreateParams = {
        model: req.model,
        messages: messages as OpenAI.ChatCompletionMessageParam[],
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.topP !== undefined ? { top_p: req.topP } : {}),
        ...(req.frequencyPenalty !== undefined ? { frequency_penalty: req.frequencyPenalty } : {}),
        ...(req.presencePenalty !== undefined ? { presence_penalty: req.presencePenalty } : {}),
        ...(req.stop ? { stop: req.stop } : {}),
        ...(req.tools && req.tools.length > 0 ? { tools: convertTools(req.tools) } : {}),
        ...(req.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      };

      logger.debug('%s complete: model=%s, messages=%d', cfg.id, req.model, messages.length);

      const response = await client.chat.completions.create(params);

      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));

      const usage: TokenUsage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      };

      return {
        content: choice.message.content ?? '',
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        usage,
        model: response.model,
        finishReason: mapFinishReason(choice.finish_reason),
      };
    },

    // ---- stream ----------------------------------------------------------

    async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
      const messages = convertMessages(req.messages, req.systemPrompt);

      if (req.images && req.images.length > 0) {
        appendRequestImages(messages, req.images);
      }

      const params: OpenAI.ChatCompletionCreateParams = {
        model: req.model,
        messages: messages as OpenAI.ChatCompletionMessageParam[],
        stream: true,
        ...(cfg.skipStreamOptions ? {} : { stream_options: { include_usage: true } }),
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.topP !== undefined ? { top_p: req.topP } : {}),
        ...(req.frequencyPenalty !== undefined ? { frequency_penalty: req.frequencyPenalty } : {}),
        ...(req.presencePenalty !== undefined ? { presence_penalty: req.presencePenalty } : {}),
        ...(req.stop ? { stop: req.stop } : {}),
        ...(req.tools && req.tools.length > 0 ? { tools: convertTools(req.tools) } : {}),
        ...(req.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      };

      logger.debug('%s stream: model=%s, messages=%d', cfg.id, req.model, messages.length);

      const stream = await client.chat.completions.create(params);

      const activeToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
      let finalUsage: TokenUsage | undefined;
      let finalFinishReason: string | undefined;

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];

        if (chunk.usage) {
          finalUsage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          };
        }

        if (!choice) continue;

        if (choice.finish_reason) {
          finalFinishReason = choice.finish_reason;
        }

        const delta = choice.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { type: 'text', content: delta.content, delta: delta.content };
        }

        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index;
            if (!activeToolCalls.has(idx)) {
              activeToolCalls.set(idx, {
                id: tcDelta.id ?? '',
                name: tcDelta.function?.name ?? '',
                arguments: tcDelta.function?.arguments ?? '',
              });
              if (tcDelta.id) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: tcDelta.id,
                    name: tcDelta.function?.name ?? '',
                    arguments: tcDelta.function?.arguments ?? '',
                  },
                };
              }
            } else {
              const tc = activeToolCalls.get(idx)!;
              if (tcDelta.function?.arguments) {
                tc.arguments += tcDelta.function.arguments;
                yield {
                  type: 'tool_call_delta',
                  toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
                  delta: tcDelta.function.arguments,
                };
              }
            }
          }
        }
      }

      yield {
        type: 'done',
        usage: finalUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: finalFinishReason ?? 'stop',
      };
    },
  };

  return provider;
}
