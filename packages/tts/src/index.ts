export type {
  TTSProvider,
  TTSVoice,
  TTSOptions,
  TTSResult,
  STTProvider,
  STTOptions,
  STTResult,
} from './types.js';

export { OpenAITTSProvider } from './openai-tts.js';
export type { OpenAITTSConfig } from './openai-tts.js';

export { OpenAISTTProvider } from './openai-stt.js';
export type { OpenAISTTConfig } from './openai-stt.js';

export { EdgeTTSProvider } from './edge-tts.js';
export type { EdgeTTSConfig } from './edge-tts.js';

export { VoiceManager } from './manager.js';
export type { VoiceManagerConfig } from './manager.js';
