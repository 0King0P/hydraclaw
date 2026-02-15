import type { ModelInfo } from '@hydraclaw/core';

// ---------------------------------------------------------------------------
// OpenRouter model capability flags
// ---------------------------------------------------------------------------

export interface OpenRouterModelCapabilities {
  vision: boolean;
  tools: boolean;
  streaming: boolean;
  jsonMode: boolean;
}

// ---------------------------------------------------------------------------
// Extended model info with OpenRouter-specific metadata
// ---------------------------------------------------------------------------

export interface OpenRouterModelInfo extends ModelInfo {
  /** Original upstream provider (e.g. "anthropic", "openai") */
  upstreamProvider: string;
  /** Model capability flags */
  capabilities: OpenRouterModelCapabilities;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Whether this model is free-tier on OpenRouter */
  isFree: boolean;
  /** Model modality */
  modality: 'text' | 'multimodal';
}

// ---------------------------------------------------------------------------
// API response types from OpenRouter /api/v1/models
// ---------------------------------------------------------------------------

export interface OpenRouterAPIModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
    image?: string;
    request?: string;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  per_request_limits?: Record<string, unknown>;
  architecture?: {
    modality: string;
    tokenizer: string;
    instruct_type?: string;
  };
}

export interface OpenRouterModelsResponse {
  data: OpenRouterAPIModel[];
}

// ---------------------------------------------------------------------------
// Fallback model catalog: 35+ popular models across providers
// ---------------------------------------------------------------------------

export const OPENROUTER_FALLBACK_MODELS: OpenRouterModelInfo[] = [
  // ---- Anthropic Claude models ----
  {
    id: 'anthropic/claude-opus-4',
    name: 'Claude Opus 4',
    provider: 'openrouter',
    upstreamProvider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 32000,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 15,
    outputCostPer1M: 75,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'openrouter',
    upstreamProvider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'openrouter',
    upstreamProvider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },
  {
    id: 'anthropic/claude-3.5-haiku',
    name: 'Claude 3.5 Haiku',
    provider: 'openrouter',
    upstreamProvider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.8,
    outputCostPer1M: 4,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },
  {
    id: 'anthropic/claude-3-haiku',
    name: 'Claude 3 Haiku',
    provider: 'openrouter',
    upstreamProvider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.25,
    outputCostPer1M: 1.25,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },

  // ---- OpenAI models ----
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openrouter',
    upstreamProvider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2.5,
    outputCostPer1M: 10,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openrouter',
    upstreamProvider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },
  {
    id: 'openai/gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openrouter',
    upstreamProvider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 10,
    outputCostPer1M: 30,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },
  {
    id: 'openai/o1',
    name: 'o1',
    provider: 'openrouter',
    upstreamProvider: 'openai',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 15,
    outputCostPer1M: 60,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: false },
    isFree: false,
    modality: 'multimodal',
  },
  {
    id: 'openai/o3-mini',
    name: 'o3 Mini',
    provider: 'openrouter',
    upstreamProvider: 'openai',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 1.1,
    outputCostPer1M: 4.4,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: false },
    isFree: false,
    modality: 'text',
  },

  // ---- Google Gemini models ----
  {
    id: 'google/gemini-2.0-flash-001',
    name: 'Gemini 2.0 Flash',
    provider: 'openrouter',
    upstreamProvider: 'google',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },
  {
    id: 'google/gemini-2.5-pro-preview',
    name: 'Gemini 2.5 Pro Preview',
    provider: 'openrouter',
    upstreamProvider: 'google',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 1.25,
    outputCostPer1M: 10,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },
  {
    id: 'google/gemini-2.0-flash-lite-001',
    name: 'Gemini 2.0 Flash Lite',
    provider: 'openrouter',
    upstreamProvider: 'google',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.3,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },
  {
    id: 'google/gemini-pro-1.5',
    name: 'Gemini Pro 1.5',
    provider: 'openrouter',
    upstreamProvider: 'google',
    contextWindow: 2097152,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 1.25,
    outputCostPer1M: 5,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },

  // ---- Meta Llama models ----
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct',
    provider: 'openrouter',
    upstreamProvider: 'meta-llama',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.12,
    outputCostPer1M: 0.3,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },
  {
    id: 'meta-llama/llama-3.1-405b-instruct',
    name: 'Llama 3.1 405B Instruct',
    provider: 'openrouter',
    upstreamProvider: 'meta-llama',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2,
    outputCostPer1M: 2,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },
  {
    id: 'meta-llama/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B Instruct',
    provider: 'openrouter',
    upstreamProvider: 'meta-llama',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.12,
    outputCostPer1M: 0.3,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },
  {
    id: 'meta-llama/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    provider: 'openrouter',
    upstreamProvider: 'meta-llama',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.05,
    outputCostPer1M: 0.08,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },
  {
    id: 'meta-llama/llama-4-maverick',
    name: 'Llama 4 Maverick',
    provider: 'openrouter',
    upstreamProvider: 'meta-llama',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.2,
    outputCostPer1M: 0.6,
    capabilities: { vision: true, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'multimodal',
  },

  // ---- Mistral / Mixtral models ----
  {
    id: 'mistralai/mistral-large',
    name: 'Mistral Large',
    provider: 'openrouter',
    upstreamProvider: 'mistralai',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2,
    outputCostPer1M: 6,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },
  {
    id: 'mistralai/mixtral-8x7b-instruct',
    name: 'Mixtral 8x7B Instruct',
    provider: 'openrouter',
    upstreamProvider: 'mistralai',
    contextWindow: 32768,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.24,
    outputCostPer1M: 0.24,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },
  {
    id: 'mistralai/mistral-small',
    name: 'Mistral Small',
    provider: 'openrouter',
    upstreamProvider: 'mistralai',
    contextWindow: 32000,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.3,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },

  // ---- DeepSeek models ----
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'openrouter',
    upstreamProvider: 'deepseek',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.14,
    outputCostPer1M: 0.28,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'openrouter',
    upstreamProvider: 'deepseek',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputCostPer1M: 0.55,
    outputCostPer1M: 2.19,
    capabilities: { vision: false, tools: false, streaming: true, jsonMode: false },
    isFree: false,
    modality: 'text',
  },

  // ---- Qwen models ----
  {
    id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B Instruct',
    provider: 'openrouter',
    upstreamProvider: 'qwen',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.4,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct',
    name: 'Qwen 2.5 Coder 32B',
    provider: 'openrouter',
    upstreamProvider: 'qwen',
    contextWindow: 32768,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.07,
    outputCostPer1M: 0.16,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },
  {
    id: 'qwen/qwq-32b',
    name: 'QwQ 32B',
    provider: 'openrouter',
    upstreamProvider: 'qwen',
    contextWindow: 131072,
    maxOutputTokens: 32768,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.12,
    outputCostPer1M: 0.18,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },

  // ---- Cohere models ----
  {
    id: 'cohere/command-r-plus',
    name: 'Command R+',
    provider: 'openrouter',
    upstreamProvider: 'cohere',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2.5,
    outputCostPer1M: 10,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },
  {
    id: 'cohere/command-r',
    name: 'Command R',
    provider: 'openrouter',
    upstreamProvider: 'cohere',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },

  // ---- xAI / Grok models ----
  {
    id: 'x-ai/grok-2',
    name: 'Grok 2',
    provider: 'openrouter',
    upstreamProvider: 'x-ai',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2,
    outputCostPer1M: 10,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },

  // ---- Microsoft models ----
  {
    id: 'microsoft/phi-4',
    name: 'Phi-4',
    provider: 'openrouter',
    upstreamProvider: 'microsoft',
    contextWindow: 16384,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputCostPer1M: 0.07,
    outputCostPer1M: 0.14,
    capabilities: { vision: false, tools: false, streaming: true, jsonMode: false },
    isFree: false,
    modality: 'text',
  },

  // ---- Nous Research models ----
  {
    id: 'nousresearch/hermes-3-llama-3.1-405b',
    name: 'Hermes 3 405B',
    provider: 'openrouter',
    upstreamProvider: 'nousresearch',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2,
    outputCostPer1M: 2,
    capabilities: { vision: false, tools: true, streaming: true, jsonMode: true },
    isFree: false,
    modality: 'text',
  },

  // ---- Perplexity models ----
  {
    id: 'perplexity/sonar-pro',
    name: 'Sonar Pro (Perplexity)',
    provider: 'openrouter',
    upstreamProvider: 'perplexity',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
    capabilities: { vision: false, tools: false, streaming: true, jsonMode: false },
    isFree: false,
    modality: 'text',
  },
  {
    id: 'perplexity/sonar',
    name: 'Sonar (Perplexity)',
    provider: 'openrouter',
    upstreamProvider: 'perplexity',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputCostPer1M: 1,
    outputCostPer1M: 1,
    capabilities: { vision: false, tools: false, streaming: true, jsonMode: false },
    isFree: false,
    modality: 'text',
  },
];

// ---------------------------------------------------------------------------
// Helper: convert OpenRouter API model response to our internal format
// ---------------------------------------------------------------------------

export function apiModelToModelInfo(apiModel: OpenRouterAPIModel): OpenRouterModelInfo {
  const promptCost = parseFloat(apiModel.pricing.prompt) * 1_000_000;
  const completionCost = parseFloat(apiModel.pricing.completion) * 1_000_000;
  const isFree = promptCost === 0 && completionCost === 0;

  const modality = apiModel.architecture?.modality ?? 'text';
  const isMultimodal = modality.includes('image') || modality === 'multimodal';

  // Infer capabilities from model ID and metadata
  const modelId = apiModel.id.toLowerCase();
  const supportsVision = isMultimodal;
  const supportsTools = inferToolSupport(modelId);
  const supportsJsonMode = inferJsonModeSupport(modelId);

  const upstreamProvider = apiModel.id.split('/')[0] ?? 'unknown';

  return {
    id: apiModel.id,
    name: apiModel.name || apiModel.id,
    provider: 'openrouter',
    upstreamProvider,
    contextWindow: apiModel.context_length ?? 4096,
    maxOutputTokens: apiModel.top_provider?.max_completion_tokens ?? undefined,
    supportsVision,
    supportsTools,
    supportsStreaming: true,
    inputCostPer1M: promptCost,
    outputCostPer1M: completionCost,
    capabilities: {
      vision: supportsVision,
      tools: supportsTools,
      streaming: true,
      jsonMode: supportsJsonMode,
    },
    isFree,
    modality: isMultimodal ? 'multimodal' : 'text',
  };
}

// ---------------------------------------------------------------------------
// Capability inference heuristics
// ---------------------------------------------------------------------------

const TOOL_CAPABLE_PATTERNS = [
  'gpt-4', 'gpt-3.5', 'claude', 'gemini', 'mistral', 'mixtral',
  'command-r', 'llama-3', 'llama-4', 'qwen', 'hermes', 'grok',
  'deepseek-chat', 'deepseek-v', 'phi-4',
];

const NO_TOOL_PATTERNS = [
  'deepseek-r1', 'sonar', 'yi-', 'mythomax', 'dolphin', 'wizardlm',
];

function inferToolSupport(modelId: string): boolean {
  if (NO_TOOL_PATTERNS.some((p) => modelId.includes(p))) return false;
  if (TOOL_CAPABLE_PATTERNS.some((p) => modelId.includes(p))) return true;
  return false;
}

function inferJsonModeSupport(modelId: string): boolean {
  // Most modern chat models support JSON mode through OpenRouter
  const jsonCapable = [
    'gpt-4', 'gpt-3.5', 'claude', 'gemini', 'mistral', 'mixtral',
    'command-r', 'llama-3', 'llama-4', 'qwen', 'deepseek-chat', 'deepseek-v',
  ];
  return jsonCapable.some((p) => modelId.includes(p));
}

// ---------------------------------------------------------------------------
// Fetch live models from OpenRouter API
// ---------------------------------------------------------------------------

export async function fetchOpenRouterModels(
  baseUrl: string,
  apiKey: string,
): Promise<OpenRouterModelInfo[]> {
  const url = `${baseUrl.replace(/\/v1\/?$/, '')}/api/v1/models`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter /api/v1/models returned ${response.status}: ${response.statusText}`);
  }

  const body = (await response.json()) as OpenRouterModelsResponse;

  if (!body.data || !Array.isArray(body.data)) {
    throw new Error('Invalid response from OpenRouter /api/v1/models');
  }

  return body.data.map(apiModelToModelInfo);
}

// ---------------------------------------------------------------------------
// Model lookup helpers
// ---------------------------------------------------------------------------

export function findModelById(
  models: OpenRouterModelInfo[],
  id: string,
): OpenRouterModelInfo | undefined {
  return models.find((m) => m.id === id);
}

export function findModelsByProvider(
  models: OpenRouterModelInfo[],
  upstreamProvider: string,
): OpenRouterModelInfo[] {
  return models.filter((m) => m.upstreamProvider === upstreamProvider);
}

export function findModelsByCapability(
  models: OpenRouterModelInfo[],
  capability: keyof OpenRouterModelCapabilities,
): OpenRouterModelInfo[] {
  return models.filter((m) => m.capabilities[capability]);
}
