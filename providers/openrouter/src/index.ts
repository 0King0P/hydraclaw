import { createOpenAICompatProvider } from '@hydraclaw/provider-shared';
import type { AIProvider, ModelInfo } from '@hydraclaw/core';

const OPENROUTER_MODELS: ModelInfo[] = [
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet (OpenRouter)',
    provider: 'openrouter',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o (OpenRouter)',
    provider: 'openrouter',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2.5,
    outputCostPer1M: 10,
  },
  {
    id: 'google/gemini-pro',
    name: 'Gemini Pro (OpenRouter)',
    provider: 'openrouter',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.125,
    outputCostPer1M: 0.375,
  },
  {
    id: 'meta-llama/llama-3.1-405b',
    name: 'Llama 3.1 405B (OpenRouter)',
    provider: 'openrouter',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 3,
    outputCostPer1M: 3,
  },
];

export const OpenRouterProvider: AIProvider = createOpenAICompatProvider({
  id: 'openrouter',
  name: 'OpenRouter',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  models: OPENROUTER_MODELS,
  defaultHeaders: {
    'HTTP-Referer': 'https://hydraclaw.dev',
    'X-Title': 'HydraClaw',
  },
  extraHeaders: (ctx) => {
    const headers: Record<string, string> = {};
    const referer = ctx.config.httpReferer as string | undefined;
    const title = ctx.config.xTitle as string | undefined;
    if (referer) headers['HTTP-Referer'] = referer;
    if (title) headers['X-Title'] = title;
    return headers;
  },
});

export default OpenRouterProvider;
