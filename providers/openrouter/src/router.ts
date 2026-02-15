import type { Logger } from '@hydraclaw/core';
import type { OpenRouterModelInfo, OpenRouterModelCapabilities } from './models.js';

// ---------------------------------------------------------------------------
// Route preference types (matches OpenRouter's API)
// ---------------------------------------------------------------------------

/** OpenRouter route type controls how requests are routed across providers. */
export type RoutePreference = 'price' | 'speed' | 'latency';

/** Provider ordering preference for OpenRouter's multi-provider routing. */
export interface ProviderPreferences {
  /** Ordered list of provider names to prefer (e.g. ["Anthropic", "Google"]) */
  order?: string[];
  /** Providers to exclude from routing */
  exclude?: string[];
  /** Only allow these providers */
  allow?: string[];
  /** Whether to require the primary provider (disables fallback) */
  requirePrimary?: boolean;
}

/** Transforms that can be applied to OpenRouter requests. */
export interface OpenRouterTransforms {
  /** Prompt transforms (e.g. "middle-out" for context compression) */
  prompt?: 'middle-out';
}

/** Full routing configuration for a single request. */
export interface RouteConfig {
  /** Route optimization strategy */
  route?: RoutePreference;
  /** Provider ordering and filtering */
  providers?: ProviderPreferences;
  /** Request transforms */
  transforms?: OpenRouterTransforms;
  /** Fallback model chain - if the primary model fails, try these in order */
  fallbacks?: string[];
}

// ---------------------------------------------------------------------------
// Credit / usage tracking
// ---------------------------------------------------------------------------

export interface OpenRouterUsageStats {
  /** Total requests made in this session */
  totalRequests: number;
  /** Total prompt tokens consumed */
  totalPromptTokens: number;
  /** Total completion tokens consumed */
  totalCompletionTokens: number;
  /** Estimated total cost in USD */
  estimatedCostUsd: number;
  /** Per-model breakdown */
  perModel: Map<string, ModelUsageStats>;
}

export interface ModelUsageStats {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

// ---------------------------------------------------------------------------
// Generation stats from OpenRouter response headers
// ---------------------------------------------------------------------------

export interface OpenRouterGenerationStats {
  /** The generation ID returned by OpenRouter */
  generationId?: string;
  /** Upstream latency in ms */
  upstreamLatencyMs?: number;
  /** Which upstream provider actually served the request */
  upstreamProvider?: string;
  /** Whether the response was cached */
  cached?: boolean;
}

// ---------------------------------------------------------------------------
// OpenRouter router: model selection, routing, and usage tracking
// ---------------------------------------------------------------------------

export class OpenRouterRouter {
  private models: OpenRouterModelInfo[] = [];
  private usageStats: OpenRouterUsageStats;
  private logger: Logger;
  private routeConfig: RouteConfig;

  constructor(logger: Logger, routeConfig?: RouteConfig) {
    this.logger = logger;
    this.routeConfig = routeConfig ?? {};
    this.usageStats = {
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      estimatedCostUsd: 0,
      perModel: new Map(),
    };
  }

  /** Replace the available model list (called after fetching from API or using fallback). */
  setModels(models: OpenRouterModelInfo[]): void {
    this.models = models;
  }

  /** Update the default route configuration. */
  setRouteConfig(config: RouteConfig): void {
    this.routeConfig = config;
  }

  /** Get the current route configuration. */
  getRouteConfig(): RouteConfig {
    return this.routeConfig;
  }

  // -------------------------------------------------------------------------
  // Model selection
  // -------------------------------------------------------------------------

  /**
   * Select the best model for a given task based on requirements.
   * Returns the model ID string or undefined if no match.
   */
  selectModel(requirements: ModelSelectionCriteria): string | undefined {
    let candidates = [...this.models];

    // Filter by required capabilities
    if (requirements.needsVision) {
      candidates = candidates.filter((m) => m.capabilities.vision);
    }
    if (requirements.needsTools) {
      candidates = candidates.filter((m) => m.capabilities.tools);
    }
    if (requirements.needsJsonMode) {
      candidates = candidates.filter((m) => m.capabilities.jsonMode);
    }
    if (requirements.needsStreaming) {
      candidates = candidates.filter((m) => m.capabilities.streaming);
    }

    // Filter by minimum context window
    if (requirements.minContextWindow) {
      candidates = candidates.filter((m) => m.contextWindow >= requirements.minContextWindow!);
    }

    // Filter by upstream provider preference
    if (requirements.preferredProviders && requirements.preferredProviders.length > 0) {
      const providerSet = new Set(requirements.preferredProviders);
      const preferred = candidates.filter((m) => providerSet.has(m.upstreamProvider));
      if (preferred.length > 0) {
        candidates = preferred;
      }
    }

    // Filter by max cost
    if (requirements.maxInputCostPer1M !== undefined) {
      candidates = candidates.filter(
        (m) => m.inputCostPer1M !== undefined && m.inputCostPer1M <= requirements.maxInputCostPer1M!,
      );
    }

    if (candidates.length === 0) {
      return undefined;
    }

    // Sort based on optimization strategy
    const strategy = requirements.optimizeFor ?? this.routeConfig.route ?? 'price';
    candidates.sort((a, b) => this.compareModels(a, b, strategy));

    return candidates[0].id;
  }

  /**
   * Get a fallback chain for a model. If the model fails, try these in order.
   * Uses the route config fallbacks or generates sensible defaults.
   */
  getFallbackChain(primaryModelId: string): string[] {
    // Use explicit fallbacks if configured
    if (this.routeConfig.fallbacks && this.routeConfig.fallbacks.length > 0) {
      return this.routeConfig.fallbacks.filter((id) => id !== primaryModelId);
    }

    // Generate automatic fallbacks based on the primary model
    const primary = this.models.find((m) => m.id === primaryModelId);
    if (!primary) return [];

    // Find models with similar capabilities but from different providers
    const fallbacks = this.models
      .filter((m) => {
        if (m.id === primaryModelId) return false;
        if (m.upstreamProvider === primary.upstreamProvider) return false;
        // Must support at least the same capabilities
        if (primary.capabilities.vision && !m.capabilities.vision) return false;
        if (primary.capabilities.tools && !m.capabilities.tools) return false;
        return true;
      })
      .sort((a, b) => this.compareModels(a, b, 'price'))
      .slice(0, 3)
      .map((m) => m.id);

    return fallbacks;
  }

  // -------------------------------------------------------------------------
  // Request parameter building
  // -------------------------------------------------------------------------

  /**
   * Build OpenRouter-specific extra body parameters for a request.
   * These are added to the request body alongside the standard OpenAI fields.
   */
  buildRouteParams(overrides?: RouteConfig): Record<string, unknown> {
    const config = { ...this.routeConfig, ...overrides };
    const extra: Record<string, unknown> = {};

    if (config.route) {
      extra.route = config.route;
    }

    if (config.providers) {
      const providerPref: Record<string, unknown> = {};
      if (config.providers.order) {
        providerPref.order = config.providers.order;
      }
      if (config.providers.exclude) {
        providerPref.exclude = config.providers.exclude;
      }
      if (config.providers.allow) {
        providerPref.allow = config.providers.allow;
      }
      if (config.providers.requirePrimary !== undefined) {
        providerPref.require_parameters = config.providers.requirePrimary;
      }
      if (Object.keys(providerPref).length > 0) {
        extra.provider = providerPref;
      }
    }

    if (config.transforms?.prompt) {
      extra.transforms = [config.transforms.prompt];
    }

    return extra;
  }

  // -------------------------------------------------------------------------
  // Usage tracking
  // -------------------------------------------------------------------------

  /**
   * Record token usage from a completed request.
   */
  recordUsage(
    modelId: string,
    promptTokens: number,
    completionTokens: number,
  ): void {
    const model = this.models.find((m) => m.id === modelId);
    const inputCost = model?.inputCostPer1M ?? 0;
    const outputCost = model?.outputCostPer1M ?? 0;

    const cost =
      (promptTokens / 1_000_000) * inputCost +
      (completionTokens / 1_000_000) * outputCost;

    this.usageStats.totalRequests++;
    this.usageStats.totalPromptTokens += promptTokens;
    this.usageStats.totalCompletionTokens += completionTokens;
    this.usageStats.estimatedCostUsd += cost;

    let modelStats = this.usageStats.perModel.get(modelId);
    if (!modelStats) {
      modelStats = { requests: 0, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 };
      this.usageStats.perModel.set(modelId, modelStats);
    }
    modelStats.requests++;
    modelStats.promptTokens += promptTokens;
    modelStats.completionTokens += completionTokens;
    modelStats.estimatedCostUsd += cost;

    this.logger.debug(
      'OpenRouter usage: model=%s, prompt=%d, completion=%d, cost=$%s',
      modelId,
      promptTokens,
      completionTokens,
      cost.toFixed(6),
    );
  }

  /** Get accumulated usage statistics. */
  getUsageStats(): OpenRouterUsageStats {
    return { ...this.usageStats };
  }

  /** Reset usage statistics. */
  resetUsageStats(): void {
    this.usageStats = {
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      estimatedCostUsd: 0,
      perModel: new Map(),
    };
  }

  // -------------------------------------------------------------------------
  // Cheapest / fastest model queries
  // -------------------------------------------------------------------------

  /**
   * Find the cheapest model that meets the given capability requirements.
   */
  cheapestModel(capabilities?: Partial<OpenRouterModelCapabilities>): string | undefined {
    return this.selectModel({
      optimizeFor: 'price',
      needsVision: capabilities?.vision,
      needsTools: capabilities?.tools,
      needsJsonMode: capabilities?.jsonMode,
      needsStreaming: capabilities?.streaming,
    });
  }

  /**
   * Find the cheapest model with vision support.
   */
  cheapestVisionModel(): string | undefined {
    return this.cheapestModel({ vision: true });
  }

  /**
   * Find the cheapest model with tool/function calling support.
   */
  cheapestToolModel(): string | undefined {
    return this.cheapestModel({ tools: true });
  }

  // -------------------------------------------------------------------------
  // Error classification
  // -------------------------------------------------------------------------

  /**
   * Classify an OpenRouter error and determine if it is retriable.
   */
  classifyError(error: unknown): OpenRouterErrorInfo {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      const anyError = error as unknown as Record<string, unknown>;
      const status = (anyError.status as number) ?? (anyError.statusCode as number) ?? 0;

      // Rate limiting
      if (status === 429 || message.includes('rate limit')) {
        return {
          type: 'rate_limit',
          retriable: true,
          retryAfterMs: this.parseRetryAfter(anyError),
          message: 'OpenRouter rate limit exceeded. Retry after cooldown.',
        };
      }

      // Credit exhaustion
      if (
        status === 402 ||
        message.includes('insufficient credits') ||
        message.includes('payment required') ||
        message.includes('out of credits')
      ) {
        return {
          type: 'credits_exhausted',
          retriable: false,
          message: 'OpenRouter credits exhausted. Please add credits at https://openrouter.ai/credits',
        };
      }

      // Model not available
      if (status === 404 || message.includes('model not found') || message.includes('no endpoints')) {
        return {
          type: 'model_unavailable',
          retriable: true,
          message: `Model not available on OpenRouter. Try a different model or check availability.`,
        };
      }

      // Content moderation
      if (status === 403 || message.includes('moderation') || message.includes('content policy')) {
        return {
          type: 'content_filtered',
          retriable: false,
          message: 'Request blocked by content moderation policy.',
        };
      }

      // Context length exceeded
      if (message.includes('context length') || message.includes('too many tokens')) {
        return {
          type: 'context_exceeded',
          retriable: false,
          message: 'Input exceeds the model context window. Reduce message length or use a model with a larger context.',
        };
      }

      // Upstream provider errors (500+)
      if (status >= 500) {
        return {
          type: 'upstream_error',
          retriable: true,
          retryAfterMs: 2000,
          message: `Upstream provider error (${status}). Will retry with fallback if available.`,
        };
      }

      // Authentication
      if (status === 401) {
        return {
          type: 'auth_error',
          retriable: false,
          message: 'Invalid OpenRouter API key. Check your configuration.',
        };
      }
    }

    return {
      type: 'unknown',
      retriable: false,
      message: `Unknown error: ${String(error)}`,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private compareModels(a: OpenRouterModelInfo, b: OpenRouterModelInfo, strategy: RoutePreference): number {
    switch (strategy) {
      case 'price': {
        // Sort by total cost (input + output), cheapest first
        const costA = (a.inputCostPer1M ?? Infinity) + (a.outputCostPer1M ?? Infinity);
        const costB = (b.inputCostPer1M ?? Infinity) + (b.outputCostPer1M ?? Infinity);
        return costA - costB;
      }
      case 'speed':
      case 'latency': {
        // Prefer smaller models (usually faster) and lower context (less overhead)
        // Heuristic: use output cost as a proxy for model size/speed
        const speedA = a.outputCostPer1M ?? Infinity;
        const speedB = b.outputCostPer1M ?? Infinity;
        return speedA - speedB;
      }
      default:
        return 0;
    }
  }

  private parseRetryAfter(error: Record<string, unknown>): number {
    const headers = error.headers as Record<string, string> | undefined;
    if (headers?.['retry-after']) {
      const seconds = parseInt(headers['retry-after'], 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }
    // Default retry: 5 seconds for rate limits
    return 5000;
  }
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export interface ModelSelectionCriteria {
  /** Optimize selection for price, speed, or latency */
  optimizeFor?: RoutePreference;
  /** Require vision/image understanding */
  needsVision?: boolean;
  /** Require function/tool calling */
  needsTools?: boolean;
  /** Require JSON mode output */
  needsJsonMode?: boolean;
  /** Require streaming support */
  needsStreaming?: boolean;
  /** Minimum context window in tokens */
  minContextWindow?: number;
  /** Preferred upstream providers (e.g. ["anthropic", "openai"]) */
  preferredProviders?: string[];
  /** Maximum input cost per 1M tokens */
  maxInputCostPer1M?: number;
}

export interface OpenRouterErrorInfo {
  type:
    | 'rate_limit'
    | 'credits_exhausted'
    | 'model_unavailable'
    | 'content_filtered'
    | 'context_exceeded'
    | 'upstream_error'
    | 'auth_error'
    | 'unknown';
  retriable: boolean;
  retryAfterMs?: number;
  message: string;
}
