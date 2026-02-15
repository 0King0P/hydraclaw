import { randomUUID } from 'node:crypto';
import { createLogger } from '@hydraclaw/core';
import type { TTSProvider, TTSVoice, TTSOptions, TTSResult } from './types.js';

const logger = createLogger('tts:edge');

const EDGE_TTS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const VOICE_LIST_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list';
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

interface EdgeVoiceInfo {
  Name: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  FriendlyName: string;
  Status: string;
  SuggestedCodec: string;
}

export interface EdgeTTSConfig {
  defaultVoice?: string;
  defaultFormat?: 'mp3' | 'opus' | 'wav';
}

export class EdgeTTSProvider implements TTSProvider {
  readonly id = 'edge-tts';
  readonly name = 'Microsoft Edge Text-to-Speech';

  private cachedVoices: TTSVoice[] | null = null;
  private defaultVoice: string;
  private defaultFormat: string;

  constructor(config: EdgeTTSConfig = {}) {
    this.defaultVoice = config.defaultVoice ?? 'en-US-AriaNeural';
    this.defaultFormat = config.defaultFormat ?? 'mp3';

    logger.debug('Edge TTS provider initialized', {
      defaultVoice: this.defaultVoice,
    });
  }

  voices(): TTSVoice[] {
    if (this.cachedVoices) {
      return [...this.cachedVoices];
    }

    // Return a curated set of commonly used voices synchronously
    // Full voice list can be fetched with fetchVoiceList()
    const defaultVoices: TTSVoice[] = [
      { id: 'en-US-AriaNeural', name: 'Aria', language: 'en-US', gender: 'female' },
      { id: 'en-US-GuyNeural', name: 'Guy', language: 'en-US', gender: 'male' },
      { id: 'en-US-JennyNeural', name: 'Jenny', language: 'en-US', gender: 'female' },
      { id: 'en-US-DavisNeural', name: 'Davis', language: 'en-US', gender: 'male' },
      { id: 'en-GB-SoniaNeural', name: 'Sonia', language: 'en-GB', gender: 'female' },
      { id: 'en-GB-RyanNeural', name: 'Ryan', language: 'en-GB', gender: 'male' },
      { id: 'en-AU-NatashaNeural', name: 'Natasha', language: 'en-AU', gender: 'female' },
      { id: 'en-AU-WilliamNeural', name: 'William', language: 'en-AU', gender: 'male' },
      { id: 'de-DE-KatjaNeural', name: 'Katja', language: 'de-DE', gender: 'female' },
      { id: 'de-DE-ConradNeural', name: 'Conrad', language: 'de-DE', gender: 'male' },
      { id: 'fr-FR-DeniseNeural', name: 'Denise', language: 'fr-FR', gender: 'female' },
      { id: 'fr-FR-HenriNeural', name: 'Henri', language: 'fr-FR', gender: 'male' },
      { id: 'es-ES-ElviraNeural', name: 'Elvira', language: 'es-ES', gender: 'female' },
      { id: 'es-ES-AlvaroNeural', name: 'Alvaro', language: 'es-ES', gender: 'male' },
      { id: 'ja-JP-NanamiNeural', name: 'Nanami', language: 'ja-JP', gender: 'female' },
      { id: 'ja-JP-KeitaNeural', name: 'Keita', language: 'ja-JP', gender: 'male' },
      { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao', language: 'zh-CN', gender: 'female' },
      { id: 'zh-CN-YunxiNeural', name: 'Yunxi', language: 'zh-CN', gender: 'male' },
      { id: 'ko-KR-SunHiNeural', name: 'Sun-Hi', language: 'ko-KR', gender: 'female' },
      { id: 'ko-KR-InJoonNeural', name: 'InJoon', language: 'ko-KR', gender: 'male' },
      { id: 'pt-BR-FranciscaNeural', name: 'Francisca', language: 'pt-BR', gender: 'female' },
      { id: 'pt-BR-AntonioNeural', name: 'Antonio', language: 'pt-BR', gender: 'male' },
      { id: 'it-IT-ElsaNeural', name: 'Elsa', language: 'it-IT', gender: 'female' },
      { id: 'it-IT-DiegoNeural', name: 'Diego', language: 'it-IT', gender: 'male' },
      { id: 'ru-RU-SvetlanaNeural', name: 'Svetlana', language: 'ru-RU', gender: 'female' },
      { id: 'ru-RU-DmitryNeural', name: 'Dmitry', language: 'ru-RU', gender: 'male' },
      { id: 'hi-IN-SwaraNeural', name: 'Swara', language: 'hi-IN', gender: 'female' },
      { id: 'hi-IN-MadhurNeural', name: 'Madhur', language: 'hi-IN', gender: 'male' },
      { id: 'ar-SA-ZariyahNeural', name: 'Zariyah', language: 'ar-SA', gender: 'female' },
      { id: 'ar-SA-HamedNeural', name: 'Hamed', language: 'ar-SA', gender: 'male' },
    ];

    return defaultVoices;
  }

  /**
   * Fetches the complete voice list from the Edge TTS service.
   * Results are cached for subsequent calls to voices().
   */
  async fetchVoiceList(): Promise<TTSVoice[]> {
    logger.debug('Fetching voice list from Edge TTS service');

    const url = `${VOICE_LIST_URL}?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch voice list: ${response.status} ${response.statusText}`);
    }

    const voiceData: EdgeVoiceInfo[] = await response.json();

    this.cachedVoices = voiceData.map((v) => ({
      id: v.ShortName,
      name: v.FriendlyName.replace(/^Microsoft\s+/, '').replace(/\s+Online.*$/, ''),
      language: v.Locale,
      gender: v.Gender.toLowerCase() === 'male' ? 'male' as const : 'female' as const,
    }));

    logger.debug('Voice list fetched', { count: this.cachedVoices.length });
    return [...this.cachedVoices];
  }

  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text must not be empty');
    }

    const voice = options?.voice ?? this.defaultVoice;
    const format = options?.format ?? this.defaultFormat;
    const speed = options?.speed ?? 1.0;

    logger.debug('Synthesizing with Edge TTS', { voice, format, speed, textLength: text.length });

    const ssml = this.buildSSML(text, voice, speed);
    const audio = await this.synthesizeViaWebSocket(ssml, format);

    logger.debug('Edge TTS synthesis complete', { audioSize: audio.length, format });

    return {
      audio,
      format,
      sampleRate: options?.sampleRate,
    };
  }

  /**
   * Synthesize speech from SSML markup directly.
   */
  async synthesizeSSML(ssml: string, options?: TTSOptions): Promise<TTSResult> {
    if (!ssml || ssml.trim().length === 0) {
      throw new Error('SSML must not be empty');
    }

    const format = options?.format ?? this.defaultFormat;

    logger.debug('Synthesizing SSML with Edge TTS', { format, ssmlLength: ssml.length });

    const audio = await this.synthesizeViaWebSocket(ssml, format);

    return {
      audio,
      format,
      sampleRate: options?.sampleRate,
    };
  }

  private buildSSML(text: string, voice: string, speed: number): string {
    const rate = speed === 1.0 ? '+0%' : `${speed > 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%`;
    const escapedText = this.escapeXml(text);

    return (
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">' +
      `<voice name="${voice}">` +
      `<prosody rate="${rate}">` +
      escapedText +
      '</prosody>' +
      '</voice>' +
      '</speak>'
    );
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private getOutputFormat(format: string): string {
    const formatMap: Record<string, string> = {
      mp3: 'audio-24khz-96kbitrate-mono-mp3',
      opus: 'audio-24khz-96kbitrate-mono-opus',
      wav: 'riff-24khz-16bit-mono-pcm',
    };

    return formatMap[format] ?? formatMap.mp3;
  }

  private async synthesizeViaWebSocket(ssml: string, format: string): Promise<Buffer> {
    const requestId = randomUUID().replace(/-/g, '');
    const outputFormat = this.getOutputFormat(format);
    const wsUrl = `${EDGE_TTS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${requestId}`;

    return new Promise<Buffer>((resolve, reject) => {
      const audioChunks: Buffer[] = [];
      let ws: WebSocket;

      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        reject(new Error(`Failed to connect to Edge TTS WebSocket: ${err}`));
        return;
      }

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Edge TTS synthesis timed out'));
      }, 30_000);

      ws.addEventListener('open', () => {
        // Send configuration message
        const configMessage =
          `Content-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                  outputFormat,
                },
              },
            },
          });

        ws.send(configMessage);

        // Send SSML message
        const ssmlMessage =
          `X-RequestId:${requestId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `Path:ssml\r\n\r\n` +
          ssml;

        ws.send(ssmlMessage);
      });

      ws.addEventListener('message', (event) => {
        const data = event.data;

        if (typeof data === 'string') {
          // Text message - check for turn end
          if (data.includes('Path:turn.end')) {
            clearTimeout(timeout);
            ws.close();
            resolve(Buffer.concat(audioChunks));
          }
        } else if (data instanceof ArrayBuffer || data instanceof Blob) {
          // Binary message - extract audio data
          this.extractAudioFromBinary(data)
            .then((audioData) => {
              if (audioData) {
                audioChunks.push(audioData);
              }
            })
            .catch((err) => {
              logger.warn('Failed to extract audio data from binary message', { error: err });
            });
        }
      });

      ws.addEventListener('error', (event) => {
        clearTimeout(timeout);
        reject(new Error(`Edge TTS WebSocket error: ${event}`));
      });

      ws.addEventListener('close', (event) => {
        clearTimeout(timeout);
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else if (event.code !== 1000) {
          reject(new Error(`Edge TTS WebSocket closed unexpectedly: code=${event.code}`));
        }
      });
    });
  }

  private async extractAudioFromBinary(data: ArrayBuffer | Blob): Promise<Buffer | null> {
    let buffer: Buffer;

    if (data instanceof Blob) {
      const arrayBuffer = await data.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      buffer = Buffer.from(data);
    }

    // Edge TTS binary messages have a header separated by "Path:audio\r\n"
    const headerEnd = buffer.indexOf('Path:audio\r\n');
    if (headerEnd === -1) {
      return null;
    }

    // Find the end of the header (double CRLF)
    const audioStart = buffer.indexOf('\r\n', headerEnd + 12) + 2;
    if (audioStart <= 1) {
      return null;
    }

    return buffer.subarray(audioStart);
  }
}
