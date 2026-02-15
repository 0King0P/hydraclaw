import type { MediaInput, MediaAnalysis, MediaProcessor, MediaType } from '../types.js';

export interface ImageProcessorConfig {
  /**
   * Function that describes an image using a vision-capable AI model.
   * Accepts a base64-encoded image and MIME type, returns a description.
   */
  describeImage: (base64Data: string, mimeType: string, prompt: string) => Promise<string>;
  maxImageSize?: number;
  defaultPrompt?: string;
}

const DEFAULT_MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const DEFAULT_PROMPT = 'Describe this image in detail. If there is any text visible, transcribe it exactly.';

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
]);

/**
 * Image processor that uses vision-capable AI models to analyze images.
 * Supports description generation and text extraction (OCR-like) via vision models.
 * Extracts basic metadata such as format and size.
 */
export class ImageProcessor implements MediaProcessor {
  private config: ImageProcessorConfig;
  private maxImageSize: number;
  private defaultPrompt: string;

  constructor(config: ImageProcessorConfig) {
    this.config = config;
    this.maxImageSize = config.maxImageSize ?? DEFAULT_MAX_IMAGE_SIZE;
    this.defaultPrompt = config.defaultPrompt ?? DEFAULT_PROMPT;
  }

  /**
   * Check if this processor supports the given media type and MIME type.
   */
  supports(type: MediaType, mimeType: string): boolean {
    return type === 'image' && SUPPORTED_MIME_TYPES.has(mimeType);
  }

  /**
   * Process an image input: describe it, extract text, and gather metadata.
   */
  async process(input: MediaInput): Promise<MediaAnalysis> {
    const imageData = await this.getImageData(input);
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
    const dataSize = imageData.length;
    if (dataSize > this.maxImageSize) {
      return {
        type: 'image',
        description: `Image too large to process (${this.formatSize(dataSize)}, max ${this.formatSize(this.maxImageSize)})`,
        metadata: { ...metadata, tooLarge: true },
      };
    }

    // Get image format info from MIME type
    const format = input.mimeType.split('/')[1] ?? 'unknown';
    metadata.format = format;

    // Use vision model to describe the image
    const base64 = imageData.toString('base64');

    try {
      const description = await this.config.describeImage(
        base64,
        input.mimeType,
        this.defaultPrompt
      );

      // Attempt to extract text content from the description
      const extractedText = this.extractTextFromDescription(description);

      return {
        type: 'image',
        description,
        text: extractedText || undefined,
        metadata,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: 'image',
        description: `Image analysis failed: ${message}`,
        metadata: { ...metadata, analysisError: message },
      };
    }
  }

  /**
   * Get image data as a Buffer from either inline data or URL.
   */
  private async getImageData(input: MediaInput): Promise<Buffer> {
    if (input.data) {
      return input.data;
    }

    if (input.url) {
      const response = await fetch(input.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image from ${input.url}: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    throw new Error('Image input must have either data or url');
  }

  /**
   * Try to extract transcribed text from the vision model's description.
   * Looks for common patterns that indicate the model found text in the image.
   */
  private extractTextFromDescription(description: string): string | null {
    // Common patterns vision models use when reporting text
    const textPatterns = [
      /(?:text (?:reads?|says?|states?|shows?)|reads?|says?)\s*[:\-"]?\s*"?([^"]+)"?/i,
      /(?:written|displayed|printed|typed)\s*(?:on|in)?\s*[:\-"]?\s*"?([^"]+)"?/i,
      /(?:the (?:text|words?|title|heading|label|sign|caption))\s*(?:is|are)?\s*[:\-"]?\s*"([^"]+)"/i,
    ];

    for (const pattern of textPatterns) {
      const match = description.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return null;
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
