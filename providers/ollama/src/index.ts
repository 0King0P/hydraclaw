import { createOpenAICompatProvider } from '@hydraclaw/provider-shared';
import type { AIProvider, ModelInfo } from '@hydraclaw/core';

const OLLAMA_FALLBACK_MODELS: ModelInfo[] = [
  {
    id: 'llama3.2',
    name: 'Llama 3.2',
    provider: 'ollama',
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'mistral',
    name: 'Mistral 7B',
    provider: 'ollama',
    contextWindow: 32000,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'codellama',
    name: 'Code Llama',
    provider: 'ollama',
    contextWindow: 16384,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
  },
  {
    id: 'llava',
    name: 'LLaVA',
    provider: 'ollama',
    contextWindow: 4096,
    supportsVision: true,
    supportsTools: false,
    supportsStreaming: true,
  },
];

export const OllamaProvider: AIProvider = createOpenAICompatProvider({
  id: 'ollama',
  name: 'Ollama',
  defaultBaseUrl: 'http://localhost:11434/v1',
  models: [],
  apiKeyOptional: true,
  skipStreamOptions: true,
  dynamicModels: {
    provider: 'ollama',
    fallback: OLLAMA_FALLBACK_MODELS,
  },
});

export default OllamaProvider;
