import type { MediaInput, MediaAnalysis, MediaProcessor, MediaType } from '../types.js';

export interface LinkProcessorConfig {
  fetchTimeoutMs?: number;
  maxContentLength?: number;
  userAgent?: string;
  blockedDomains?: string[];
  allowedDomains?: string[];
}

const DEFAULT_FETCH_TIMEOUT = 15000;
const DEFAULT_MAX_CONTENT_LENGTH = 100000;
const DEFAULT_USER_AGENT = 'HydraClaw/1.0 MediaPipeline';

const LINK_MIME_TYPES = new Set([
  'text/html',
  'text/uri-list',
  'application/x-url',
]);

/**
 * Link processor that fetches and analyzes web URLs.
 * Extracts page title, description, and text content from web pages.
 * Supports domain filtering, content length limits, and timeouts.
 */
export class LinkProcessor implements MediaProcessor {
  private fetchTimeout: number;
  private maxContentLength: number;
  private userAgent: string;
  private blockedDomains: Set<string>;
  private allowedDomains: Set<string> | null;

  constructor(config: LinkProcessorConfig = {}) {
    this.fetchTimeout = config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT;
    this.maxContentLength = config.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    this.blockedDomains = new Set(config.blockedDomains ?? []);
    this.allowedDomains = config.allowedDomains ? new Set(config.allowedDomains) : null;
  }

  /**
   * Check if this processor supports the given media type and MIME type.
   */
  supports(type: MediaType, mimeType: string): boolean {
    return type === 'link' || LINK_MIME_TYPES.has(mimeType);
  }

  /**
   * Process a link input: fetch the URL and extract content.
   */
  async process(input: MediaInput): Promise<MediaAnalysis> {
    const url = input.url ?? input.data?.toString('utf-8');

    if (!url) {
      return {
        type: 'link',
        description: 'No URL provided for link processing',
        metadata: { error: true },
      };
    }

    const metadata: Record<string, unknown> = {
      url,
      filename: input.filename,
    };

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        type: 'link',
        description: `Invalid URL: ${url}`,
        metadata: { ...metadata, error: true, invalidUrl: true },
      };
    }

    // Domain filtering
    const domain = parsedUrl.hostname;
    metadata.domain = domain;

    if (this.blockedDomains.has(domain)) {
      return {
        type: 'link',
        description: `Domain blocked: ${domain}`,
        metadata: { ...metadata, blocked: true },
      };
    }

    if (this.allowedDomains && !this.allowedDomains.has(domain)) {
      return {
        type: 'link',
        description: `Domain not in allow list: ${domain}`,
        metadata: { ...metadata, notAllowed: true },
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.fetchTimeout);

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html, application/xhtml+xml, text/plain, */*',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      metadata.statusCode = response.status;
      metadata.contentType = response.headers.get('content-type') ?? 'unknown';

      if (!response.ok) {
        return {
          type: 'link',
          description: `Failed to fetch URL: ${response.status} ${response.statusText}`,
          metadata: { ...metadata, fetchError: true },
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const isHtml = contentType.includes('text/html') || contentType.includes('xhtml');

      let rawContent = await response.text();

      // Truncate if needed
      if (rawContent.length > this.maxContentLength) {
        rawContent = rawContent.slice(0, this.maxContentLength);
        metadata.truncated = true;
      }

      let title: string | undefined;
      let description: string | undefined;
      let text: string;

      if (isHtml) {
        title = this.extractTitle(rawContent);
        description = this.extractMetaDescription(rawContent);
        text = this.htmlToText(rawContent);

        metadata.title = title;
        metadata.metaDescription = description;
      } else {
        text = rawContent;
      }

      metadata.textLength = text.length;

      const preview = this.generateLinkPreview(url, title, description, text);

      return {
        type: 'link',
        description: preview,
        text,
        summary: description ?? (text.length > 300 ? text.slice(0, 300) + '...' : text),
        metadata,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = message.includes('abort');

      return {
        type: 'link',
        description: isTimeout
          ? `URL fetch timed out after ${this.fetchTimeout}ms: ${url}`
          : `Failed to fetch URL: ${message}`,
        metadata: {
          ...metadata,
          fetchError: true,
          errorMessage: message,
          timeout: isTimeout,
        },
      };
    }
  }

  /**
   * Extract the page title from HTML.
   */
  private extractTitle(html: string): string | undefined {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch?.[1]) {
      return this.decodeHtmlEntities(titleMatch[1].trim());
    }

    // Try og:title
    const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (ogTitleMatch?.[1]) {
      return this.decodeHtmlEntities(ogTitleMatch[1].trim());
    }

    return undefined;
  }

  /**
   * Extract the meta description from HTML.
   */
  private extractMetaDescription(html: string): string | undefined {
    // Standard meta description
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (descMatch?.[1]) {
      return this.decodeHtmlEntities(descMatch[1].trim());
    }

    // og:description
    const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    if (ogDescMatch?.[1]) {
      return this.decodeHtmlEntities(ogDescMatch[1].trim());
    }

    return undefined;
  }

  /**
   * Convert HTML to plain text by stripping tags and normalizing whitespace.
   */
  private htmlToText(html: string): string {
    let text = html;

    // Remove script and style elements
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
    text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
    text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');

    // Replace block elements with newlines
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|article|section)>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Strip remaining tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = this.decodeHtmlEntities(text);

    // Normalize whitespace
    text = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    return text;
  }

  /**
   * Decode common HTML entities.
   */
  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
  }

  /**
   * Generate a link preview string.
   */
  private generateLinkPreview(
    url: string,
    title?: string,
    description?: string,
    text?: string
  ): string {
    const parts: string[] = [];

    if (title) {
      parts.push(`"${title}"`);
    }

    parts.push(`(${url})`);

    if (description) {
      parts.push(`- ${description}`);
    } else if (text && text.length > 0) {
      const preview = text.length > 150 ? text.slice(0, 150) + '...' : text;
      parts.push(`- ${preview}`);
    }

    return `Link: ${parts.join(' ')}`;
  }
}
