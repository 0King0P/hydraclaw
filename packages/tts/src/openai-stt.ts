import OpenAI from 'openai';
import { createLogger } from '@hydraclaw/core';
import type { STTProvider, STTOptions, STTResult } from './types.js';

const logger = createLogger({ name: 'tts:openai-stt' });

const DEFAULT_MODEL = 'whisper-1';

export interface OpenAISTTConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  useOpenRouter?: boolean;
  openRouterApiKey?: string;
}

export class OpenAISTTProvider implements STTProvider {
  readonly id = 'openai-stt';
  readonly name = 'OpenAI Whisper Speech-to-Text';

  private client: OpenAI;
  private model: string;

  constructor(config: OpenAISTTConfig = {}) {
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
    this.model = config.model ?? DEFAULT_MODEL;

    logger.debug('OpenAI STT provider initialized', { model: this.model, baseURL });
  }

  async transcribe(audio: Buffer, options?: STTOptions): Promise<STTResult> {
    if (!audio || audio.length === 0) {
      throw new Error('Audio buffer must not be empty');
    }

    const format = options?.format ?? 'wav';
    const filename = `audio.${format}`;

    logger.debug('Transcribing audio', {
      audioSize: audio.length,
      language: options?.language,
      format,
    });

    const file = new File([audio], filename, {
      type: this.getMimeType(format),
    });

    // First, get the verbose JSON response for segments
    const verboseResponse = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      language: options?.language,
      prompt: options?.prompt,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });

    const result: STTResult = {
      text: verboseResponse.text,
      language: verboseResponse.language,
      duration: verboseResponse.duration,
    };

    // Extract segments if available
    if (verboseResponse.segments && verboseResponse.segments.length > 0) {
      result.segments = verboseResponse.segments.map((seg) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text,
      }));
    }

    logger.debug('Transcription complete', {
      textLength: result.text.length,
      language: result.language,
      duration: result.duration,
      segmentCount: result.segments?.length ?? 0,
    });

    return result;
  }

  private getMimeType(format: string): string {
    const mimeTypes: Record<string, string> = {
      mp3: 'audio/mpeg',
      mp4: 'audio/mp4',
      mpeg: 'audio/mpeg',
      mpga: 'audio/mpeg',
      m4a: 'audio/mp4',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      webm: 'audio/webm',
      flac: 'audio/flac',
    };

    return mimeTypes[format] ?? 'audio/wav';
  }
}
