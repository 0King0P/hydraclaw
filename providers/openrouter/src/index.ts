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

import {
  OPENROUTER_FALLBACK_MODELS,
  fetchOpenRouterModels,
  type OpenRouterModelInfo,
} from './models.js';

import {
  OpenRouterRouter,
  type RouteConfig,
  type RoutePreference,
  type ProviderPreferences,
  type OpenRouterTransforms,
  type OpenRouterGenerationStats,
  type OpenRouterErrorInfo,
} from './router.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_HTTP_REFERER = 'https://hydraclaw.dev';
const DEFAULT_X_TITLE = 'HydraClaw';
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// OpenAI-compatible message types (same as _shared provider)
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

// ---------------------------------------------------------------------------
// Message conversion helpers
// ---------------------------------------------------------------------------

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

    // User message - may contain images
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
// Sleep utility for retries
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// OpenRouter Provider - first-class implementation
// ---------------------------------------------------------------------------

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter';
  readonly version = '1.0.0';
  readonly type = 'provider' as const;

  private client!: OpenAI;
  private logger!: Logger;
  private router!: OpenRouterRouter;
  private resolvedModels: OpenRouterModelInfo[] = [];
  private apiKey = '';
  private baseUrl = OPENROUTER_BASE_URL;
  private httpReferer = DEFAULT_HTTP_REFERER;
  private xTitle = DEFAULT_X_TITLE;
  private lastGenerationStats: OpenRouterGenerationStats | null = null;

  // ---- Lifecycle -----------------------------------------------------------

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'openrouter' });

    this.apiKey = (ctx.config.apiKey as string | undefined) ?? '';
    if (!this.apiKey) {
      throw new Error('OpenRouter provider requires config.apiKey. Get one at https://openrouter.ai/keys');
    }

    this.baseUrl = (ctx.config.baseUrl as string | undefined) ?? OPENROUTER_BASE_URL;
    this.httpReferer = (ctx.config.httpReferer as string | undefined) ?? DEFAULT_HTTP_REFERER;
    this.xTitle = (ctx.config.xTitle as string | undefined) ?? DEFAULT_X_TITLE;

    // Build route configuration from provider config
    const routeConfig = this.buildRouteConfigFromContext(ctx);
    this.router = new OpenRouterRouter(this.logger, routeConfig);

    // Initialize OpenAI-compatible client with OpenRouter headers
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': this.httpReferer,
        'X-Title': this.xTitle,
      },
    });

    // Fetch live models from OpenRouter API, fall back to static catalog
    await this.loadModels();

    this.logger.info(
      'OpenRouter provider initialized (baseURL=%s, models=%d, route=%s)',
      this.baseUrl,
      this.resolvedModels.length,
      routeConfig.route ?? 'default',
    );
  }

  async destroy(): Promise<void> {
    const stats = this.router.getUsageStats();
    this.logger.info(
      'OpenRouter provider destroyed (total requests=%d, est. cost=$%s)',
      stats.totalRequests,
      stats.estimatedCostUsd.toFixed(4),
    );
  }

  // ---- Models --------------------------------------------------------------

  models(): ModelInfo[] {
    return this.resolvedModels;
  }

  /** Get the extended OpenRouter model info including capabilities and pricing. */
  getOpenRouterModels(): OpenRouterModelInfo[] {
    return this.resolvedModels;
  }

  /** Get the router instance for advanced routing control. */
  getRouter(): OpenRouterRouter {
    return this.router;
  }

  /** Get the last generation stats from OpenRouter. */
  getLastGenerationStats(): OpenRouterGenerationStats | null {
    return this.lastGenerationStats;
  }

  // ---- Complete (non-streaming) --------------------------------------------

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const messages = convertMessages(req.messages, req.systemPrompt);

    if (req.images && req.images.length > 0) {
      appendRequestImages(messages, req.images);
    }

    const routeParams = this.router.buildRouteParams();

    this.logger.debug('OpenRouter complete: model=%s, messages=%d', req.model, messages.length);

    // Attempt with retries and fallback
    const modelsToTry = [req.model, ...this.router.getFallbackChain(req.model)];
    let lastError: unknown;

    for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
      const currentModel = modelsToTry[modelIdx];

      if (modelIdx > 0) {
        this.logger.warn('OpenRouter fallback: trying model %s', currentModel);
      }

      const params: OpenAI.ChatCompletionCreateParams = {
        model: currentModel,
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

      // Merge OpenRouter-specific route parameters into the request body
      const paramsWithRoute = { ...params, ...routeParams };

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await this.client.chat.completions.create(
            paramsWithRoute as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
          );

          // Extract OpenRouter generation stats from response
          this.extractGenerationStats(response);

          const choice = response.choices[0];
          const toolCalls = choice.message.tool_calls?.map((tc: OpenAI.ChatCompletionMessageToolCall) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          }));

          const usage: TokenUsage = {
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
            totalTokens: response.usage?.total_tokens ?? 0,
          };

          // Track usage in the router
          this.router.recordUsage(currentModel, usage.promptTokens, usage.completionTokens);

          return {
            content: choice.message.content ?? '',
            toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
            usage,
            model: response.model,
            finishReason: mapFinishReason(choice.finish_reason),
          };
        } catch (error) {
          lastError = error;
          const errorInfo = this.router.classifyError(error);
          this.logger.warn(
            'OpenRouter error (model=%s, attempt=%d/%d): %s [%s]',
            currentModel,
            attempt + 1,
            MAX_RETRIES + 1,
            errorInfo.message,
            errorInfo.type,
          );

          if (!errorInfo.retriable) {
            // Non-retriable errors on this model - try fallback model
            if (errorInfo.type === 'model_unavailable') break;
            // For auth/credits errors, no point trying other models
            throw this.wrapError(error, errorInfo);
          }

          if (attempt < MAX_RETRIES) {
            const delay = errorInfo.retryAfterMs ?? RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            this.logger.debug('OpenRouter retry after %dms', delay);
            await sleep(delay);
          }
        }
      }
    }

    // All models and retries exhausted
    const errorInfo = this.router.classifyError(lastError);
    throw this.wrapError(lastError, errorInfo);
  }

  // ---- Stream --------------------------------------------------------------

  async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
    const messages = convertMessages(req.messages, req.systemPrompt);

    if (req.images && req.images.length > 0) {
      appendRequestImages(messages, req.images);
    }

    const routeParams = this.router.buildRouteParams();

    this.logger.debug('OpenRouter stream: model=%s, messages=%d', req.model, messages.length);

    // For streaming, we attempt the primary model with retries.
    // Fallback on stream is more complex, so we do one retry then try fallbacks.
    const modelsToTry = [req.model, ...this.router.getFallbackChain(req.model)];
    let lastError: unknown;

    for (const currentModel of modelsToTry) {
      if (currentModel !== req.model) {
        this.logger.warn('OpenRouter stream fallback: trying model %s', currentModel);
      }

      const params: OpenAI.ChatCompletionCreateParams = {
        model: currentModel,
        messages: messages as OpenAI.ChatCompletionMessageParam[],
        stream: true,
        stream_options: { include_usage: true },
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.topP !== undefined ? { top_p: req.topP } : {}),
        ...(req.frequencyPenalty !== undefined ? { frequency_penalty: req.frequencyPenalty } : {}),
        ...(req.presencePenalty !== undefined ? { presence_penalty: req.presencePenalty } : {}),
        ...(req.stop ? { stop: req.stop } : {}),
        ...(req.tools && req.tools.length > 0 ? { tools: convertTools(req.tools) } : {}),
        ...(req.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      };

      // Merge OpenRouter-specific route parameters into the request body
      const paramsWithRoute = { ...params, ...routeParams };

      try {
        const stream = await this.client.chat.completions.create(
          paramsWithRoute as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
        );

        const activeToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
        let finalUsage: TokenUsage | undefined;
        let finalFinishReason: string | undefined;

        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];

          // Usage info from final chunk
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

          // Text content
          if (delta.content) {
            yield { type: 'text', content: delta.content, delta: delta.content };
          }

          // Tool call deltas
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

        // Track usage
        if (finalUsage) {
          this.router.recordUsage(currentModel, finalUsage.promptTokens, finalUsage.completionTokens);
        }

        yield {
          type: 'done',
          usage: finalUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: finalFinishReason ?? 'stop',
        };

        // Successfully streamed, return
        return;
      } catch (error) {
        lastError = error;
        const errorInfo = this.router.classifyError(error);
        this.logger.warn(
          'OpenRouter stream error (model=%s): %s [%s]',
          currentModel,
          errorInfo.message,
          errorInfo.type,
        );

        // Non-retriable and non-fallbackable errors
        if (!errorInfo.retriable && errorInfo.type !== 'model_unavailable') {
          throw this.wrapError(error, errorInfo);
        }
      }
    }

    // All models exhausted
    const errorInfo = this.router.classifyError(lastError);
    throw this.wrapError(lastError, errorInfo);
  }

  // ---- Private helpers -----------------------------------------------------

  /**
   * Load models from OpenRouter API with fallback to the static catalog.
   */
  private async loadModels(): Promise<void> {
    try {
      this.logger.debug('Fetching models from OpenRouter API...');
      const liveModels = await fetchOpenRouterModels(this.baseUrl, this.apiKey);

      if (liveModels.length > 0) {
        this.resolvedModels = liveModels;
        this.router.setModels(liveModels);
        this.logger.info('Loaded %d models from OpenRouter API', liveModels.length);
        return;
      }
    } catch (error) {
      this.logger.warn(
        'Could not fetch models from OpenRouter API, using fallback catalog: %s',
        error instanceof Error ? error.message : String(error),
      );
    }

    // Use the comprehensive fallback catalog
    this.resolvedModels = [...OPENROUTER_FALLBACK_MODELS];
    this.router.setModels(this.resolvedModels);
    this.logger.info('Using fallback model catalog (%d models)', this.resolvedModels.length);
  }

  /**
   * Build route configuration from the plugin context config.
   */
  private buildRouteConfigFromContext(ctx: PluginContext): RouteConfig {
    const config: RouteConfig = {};

    // Route preference
    const route = ctx.config.route as string | undefined;
    if (route === 'price' || route === 'speed' || route === 'latency') {
      config.route = route as RoutePreference;
    }

    // Provider preferences
    const providerOrder = ctx.config.providerOrder as string[] | undefined;
    const providerExclude = ctx.config.providerExclude as string[] | undefined;
    const providerAllow = ctx.config.providerAllow as string[] | undefined;
    const requirePrimary = ctx.config.requirePrimary as boolean | undefined;

    if (providerOrder || providerExclude || providerAllow || requirePrimary !== undefined) {
      config.providers = {} as ProviderPreferences;
      if (providerOrder) config.providers.order = providerOrder;
      if (providerExclude) config.providers.exclude = providerExclude;
      if (providerAllow) config.providers.allow = providerAllow;
      if (requirePrimary !== undefined) config.providers.requirePrimary = requirePrimary;
    }

    // Transforms
    const transforms = ctx.config.transforms as string | undefined;
    if (transforms === 'middle-out') {
      config.transforms = { prompt: 'middle-out' } as OpenRouterTransforms;
    }

    // Fallback chain
    const fallbacks = ctx.config.fallbackModels as string[] | undefined;
    if (fallbacks && fallbacks.length > 0) {
      config.fallbacks = fallbacks;
    }

    return config;
  }

  /**
   * Extract OpenRouter-specific generation stats from the response object.
   * OpenRouter includes these in custom response fields / headers.
   */
  private extractGenerationStats(response: unknown): void {
    try {
      const resp = response as Record<string, unknown>;
      this.lastGenerationStats = {
        generationId: resp.id as string | undefined,
        upstreamProvider: resp.provider as string | undefined,
      };
    } catch {
      // Stats extraction is best-effort
      this.lastGenerationStats = null;
    }
  }

  /**
   * Wrap a raw error with OpenRouter-specific context.
   */
  private wrapError(error: unknown, errorInfo: OpenRouterErrorInfo): Error {
    const originalMessage = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`[OpenRouter/${errorInfo.type}] ${errorInfo.message} (${originalMessage})`);
    if (error instanceof Error) {
      wrapped.stack = error.stack;
      wrapped.cause = error;
    }
    return wrapped;
  }
}

// ---------------------------------------------------------------------------
// Re-exports for consumers
// ---------------------------------------------------------------------------

export { OpenRouterRouter } from './router.js';
export type {
  RouteConfig,
  RoutePreference,
  ProviderPreferences,
  OpenRouterTransforms,
  OpenRouterGenerationStats,
  OpenRouterErrorInfo,
  OpenRouterUsageStats,
  ModelUsageStats,
  ModelSelectionCriteria,
} from './router.js';

export {
  OPENROUTER_FALLBACK_MODELS,
  fetchOpenRouterModels,
  findModelById,
  findModelsByProvider,
  findModelsByCapability,
} from './models.js';
export type {
  OpenRouterModelInfo,
  OpenRouterModelCapabilities,
  OpenRouterAPIModel,
} from './models.js';

export default OpenRouterProvider;
