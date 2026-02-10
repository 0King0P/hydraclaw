import { createOpenAICompatProvider } from '@hydraclaw/provider-shared';
import type { AIProvider, ModelInfo } from '@hydraclaw/core';

const XAI_MODELS: ModelInfo[] = [
  {
    id: 'grok-2',
    name: 'Grok 2',
    provider: 'xai',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2,
    outputCostPer1M: 10,
  },
  {
    id: 'grok-2-mini',
    name: 'Grok 2 Mini',
    provider: 'xai',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.3,
    outputCostPer1M: 0.5,
  },
];

export const XAIProvider: AIProvider = createOpenAICompatProvider({
  id: 'xai',
  name: 'xAI (Grok)',
  defaultBaseUrl: 'https://api.x.ai/v1',
  models: XAI_MODELS,
});

export default XAIProvider;
