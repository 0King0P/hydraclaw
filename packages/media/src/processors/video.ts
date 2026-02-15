import type { MediaInput, MediaAnalysis, MediaProcessor, MediaType } from '../types.js';

export interface VideoProcessorConfig {
  /**
   * Function that describes video frames using a vision-capable AI model.
   * Accepts an array of base64-encoded frame images, returns descriptions.
   */
  describeFrames?: (frames: Array<{ base64: string; timestamp: number }>, mimeType: string) => Promise<string[]>;
  /**
   * Function that transcribes the audio track of a video.
   * Accepts video/audio data as a Buffer, returns transcription text.
   */
  transcribeAudio?: (audioData: Buffer, mimeType: string) => Promise<string>;
  maxVideoSize?: number;
  maxFrames?: number;
}

const DEFAULT_MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
const DEFAULT_MAX_FRAMES = 10;

const SUPPORTED_MIME_TYPES = new Set([
  'video/mp4',
  'video/mpeg',
  'video/webm',
  'video/ogg',
  'video/avi',
  'video/x-msvideo',
  'video/quicktime',
  'video/x-matroska',
  'video/x-flv',
]);

/**
 * Video processor that analyzes video content through frame descriptions
 * and audio transcription. Frame extraction and description require
 * external vision model integration. Audio transcription requires a
 * speech-to-text service.
 */
export class VideoProcessor implements MediaProcessor {
  private config: VideoProcessorConfig;
  private maxVideoSize: number;
  private maxFrames: number;

  constructor(config: VideoProcessorConfig = {}) {
    this.config = config;
    this.maxVideoSize = config.maxVideoSize ?? DEFAULT_MAX_VIDEO_SIZE;
    this.maxFrames = config.maxFrames ?? DEFAULT_MAX_FRAMES;
  }

  /**
   * Check if this processor supports the given media type and MIME type.
   */
  supports(type: MediaType, mimeType: string): boolean {
    return type === 'video' && SUPPORTED_MIME_TYPES.has(mimeType);
  }

  /**
   * Process video input: extract frame descriptions and audio transcription.
   */
  async process(input: MediaInput): Promise<MediaAnalysis> {
    const videoData = await this.getVideoData(input);
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

    // Check size limit
    const dataSize = videoData.length;
    metadata.dataSize = dataSize;

    if (dataSize > this.maxVideoSize) {
      return {
        type: 'video',
        description: `Video too large to process (${this.formatSize(dataSize)}, max ${this.formatSize(this.maxVideoSize)})`,
        metadata: { ...metadata, tooLarge: true },
      };
    }

    // Extract format from MIME type
    const format = this.getFormatFromMimeType(input.mimeType);
    metadata.format = format;

    const descriptionParts: string[] = [];
    let transcription: string | undefined;

    // Attempt frame description if a vision function is provided
    if (this.config.describeFrames) {
      try {
        // Extract key frames from the video data
        const frames = this.extractKeyFramePositions(videoData);
        metadata.frameCount = frames.length;

        if (frames.length > 0) {
          const frameDescriptions = await this.config.describeFrames(frames, input.mimeType);
          for (let i = 0; i < frameDescriptions.length; i++) {
            descriptionParts.push(`Frame ${i + 1} (${this.formatTimestamp(frames[i].timestamp)}): ${frameDescriptions[i]}`);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        descriptionParts.push(`Frame analysis failed: ${message}`);
        metadata.frameAnalysisError = message;
      }
    } else {
      descriptionParts.push('Frame analysis not available (no vision model configured)');
    }

    // Attempt audio transcription if a transcription function is provided
    if (this.config.transcribeAudio) {
      try {
        transcription = await this.config.transcribeAudio(videoData, input.mimeType);
        metadata.hasTranscription = true;
        metadata.transcriptionLength = transcription.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        metadata.transcriptionError = message;
      }
    } else {
      metadata.transcriptionAvailable = false;
    }

    const description = this.buildDescription(format, descriptionParts, transcription, input.filename);

    return {
      type: 'video',
      description,
      transcription,
      text: transcription,
      metadata,
    };
  }

  /**
   * Get video data as a Buffer from either inline data or URL.
   */
  private async getVideoData(input: MediaInput): Promise<Buffer> {
    if (input.data) {
      return input.data;
    }

    if (input.url) {
      const response = await fetch(input.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch video from ${input.url}: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    throw new Error('Video input must have either data or url');
  }

  /**
   * Identify key frame positions in the video data.
   * This is a simplified approach that generates estimated timestamps
   * for sampling frames at regular intervals. A production implementation
   * would use FFmpeg or a similar tool to extract actual frames.
   */
  private extractKeyFramePositions(
    videoData: Buffer
  ): Array<{ base64: string; timestamp: number }> {
    // Estimate video duration from file size (rough heuristic)
    // Average video bitrate ~2Mbps = 250KB/s
    const estimatedDuration = videoData.length / (250 * 1024);
    const frameCount = Math.min(this.maxFrames, Math.max(1, Math.floor(estimatedDuration / 5)));

    const frames: Array<{ base64: string; timestamp: number }> = [];
    const interval = estimatedDuration / (frameCount + 1);

    for (let i = 0; i < frameCount; i++) {
      const timestamp = interval * (i + 1);
      // In a real implementation, this would extract the actual frame at this timestamp.
      // For now, we provide placeholder data indicating the position.
      frames.push({
        base64: '',
        timestamp,
      });
    }

    return frames;
  }

  /**
   * Build a human-readable description of the video analysis.
   */
  private buildDescription(
    format: string,
    frameParts: string[],
    transcription?: string,
    filename?: string
  ): string {
    const lines: string[] = [];

    const header = filename
      ? `${format.toUpperCase()} video "${filename}"`
      : `${format.toUpperCase()} video`;
    lines.push(header);

    if (frameParts.length > 0) {
      lines.push('');
      lines.push('Visual content:');
      lines.push(...frameParts.map(p => `  ${p}`));
    }

    if (transcription) {
      lines.push('');
      const preview = transcription.length > 300
        ? transcription.slice(0, 300) + '...'
        : transcription;
      lines.push(`Audio transcription: "${preview}"`);
    }

    return lines.join('\n');
  }

  /**
   * Get a friendly format name from a MIME type.
   */
  private getFormatFromMimeType(mimeType: string): string {
    const formatMap: Record<string, string> = {
      'video/mp4': 'mp4',
      'video/mpeg': 'mpeg',
      'video/webm': 'webm',
      'video/ogg': 'ogg',
      'video/avi': 'avi',
      'video/x-msvideo': 'avi',
      'video/quicktime': 'mov',
      'video/x-matroska': 'mkv',
      'video/x-flv': 'flv',
    };
    return formatMap[mimeType] ?? mimeType.split('/')[1] ?? 'unknown';
  }

  /**
   * Format a timestamp in seconds as MM:SS or HH:MM:SS.
   */
  private formatTimestamp(seconds: number): string {
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
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }
}
