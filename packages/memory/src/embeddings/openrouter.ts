import OpenAI from 'openai';
import type { EmbeddingProvider } from '../types.js';

export interface OpenRouterEmbeddingsConfig {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
  siteUrl?: string;
  siteName?: string;
}

const DEFAULT_MODEL = 'openai/text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_BATCH_SIZE = 100;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const RATE_LIMIT_DELAY_MS = 250;

/**
 * OpenRouter-based embedding provider.
 * Routes embedding requests through OpenRouter's API, which provides access
 * to OpenAI embeddings and other providers with unified billing.
 */
export class OpenRouterEmbeddings implements EmbeddingProvider {
  readonly id = 'openrouter';
  readonly dimensions: number;

  private client: OpenAI;
  private model: string;
  private batchSize: number;
  private lastRequestTime: number = 0;
  private siteUrl: string;
  private siteName: string;

  constructor(config: OpenRouterEmbeddingsConfig = {}) {
    this.siteUrl = config.siteUrl ?? process.env.OPENROUTER_SITE_URL ?? 'https://hydraclaw.dev';
    this.siteName = config.siteName ?? process.env.OPENROUTER_SITE_NAME ?? 'HydraClaw';
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;

    this.client = new OpenAI({
      apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        'HTTP-Referer': this.siteUrl,
        'X-Title': this.siteName,
      },
    });
  }

  /**
   * Generate an embedding for a single text input.
   */
  async embed(text: string): Promise<number[]> {
    await this.rateLimit();

    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });

    return response.data[0].embedding;
  }

  /**
   * Generate embeddings for multiple texts with batching and rate limiting.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      await this.rateLimit();

      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
      });

      const sorted = response.data.sort((a, b) => a.index - b.index);
      allEmbeddings.push(...sorted.map(d => d.embedding));
    }

    return allEmbeddings;
  }

  /**
   * Simple rate limiting to respect OpenRouter's API limits.
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < RATE_LIMIT_DELAY_MS) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
}
