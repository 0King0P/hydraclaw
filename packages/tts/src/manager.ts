import { createLogger } from '@hydraclaw/core';
import type { TTSProvider, TTSVoice, TTSOptions, TTSResult, STTProvider, STTOptions, STTResult } from './types.js';

const logger = createLogger('tts:manager');

export interface VoiceManagerConfig {
  defaultProvider?: string;
  defaultVoice?: string;
}

export class VoiceManager {
  private ttsProviders = new Map<string, TTSProvider>();
  private sttProviders = new Map<string, STTProvider>();
  private activeProviderId: string | null = null;
  private activeSTTProviderId: string | null = null;
  private defaultVoiceId: string | null = null;

  constructor(config: VoiceManagerConfig = {}) {
    if (config.defaultProvider) {
      this.activeProviderId = config.defaultProvider;
    }
    if (config.defaultVoice) {
      this.defaultVoiceId = config.defaultVoice;
    }

    logger.debug('VoiceManager initialized', {
      defaultProvider: config.defaultProvider,
      defaultVoice: config.defaultVoice,
    });
  }

  /**
   * Register a TTS provider.
   */
  registerTTSProvider(provider: TTSProvider): void {
    this.ttsProviders.set(provider.id, provider);

    if (!this.activeProviderId) {
      this.activeProviderId = provider.id;
    }

    logger.debug('TTS provider registered', { id: provider.id, name: provider.name });
  }

  /**
   * Register an STT provider.
   */
  registerSTTProvider(provider: STTProvider): void {
    this.sttProviders.set(provider.id, provider);

    if (!this.activeSTTProviderId) {
      this.activeSTTProviderId = provider.id;
    }

    logger.debug('STT provider registered', { id: provider.id, name: provider.name });
  }

  /**
   * Convert text to speech using the active TTS provider.
   */
  async speak(text: string, options?: TTSOptions): Promise<TTSResult> {
    const provider = this.getActiveProvider();

    const effectiveOptions: TTSOptions = {
      ...options,
      voice: options?.voice ?? this.defaultVoiceId ?? undefined,
    };

    logger.debug('Speaking text', {
      provider: provider.id,
      textLength: text.length,
      voice: effectiveOptions.voice,
    });

    return provider.synthesize(text, effectiveOptions);
  }

  /**
   * Convert speech to text using the active STT provider.
   */
  async listen(audio: Buffer, options?: STTOptions): Promise<STTResult> {
    const provider = this.getActiveSTTProvider();

    logger.debug('Listening to audio', {
      provider: provider.id,
      audioSize: audio.length,
      language: options?.language,
    });

    return provider.transcribe(audio, options);
  }

  /**
   * List all available voices across all registered TTS providers.
   */
  getVoices(): Array<TTSVoice & { providerId: string }> {
    const allVoices: Array<TTSVoice & { providerId: string }> = [];

    for (const [providerId, provider] of this.ttsProviders) {
      const voices = provider.voices();
      for (const voice of voices) {
        allVoices.push({ ...voice, providerId });
      }
    }

    return allVoices;
  }

  /**
   * List voices for a specific TTS provider.
   */
  getProviderVoices(providerId: string): TTSVoice[] {
    const provider = this.ttsProviders.get(providerId);
    if (!provider) {
      throw new Error(`TTS provider "${providerId}" not found`);
    }

    return provider.voices();
  }

  /**
   * Set the default voice for text-to-speech synthesis.
   */
  setDefaultVoice(voiceId: string): void {
    this.defaultVoiceId = voiceId;
    logger.debug('Default voice set', { voiceId });
  }

  /**
   * Get the currently configured default voice ID.
   */
  getDefaultVoice(): string | null {
    return this.defaultVoiceId;
  }

  /**
   * Switch the active TTS provider.
   */
  setProvider(providerId: string): void {
    if (!this.ttsProviders.has(providerId)) {
      throw new Error(
        `TTS provider "${providerId}" not found. Available: ${[...this.ttsProviders.keys()].join(', ')}`
      );
    }

    this.activeProviderId = providerId;
    logger.debug('Active TTS provider set', { providerId });
  }

  /**
   * Switch the active STT provider.
   */
  setSTTProvider(providerId: string): void {
    if (!this.sttProviders.has(providerId)) {
      throw new Error(
        `STT provider "${providerId}" not found. Available: ${[...this.sttProviders.keys()].join(', ')}`
      );
    }

    this.activeSTTProviderId = providerId;
    logger.debug('Active STT provider set', { providerId });
  }

  /**
   * Get the ID of the currently active TTS provider.
   */
  getActiveProviderId(): string | null {
    return this.activeProviderId;
  }

  /**
   * Get the ID of the currently active STT provider.
   */
  getActiveSTTProviderId(): string | null {
    return this.activeSTTProviderId;
  }

  /**
   * List all registered TTS provider IDs.
   */
  getTTSProviderIds(): string[] {
    return [...this.ttsProviders.keys()];
  }

  /**
   * List all registered STT provider IDs.
   */
  getSTTProviderIds(): string[] {
    return [...this.sttProviders.keys()];
  }

  private getActiveProvider(): TTSProvider {
    if (!this.activeProviderId) {
      throw new Error('No TTS provider registered. Register a provider first.');
    }

    const provider = this.ttsProviders.get(this.activeProviderId);
    if (!provider) {
      throw new Error(`Active TTS provider "${this.activeProviderId}" not found`);
    }

    return provider;
  }

  private getActiveSTTProvider(): STTProvider {
    if (!this.activeSTTProviderId) {
      throw new Error('No STT provider registered. Register a provider first.');
    }

    const provider = this.sttProviders.get(this.activeSTTProviderId);
    if (!provider) {
      throw new Error(`Active STT provider "${this.activeSTTProviderId}" not found`);
    }

    return provider;
  }
}
