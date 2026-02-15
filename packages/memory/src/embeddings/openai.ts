import OpenAI from 'openai';
import type { EmbeddingProvider } from '../types.js';

export interface OpenAIEmbeddingsConfig {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
  baseURL?: string;
}

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_BATCH_SIZE = 100;
const RATE_LIMIT_DELAY_MS = 200;

/**
 * OpenAI-based embedding provider using the text-embedding-3 model family.
 * Supports configurable model, dimensions, and batch processing with rate limiting.
 */
export class OpenAIEmbeddings implements EmbeddingProvider {
  readonly id = 'openai';
  readonly dimensions: number;

  private client: OpenAI;
  private model: string;
  private batchSize: number;
  private lastRequestTime: number = 0;

  constructor(config: OpenAIEmbeddingsConfig = {}) {
    this.client = new OpenAI({
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: config.baseURL,
    });
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /**
   * Generate an embedding for a single text input.
   */
  async embed(text: string): Promise<number[]> {
    await this.rateLimit();

    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    });

    return response.data[0].embedding;
  }

  /**
   * Generate embeddings for multiple texts with automatic batching and rate limiting.
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
        dimensions: this.dimensions,
      });

      // Sort by index to ensure order matches input
      const sorted = response.data.sort((a, b) => a.index - b.index);
      allEmbeddings.push(...sorted.map(d => d.embedding));
    }

    return allEmbeddings;
  }

  /**
   * Simple rate limiting to avoid hitting API rate limits.
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
