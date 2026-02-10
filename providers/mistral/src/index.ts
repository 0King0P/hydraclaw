import { createOpenAICompatProvider } from '@hydraclaw/provider-shared';
import type { AIProvider, ModelInfo } from '@hydraclaw/core';

const MISTRAL_MODELS: ModelInfo[] = [
  {
    id: 'mistral-large-latest',
    name: 'Mistral Large',
    provider: 'mistral',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2,
    outputCostPer1M: 6,
  },
  {
    id: 'mistral-medium-latest',
    name: 'Mistral Medium',
    provider: 'mistral',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2.7,
    outputCostPer1M: 8.1,
  },
  {
    id: 'mistral-small-latest',
    name: 'Mistral Small',
    provider: 'mistral',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.3,
  },
  {
    id: 'codestral-latest',
    name: 'Codestral',
    provider: 'mistral',
    contextWindow: 32000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.3,
    outputCostPer1M: 0.9,
  },
  {
    id: 'open-mistral-nemo',
    name: 'Mistral Nemo',
    provider: 'mistral',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.15,
  },
];

export const MistralProvider: AIProvider = createOpenAICompatProvider({
  id: 'mistral',
  name: 'Mistral AI',
  defaultBaseUrl: 'https://api.mistral.ai/v1',
  models: MISTRAL_MODELS,
});

export default MistralProvider;
