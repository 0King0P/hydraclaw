import OpenAI from 'openai';
import { createLogger } from '@hydraclaw/core';
import type { TTSProvider, TTSVoice, TTSOptions, TTSResult } from './types.js';

const logger = createLogger('tts:openai');

const OPENAI_VOICES: TTSVoice[] = [
  { id: 'alloy', name: 'Alloy', language: 'en', gender: 'neutral' },
  { id: 'echo', name: 'Echo', language: 'en', gender: 'male' },
  { id: 'fable', name: 'Fable', language: 'en', gender: 'neutral' },
  { id: 'onyx', name: 'Onyx', language: 'en', gender: 'male' },
  { id: 'nova', name: 'Nova', language: 'en', gender: 'female' },
  { id: 'shimmer', name: 'Shimmer', language: 'en', gender: 'female' },
];

const VALID_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4.0;
const DEFAULT_VOICE = 'alloy';
const DEFAULT_FORMAT = 'mp3';

export interface OpenAITTSConfig {
  apiKey?: string;
  baseURL?: string;
  model?: 'tts-1' | 'tts-1-hd';
  defaultVoice?: string;
  defaultFormat?: typeof VALID_FORMATS[number];
  useOpenRouter?: boolean;
  openRouterApiKey?: string;
}

export class OpenAITTSProvider implements TTSProvider {
  readonly id = 'openai-tts';
  readonly name = 'OpenAI Text-to-Speech';

  private client: OpenAI;
  private model: 'tts-1' | 'tts-1-hd';
  private defaultVoice: string;
  private defaultFormat: typeof VALID_FORMATS[number];

  constructor(config: OpenAITTSConfig = {}) {
    const apiKey = config.useOpenRouter
      ? config.openRouterApiKey ?? process.env.OPENROUTER_API_KEY
      : config.apiKey ?? process.env.OPENAI_API_KEY;

    const baseURL = config.useOpenRouter
      ? 'https://openrouter.ai/api/v1'
      : config.baseURL ?? process.env.OPENAI_BASE_URL;

    if (!apiKey) {
      throw new Error(
        config.useOpenRouter
          ? 'OpenRouter API key is required. Set OPENROUTER_API_KEY or pass openRouterApiKey.'
          : 'OpenAI API key is required. Set OPENAI_API_KEY or pass apiKey.'
      );
    }

    this.client = new OpenAI({ apiKey, baseURL });
    this.model = config.model ?? 'tts-1';
    this.defaultVoice = config.defaultVoice ?? DEFAULT_VOICE;
    this.defaultFormat = config.defaultFormat ?? DEFAULT_FORMAT;

    logger.debug('OpenAI TTS provider initialized', { model: this.model, baseURL });
  }

  voices(): TTSVoice[] {
    return [...OPENAI_VOICES];
  }

  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text must not be empty');
    }

    const voice = this.resolveVoice(options?.voice);
    const format = this.resolveFormat(options?.format);
    const speed = this.resolveSpeed(options?.speed);

    logger.debug('Synthesizing speech', { voice, format, speed, textLength: text.length });

    const response = await this.client.audio.speech.create({
      model: this.model,
      input: text,
      voice: voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      response_format: format,
      speed,
    });

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    logger.debug('Speech synthesized', { audioSize: audio.length, format });

    return {
      audio,
      format,
      sampleRate: options?.sampleRate,
    };
  }

  private resolveVoice(voice?: string): string {
    if (!voice) return this.defaultVoice;

    const validVoice = OPENAI_VOICES.find((v) => v.id === voice);
    if (!validVoice) {
      logger.warn(`Unknown voice "${voice}", falling back to "${this.defaultVoice}"`);
      return this.defaultVoice;
    }

    return voice;
  }

  private resolveFormat(format?: string): typeof VALID_FORMATS[number] {
    if (!format) return this.defaultFormat;

    if (VALID_FORMATS.includes(format as typeof VALID_FORMATS[number])) {
      return format as typeof VALID_FORMATS[number];
    }

    logger.warn(`Unsupported format "${format}", falling back to "${this.defaultFormat}"`);
    return this.defaultFormat;
  }

  private resolveSpeed(speed?: number): number {
    if (speed === undefined || speed === null) return 1.0;

    if (speed < MIN_SPEED || speed > MAX_SPEED) {
      const clamped = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
      logger.warn(`Speed ${speed} out of range [${MIN_SPEED}, ${MAX_SPEED}], clamped to ${clamped}`);
      return clamped;
    }

    return speed;
  }
}
