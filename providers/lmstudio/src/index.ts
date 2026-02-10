import { createOpenAICompatProvider } from '@hydraclaw/provider-shared';
import type { AIProvider, ModelInfo } from '@hydraclaw/core';

const LMSTUDIO_FALLBACK_MODELS: ModelInfo[] = [];

export const LMStudioProvider: AIProvider = createOpenAICompatProvider({
  id: 'lmstudio',
  name: 'LM Studio',
  defaultBaseUrl: 'http://localhost:1234/v1',
  models: [],
  apiKeyOptional: true,
  skipStreamOptions: true,
  dynamicModels: {
    provider: 'lmstudio',
    fallback: LMSTUDIO_FALLBACK_MODELS,
  },
});

export default LMStudioProvider;
