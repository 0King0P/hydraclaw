import type { Logger } from '@hydraclaw/core';
import type { VectorStore, VectorSearchResult } from '@hydraclaw/store';

export interface MemoryEntry {
  content: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class MemoryManager {
  private vectorStore: VectorStore | null;
  private embeddingProvider: EmbeddingProvider | null;
  private logger: Logger;

  constructor(logger: Logger, vectorStore?: VectorStore, embeddingProvider?: EmbeddingProvider) {
    this.logger = logger;
    this.vectorStore = vectorStore ?? null;
    this.embeddingProvider = embeddingProvider ?? null;
  }

  get isEnabled(): boolean {
    return this.vectorStore !== null && this.embeddingProvider !== null;
  }

  async store(entry: MemoryEntry): Promise<void> {
    if (!this.vectorStore || !this.embeddingProvider) {
      this.logger.debug('Memory not enabled, skipping store');
      return;
    }

    const embedding = await this.embeddingProvider.embed(entry.content);
    this.vectorStore.add({
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      content: entry.content,
      embedding,
      metadata: { source: entry.source, ...entry.metadata },
    });
  }

  async search(query: string, limit: number = 5): Promise<VectorSearchResult[]> {
    if (!this.vectorStore || !this.embeddingProvider) {
      return [];
    }

    const queryEmbedding = await this.embeddingProvider.embed(query);
    return this.vectorStore.search(queryEmbedding, limit);
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    if (!this.vectorStore || !this.embeddingProvider) return;

    const texts = entries.map(e => e.content);
    const embeddings = await this.embeddingProvider.embedBatch(texts);

    for (let i = 0; i < entries.length; i++) {
      this.vectorStore.add({
        id: `mem_${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`,
        content: entries[i].content,
        embedding: embeddings[i],
        metadata: { source: entries[i].source, ...entries[i].metadata },
      });
    }
  }
}
