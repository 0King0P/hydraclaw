import { createOpenAICompatProvider } from '@hydraclaw/provider-shared';
import type { AIProvider, ModelInfo } from '@hydraclaw/core';

const DEEPSEEK_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'deepseek',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.14,
    outputCostPer1M: 0.28,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    provider: 'deepseek',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputCostPer1M: 0.55,
    outputCostPer1M: 2.19,
  },
];

export const DeepSeekProvider: AIProvider = createOpenAICompatProvider({
  id: 'deepseek',
  name: 'DeepSeek',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  models: DEEPSEEK_MODELS,
});

export default DeepSeekProvider;
