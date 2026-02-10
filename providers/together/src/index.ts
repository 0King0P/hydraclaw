import { createOpenAICompatProvider } from '@hydraclaw/provider-shared';
import type { AIProvider, ModelInfo } from '@hydraclaw/core';

const TOGETHER_MODELS: ModelInfo[] = [
  {
    id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
    name: 'Llama 3.1 405B Instruct Turbo',
    provider: 'together',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 3.5,
    outputCostPer1M: 3.5,
  },
  {
    id: 'mistralai/Mixtral-8x22B-Instruct-v0.1',
    name: 'Mixtral 8x22B Instruct',
    provider: 'together',
    contextWindow: 65536,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 1.2,
    outputCostPer1M: 1.2,
  },
  {
    id: 'Qwen/Qwen2.5-72B-Instruct-Turbo',
    name: 'Qwen 2.5 72B Instruct Turbo',
    provider: 'together',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 1.2,
    outputCostPer1M: 1.2,
  },
];

export const TogetherProvider: AIProvider = createOpenAICompatProvider({
  id: 'together',
  name: 'Together.ai',
  defaultBaseUrl: 'https://api.together.xyz/v1',
  models: TOGETHER_MODELS,
});

export default TogetherProvider;
