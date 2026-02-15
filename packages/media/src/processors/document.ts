import type { MediaInput, MediaAnalysis, MediaProcessor, MediaType } from '../types.js';

export interface DocumentProcessorConfig {
  maxTextLength?: number;
  maxFileSize?: number;
}

const DEFAULT_MAX_TEXT_LENGTH = 50000;
const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const SUPPORTED_MIME_TYPES = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['text/plain', 'txt'],
  ['text/markdown', 'md'],
  ['text/html', 'html'],
  ['application/json', 'json'],
  ['text/csv', 'csv'],
  ['text/xml', 'xml'],
  ['application/xml', 'xml'],
  ['application/rtf', 'rtf'],
  ['text/rtf', 'rtf'],
]);

/**
 * Document processor that handles various text-based document formats.
 * Supports PDF (basic text extraction), plain text, Markdown, HTML, JSON, and CSV.
 * Applies file size limits and text truncation for large documents.
 */
export class DocumentProcessor implements MediaProcessor {
  private maxTextLength: number;
  private maxFileSize: number;

  constructor(config: DocumentProcessorConfig = {}) {
    this.maxTextLength = config.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
    this.maxFileSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  }

  /**
   * Check if this processor supports the given media type and MIME type.
   */
  supports(type: MediaType, mimeType: string): boolean {
    return type === 'document' && SUPPORTED_MIME_TYPES.has(mimeType);
  }

  /**
   * Process a document input: extract text and metadata.
   */
  async process(input: MediaInput): Promise<MediaAnalysis> {
    const data = await this.getDocumentData(input);
    const format = SUPPORTED_MIME_TYPES.get(input.mimeType) ?? 'unknown';

    const metadata: Record<string, unknown> = {
      mimeType: input.mimeType,
      format,
      filename: input.filename,
    };

    if (input.size !== undefined) {
      metadata.size = input.size;
      metadata.sizeFormatted = this.formatSize(input.size);
    }

    if (input.url) {
      metadata.sourceUrl = input.url;
    }

    // Check file size
    if (data.length > this.maxFileSize) {
      return {
        type: 'document',
        description: `Document too large to process (${this.formatSize(data.length)}, max ${this.formatSize(this.maxFileSize)})`,
        metadata: { ...metadata, tooLarge: true },
      };
    }

    try {
      let text: string;

      switch (format) {
        case 'pdf':
          text = this.extractPdfText(data);
          break;
        case 'html':
          text = this.extractHtmlText(data.toString('utf-8'));
          break;
        case 'md':
          text = this.extractMarkdownText(data.toString('utf-8'));
          break;
        case 'json':
          text = this.extractJsonText(data.toString('utf-8'));
          break;
        default:
          text = data.toString('utf-8');
          break;
      }

      // Truncate if necessary
      let truncated = false;
      if (text.length > this.maxTextLength) {
        text = text.slice(0, this.maxTextLength);
        truncated = true;
        metadata.truncated = true;
        metadata.originalLength = text.length;
      }

      metadata.extractedLength = text.length;

      const summary = this.generateSummary(text, format);
      const description = this.buildDescription(format, text.length, truncated, input.filename);

      return {
        type: 'document',
        description,
        text,
        summary,
        metadata,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: 'document',
        description: `Document processing failed: ${message}`,
        metadata: { ...metadata, processingError: message },
      };
    }
  }

  /**
   * Get document data as a Buffer from either inline data or URL.
   */
  private async getDocumentData(input: MediaInput): Promise<Buffer> {
    if (input.data) {
      return input.data;
    }

    if (input.url) {
      const response = await fetch(input.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch document from ${input.url}: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    throw new Error('Document input must have either data or url');
  }

  /**
   * Extract text from a PDF buffer using a basic approach.
   * This extracts text streams from the PDF structure without requiring
   * a full PDF parsing library. For complex PDFs, a dedicated library
   * should be used instead.
   */
  private extractPdfText(data: Buffer): string {
    const content = data.toString('latin1');
    const textParts: string[] = [];

    // Look for text between BT (begin text) and ET (end text) operators
    const btEtPattern = /BT\s*([\s\S]*?)\s*ET/g;
    let match: RegExpExecArray | null;

    while ((match = btEtPattern.exec(content)) !== null) {
      const textBlock = match[1];

      // Extract text from Tj (show text) and TJ (show text array) operators
      const tjPattern = /\(([^)]*)\)\s*Tj/g;
      let tjMatch: RegExpExecArray | null;
      while ((tjMatch = tjPattern.exec(textBlock)) !== null) {
        const decoded = this.decodePdfString(tjMatch[1]);
        if (decoded.trim()) {
          textParts.push(decoded);
        }
      }

      // Extract from TJ arrays
      const tjArrayPattern = /\[(.*?)\]\s*TJ/g;
      let tjArrayMatch: RegExpExecArray | null;
      while ((tjArrayMatch = tjArrayPattern.exec(textBlock)) !== null) {
        const arrayContent = tjArrayMatch[1];
        const stringPattern = /\(([^)]*)\)/g;
        let stringMatch: RegExpExecArray | null;
        const parts: string[] = [];
        while ((stringMatch = stringPattern.exec(arrayContent)) !== null) {
          parts.push(this.decodePdfString(stringMatch[1]));
        }
        const combined = parts.join('');
        if (combined.trim()) {
          textParts.push(combined);
        }
      }
    }

    if (textParts.length === 0) {
      return '[PDF text extraction yielded no results. The document may contain scanned images or use unsupported encoding.]';
    }

    return textParts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Decode a PDF string, handling basic escape sequences.
   */
  private decodePdfString(str: string): string {
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/\\([()])/g, '$1');
  }

  /**
   * Extract text from HTML by stripping tags and normalizing whitespace.
   */
  private extractHtmlText(html: string): string {
    // Remove script and style elements
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Replace block elements with newlines
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Strip remaining tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // Normalize whitespace
    text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();

    return text;
  }

  /**
   * Extract text from Markdown, preserving structure but removing formatting syntax.
   */
  private extractMarkdownText(markdown: string): string {
    let text = markdown;

    // Remove code blocks but keep content
    text = text.replace(/```[\s\S]*?```/g, match => {
      const content = match.replace(/```\w*\n?/, '').replace(/\n?```$/, '');
      return content;
    });

    // Remove inline code backticks
    text = text.replace(/`([^`]+)`/g, '$1');

    // Remove emphasis markers
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/__([^_]+)__/g, '$1');
    text = text.replace(/_([^_]+)_/g, '$1');

    // Remove link syntax, keep text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Remove image syntax
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

    // Remove header markers
    text = text.replace(/^#{1,6}\s+/gm, '');

    // Remove horizontal rules
    text = text.replace(/^[-*_]{3,}\s*$/gm, '');

    return text.trim();
  }

  /**
   * Extract a readable text representation from JSON.
   */
  private extractJsonText(json: string): string {
    try {
      const parsed = JSON.parse(json);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return json;
    }
  }

  /**
   * Generate a brief summary of the document content.
   */
  private generateSummary(text: string, format: string): string {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    const lineCount = lines.length;

    const parts: string[] = [
      `${format.toUpperCase()} document`,
      `${wordCount} words`,
      `${lineCount} lines`,
    ];

    // Take first meaningful line as a preview
    const firstLine = lines[0]?.trim();
    if (firstLine && firstLine.length > 0) {
      const preview = firstLine.length > 100
        ? firstLine.slice(0, 100) + '...'
        : firstLine;
      parts.push(`starts with: "${preview}"`);
    }

    return parts.join(', ');
  }

  /**
   * Build a human-readable description of the document.
   */
  private buildDescription(
    format: string,
    textLength: number,
    truncated: boolean,
    filename?: string
  ): string {
    const parts: string[] = [];
    parts.push(`${format.toUpperCase()} document`);

    if (filename) {
      parts.push(`"${filename}"`);
    }

    parts.push(`(${this.formatSize(textLength)} of text)`);

    if (truncated) {
      parts.push('[truncated]');
    }

    return parts.join(' ');
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
