import type { Logger } from '@hydraclaw/core';
import type { MediaInput, MediaAnalysis, MediaProcessor, MediaType } from './types.js';

export interface MediaPipelineConfig {
  maxConcurrent?: number;
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<MediaPipelineConfig> = {
  maxConcurrent: 5,
  timeoutMs: 60000,
};

/**
 * Media processing pipeline that routes media inputs to appropriate processors.
 * Supports registration of multiple processors and handles routing, concurrency,
 * and error handling for media analysis.
 */
export class MediaPipeline {
  private processors: MediaProcessor[] = [];
  private logger: Logger;
  private config: Required<MediaPipelineConfig>;

  constructor(logger: Logger, config?: MediaPipelineConfig) {
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a media processor with the pipeline.
   * Processors are checked in registration order when routing media.
   */
  addProcessor(processor: MediaProcessor): void {
    this.processors.push(processor);
    this.logger.debug(`Registered media processor (${this.processors.length} total)`);
  }

  /**
   * Process a single media input by routing it to the first matching processor.
   */
  async process(input: MediaInput): Promise<MediaAnalysis> {
    const processor = this.findProcessor(input.type, input.mimeType);

    if (!processor) {
      this.logger.warn(`No processor found for type=${input.type} mimeType=${input.mimeType}`);
      return this.createUnsupportedAnalysis(input);
    }

    this.logger.debug(`Processing ${input.type} media: ${input.filename ?? input.url ?? 'inline'}`);

    try {
      const result = await this.withTimeout(
        processor.process(input),
        this.config.timeoutMs
      );
      this.logger.debug(`Processed ${input.type} media successfully`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to process ${input.type} media: ${message}`);
      return this.createErrorAnalysis(input, message);
    }
  }

  /**
   * Process multiple media inputs concurrently with a configurable concurrency limit.
   */
  async processAll(inputs: MediaInput[]): Promise<MediaAnalysis[]> {
    if (inputs.length === 0) return [];

    const results: MediaAnalysis[] = new Array(inputs.length);
    const executing: Set<Promise<void>> = new Set();

    for (let i = 0; i < inputs.length; i++) {
      const index = i;
      const promise = (async () => {
        results[index] = await this.process(inputs[index]);
      })();

      executing.add(promise);
      const cleanup = promise.then(() => executing.delete(promise));
      void cleanup;

      if (executing.size >= this.config.maxConcurrent) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Convert an array of media analyses into a context string suitable
   * for injection into an AI prompt.
   */
  toContext(analyses: MediaAnalysis[]): string {
    if (analyses.length === 0) return '';

    const parts: string[] = [];

    for (let i = 0; i < analyses.length; i++) {
      const analysis = analyses[i];
      const lines: string[] = [];

      lines.push(`[Media ${i + 1}: ${analysis.type}]`);
      lines.push(`Description: ${analysis.description}`);

      if (analysis.text) {
        lines.push(`Extracted text: ${analysis.text}`);
      }

      if (analysis.transcription) {
        lines.push(`Transcription: ${analysis.transcription}`);
      }

      if (analysis.summary) {
        lines.push(`Summary: ${analysis.summary}`);
      }

      const relevantMetadata = Object.entries(analysis.metadata)
        .filter(([key]) => !['raw', 'binary', 'buffer'].includes(key))
        .map(([key, value]) => `${key}: ${String(value)}`);

      if (relevantMetadata.length > 0) {
        lines.push(`Metadata: ${relevantMetadata.join(', ')}`);
      }

      parts.push(lines.join('\n'));
    }

    return parts.join('\n\n');
  }

  /**
   * Find the first processor that supports the given media type and MIME type.
   */
  private findProcessor(type: MediaType, mimeType: string): MediaProcessor | null {
    for (const processor of this.processors) {
      if (processor.supports(type, mimeType)) {
        return processor;
      }
    }
    return null;
  }

  /**
   * Wrap a promise with a timeout.
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Media processing timed out after ${timeoutMs}ms`)),
        timeoutMs
      );

      promise
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Create an analysis result for unsupported media types.
   */
  private createUnsupportedAnalysis(input: MediaInput): MediaAnalysis {
    return {
      type: input.type,
      description: `Unsupported media type: ${input.type} (${input.mimeType})`,
      metadata: {
        unsupported: true,
        mimeType: input.mimeType,
        filename: input.filename,
      },
    };
  }

  /**
   * Create an analysis result for processing errors.
   */
  private createErrorAnalysis(input: MediaInput, error: string): MediaAnalysis {
    return {
      type: input.type,
      description: `Failed to process ${input.type} media: ${error}`,
      metadata: {
        error: true,
        errorMessage: error,
        mimeType: input.mimeType,
        filename: input.filename,
      },
    };
  }
}
