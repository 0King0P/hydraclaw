import { createOpenAICompatProvider } from '@hydraclaw/provider-shared';
import type { AIProvider, ModelInfo } from '@hydraclaw/core';

const COHERE_MODELS: ModelInfo[] = [
  {
    id: 'command-r-plus',
    name: 'Command R+',
    provider: 'cohere',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2.5,
    outputCostPer1M: 10,
  },
  {
    id: 'command-r',
    name: 'Command R',
    provider: 'cohere',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
  },
  {
    id: 'command-light',
    name: 'Command Light',
    provider: 'cohere',
    contextWindow: 4096,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputCostPer1M: 0.3,
    outputCostPer1M: 0.6,
  },
];

export const CohereProvider: AIProvider = createOpenAICompatProvider({
  id: 'cohere',
  name: 'Cohere',
  defaultBaseUrl: 'https://api.cohere.com/compatibility/v1',
  models: COHERE_MODELS,
});

export default CohereProvider;
