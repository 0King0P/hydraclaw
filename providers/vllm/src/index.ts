import { createOpenAICompatProvider } from '@hydraclaw/provider-shared';
import type { AIProvider, ModelInfo } from '@hydraclaw/core';

const VLLM_FALLBACK_MODELS: ModelInfo[] = [];

export const VLLMProvider: AIProvider = createOpenAICompatProvider({
  id: 'vllm',
  name: 'vLLM',
  defaultBaseUrl: 'http://localhost:8000/v1',
  models: [],
  apiKeyOptional: true,
  skipStreamOptions: true,
  dynamicModels: {
    provider: 'vllm',
    fallback: VLLM_FALLBACK_MODELS,
  },
});

export default VLLMProvider;
