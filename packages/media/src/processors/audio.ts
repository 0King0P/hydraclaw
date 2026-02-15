import type { MediaInput, MediaAnalysis, MediaProcessor, MediaType } from '../types.js';

export interface AudioProcessorConfig {
  /**
   * Function that transcribes audio data.
   * Accepts audio as a Buffer and MIME type, returns transcription text.
   */
  transcribe: (audioData: Buffer, mimeType: string) => Promise<AudioTranscription>;
  maxAudioSize?: number;
}

export interface AudioTranscription {
  text: string;
  language?: string;
  duration?: number;
  segments?: AudioSegment[];
}

export interface AudioSegment {
  start: number;
  end: number;
  text: string;
}

const DEFAULT_MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB

const SUPPORTED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'audio/x-flac',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/webm',
  'audio/aac',
]);

/**
 * Audio processor that transcribes audio content using speech-to-text services
 * (e.g., OpenAI Whisper API or compatible). Extracts transcription, language,
 * and duration information.
 */
export class AudioProcessor implements MediaProcessor {
  private config: AudioProcessorConfig;
  private maxAudioSize: number;

  constructor(config: AudioProcessorConfig) {
    this.config = config;
    this.maxAudioSize = config.maxAudioSize ?? DEFAULT_MAX_AUDIO_SIZE;
  }

  /**
   * Check if this processor supports the given media type and MIME type.
   */
  supports(type: MediaType, mimeType: string): boolean {
    return type === 'audio' && SUPPORTED_MIME_TYPES.has(mimeType);
  }

  /**
   * Process audio input: transcribe and extract metadata.
   */
  async process(input: MediaInput): Promise<MediaAnalysis> {
    const audioData = await this.getAudioData(input);
    const metadata: Record<string, unknown> = {
      mimeType: input.mimeType,
      filename: input.filename,
    };

    if (input.size !== undefined) {
      metadata.size = input.size;
      metadata.sizeFormatted = this.formatSize(input.size);
    }

    if (input.url) {
      metadata.sourceUrl = input.url;
    }

    // Validate size
    const dataSize = audioData.length;
    metadata.dataSize = dataSize;

    if (dataSize > this.maxAudioSize) {
      return {
        type: 'audio',
        description: `Audio file too large to process (${this.formatSize(dataSize)}, max ${this.formatSize(this.maxAudioSize)})`,
        metadata: { ...metadata, tooLarge: true },
      };
    }

    // Extract format from MIME type
    const format = this.getFormatFromMimeType(input.mimeType);
    metadata.format = format;

    try {
      const transcription = await this.config.transcribe(audioData, input.mimeType);

      if (transcription.language) {
        metadata.language = transcription.language;
      }

      if (transcription.duration !== undefined) {
        metadata.duration = transcription.duration;
        metadata.durationFormatted = this.formatDuration(transcription.duration);
      }

      if (transcription.segments && transcription.segments.length > 0) {
        metadata.segmentCount = transcription.segments.length;
      }

      const description = this.buildDescription(transcription, metadata);

      return {
        type: 'audio',
        description,
        transcription: transcription.text,
        text: transcription.text,
        metadata,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: 'audio',
        description: `Audio transcription failed: ${message}`,
        metadata: { ...metadata, transcriptionError: message },
      };
    }
  }

  /**
   * Get audio data as a Buffer from either inline data or URL.
   */
  private async getAudioData(input: MediaInput): Promise<Buffer> {
    if (input.data) {
      return input.data;
    }

    if (input.url) {
      const response = await fetch(input.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio from ${input.url}: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    throw new Error('Audio input must have either data or url');
  }

  /**
   * Build a human-readable description of the audio analysis.
   */
  private buildDescription(
    transcription: AudioTranscription,
    metadata: Record<string, unknown>
  ): string {
    const parts: string[] = [];

    parts.push('Audio recording');

    if (metadata.durationFormatted) {
      parts.push(`(${metadata.durationFormatted})`);
    }

    if (transcription.language) {
      parts.push(`in ${transcription.language}`);
    }

    const header = parts.join(' ');
    const preview = transcription.text.length > 200
      ? transcription.text.slice(0, 200) + '...'
      : transcription.text;

    return `${header}. Transcription: "${preview}"`;
  }

  /**
   * Get a friendly format name from a MIME type.
   */
  private getFormatFromMimeType(mimeType: string): string {
    const formatMap: Record<string, string> = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/x-wav': 'wav',
      'audio/ogg': 'ogg',
      'audio/flac': 'flac',
      'audio/x-flac': 'flac',
      'audio/mp4': 'm4a',
      'audio/m4a': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/webm': 'webm',
      'audio/aac': 'aac',
    };
    return formatMap[mimeType] ?? mimeType.split('/')[1] ?? 'unknown';
  }

  /**
   * Format a duration in seconds as a human-readable string.
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Format a byte size as a human-readable string.
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
}
