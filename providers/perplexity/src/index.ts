import { createOpenAICompatProvider } from '@hydraclaw/provider-shared';
import type { AIProvider, ModelInfo } from '@hydraclaw/core';

const PERPLEXITY_MODELS: ModelInfo[] = [
  {
    id: 'sonar-pro',
    name: 'Sonar Pro',
    provider: 'perplexity',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
  },
  {
    id: 'sonar',
    name: 'Sonar',
    provider: 'perplexity',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputCostPer1M: 1,
    outputCostPer1M: 1,
  },
  {
    id: 'sonar-reasoning',
    name: 'Sonar Reasoning',
    provider: 'perplexity',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputCostPer1M: 1,
    outputCostPer1M: 5,
  },
];

export const PerplexityProvider: AIProvider = createOpenAICompatProvider({
  id: 'perplexity',
  name: 'Perplexity',
  defaultBaseUrl: 'https://api.perplexity.ai',
  models: PERPLEXITY_MODELS,
});

export default PerplexityProvider;
