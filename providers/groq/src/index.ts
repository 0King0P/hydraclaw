import { createOpenAICompatProvider } from '@hydraclaw/provider-shared';
import type { AIProvider, ModelInfo } from '@hydraclaw/core';

const GROQ_MODELS: ModelInfo[] = [
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B Versatile',
    provider: 'groq',
    contextWindow: 128000,
    maxOutputTokens: 32768,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    provider: 'groq',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B',
    provider: 'groq',
    contextWindow: 32768,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'gemma2-9b-it',
    name: 'Gemma 2 9B IT',
    provider: 'groq',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
  },
];

export const GroqProvider: AIProvider = createOpenAICompatProvider({
  id: 'groq',
  name: 'Groq',
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
  models: GROQ_MODELS,
});

export default GroqProvider;
