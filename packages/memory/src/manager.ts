import type { Logger } from '@hydraclaw/core';
import type { VectorStore } from '@hydraclaw/store';
import type {
  MemoryDocument,
  MemoryMetadata,
  MemorySearchResult,
  MemorySearchOptions,
  EmbeddingProvider,
  MemoryManagerConfig,
  MemoryStats,
} from './types.js';
import { HybridSearchEngine } from './search.js';
import { smartChunk } from './chunker.js';

const DEFAULT_CONFIG: Required<MemoryManagerConfig> = {
  maxDocuments: 100000,
  defaultTopK: 10,
  defaultThreshold: 0.1,
  semanticWeight: 0.7,
  keywordWeight: 0.3,
  chunkSize: 512,
  chunkOverlap: 64,
};

/**
 * Main memory system orchestrator.
 * Manages document storage, embedding generation, and hybrid search
 * across the memory store. Provides high-level recall and summarization
 * capabilities for agent use.
 */
export class MemoryManager {
  private config: Required<MemoryManagerConfig>;
  private embeddingProvider: EmbeddingProvider;
  private vectorStore: VectorStore;
  private logger: Logger;
  private documentIndex: Map<string, MemoryDocument> = new Map();
  private searchEngine: HybridSearchEngine;

  constructor(
    config: MemoryManagerConfig,
    embeddingProvider: EmbeddingProvider,
    vectorStore: VectorStore,
    logger: Logger
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.embeddingProvider = embeddingProvider;
    this.vectorStore = vectorStore;
    this.logger = logger;

    this.searchEngine = new HybridSearchEngine(
      vectorStore,
      logger,
      this.documentIndex,
      {
        semanticWeight: this.config.semanticWeight,
        keywordWeight: this.config.keywordWeight,
      }
    );

    this.logger.info(`MemoryManager initialized with ${this.embeddingProvider.id} embeddings (${this.embeddingProvider.dimensions}d)`);
  }

  /**
   * Embed and store a document in memory.
   * Large documents are automatically chunked, with each chunk stored as a separate
   * memory document linked by metadata.
   */
  async store(content: string, metadata: MemoryMetadata): Promise<MemoryDocument[]> {
    const now = Date.now();
    const chunks = smartChunk(content, this.config.chunkSize, this.config.chunkOverlap);

    if (chunks.length === 0) {
      this.logger.debug('Empty content, nothing to store');
      return [];
    }

    const documents: MemoryDocument[] = [];
    const parentId = this.generateId();

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const docId = chunks.length === 1 ? parentId : `${parentId}_chunk_${i}`;

      const embedding = await this.embeddingProvider.embed(chunk);

      const document: MemoryDocument = {
        id: docId,
        content: chunk,
        embedding,
        metadata: {
          ...metadata,
          ...(chunks.length > 1 && {
            parentId,
            chunkIndex: i,
            totalChunks: chunks.length,
          }),
        },
        createdAt: now,
        updatedAt: now,
      };

      this.documentIndex.set(docId, document);
      this.vectorStore.add({
        id: docId,
        content: chunk,
        embedding,
        metadata: document.metadata as Record<string, unknown>,
      });

      documents.push(document);
    }

    this.logger.debug(`Stored ${documents.length} memory document(s) from content (${content.length} chars)`);
    return documents;
  }

  /**
   * Batch store multiple documents efficiently.
   * Generates embeddings in batch for better throughput.
   */
  async storeBatch(
    docs: Array<{ content: string; metadata: MemoryMetadata }>
  ): Promise<MemoryDocument[]> {
    const now = Date.now();
    const allDocuments: MemoryDocument[] = [];

    // Prepare all chunks and their metadata
    const items: Array<{ content: string; metadata: MemoryMetadata; parentId: string; chunkIndex: number; totalChunks: number }> = [];

    for (const doc of docs) {
      const chunks = smartChunk(doc.content, this.config.chunkSize, this.config.chunkOverlap);
      const parentId = this.generateId();

      for (let i = 0; i < chunks.length; i++) {
        items.push({
          content: chunks[i],
          metadata: {
            ...doc.metadata,
            ...(chunks.length > 1 && {
              parentId,
              chunkIndex: i,
              totalChunks: chunks.length,
            }),
          },
          parentId,
          chunkIndex: i,
          totalChunks: chunks.length,
        });
      }
    }

    if (items.length === 0) return [];

    // Batch embed all chunks
    const embeddings = await this.embeddingProvider.embedBatch(
      items.map(item => item.content)
    );

    // Store all documents
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const docId = item.totalChunks === 1
        ? item.parentId
        : `${item.parentId}_chunk_${item.chunkIndex}`;

      const document: MemoryDocument = {
        id: docId,
        content: item.content,
        embedding: embeddings[i],
        metadata: item.metadata,
        createdAt: now,
        updatedAt: now,
      };

      this.documentIndex.set(docId, document);
      this.vectorStore.add({
        id: docId,
        content: item.content,
        embedding: embeddings[i],
        metadata: item.metadata as Record<string, unknown>,
      });

      allDocuments.push(document);
    }

    this.logger.info(`Batch stored ${allDocuments.length} memory documents from ${docs.length} inputs`);
    return allDocuments;
  }

  /**
   * Search memories using hybrid search (semantic + keyword).
   */
  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const searchOpts: MemorySearchOptions = {
      ...options,
      topK: options.topK ?? this.config.defaultTopK,
      threshold: options.threshold ?? this.config.defaultThreshold,
    };

    let embedding: number[] | undefined;
    if (searchOpts.searchType !== 'keyword') {
      try {
        embedding = await this.embeddingProvider.embed(options.query);
      } catch (error) {
        this.logger.warn('Failed to generate query embedding, falling back to keyword search', error);
      }
    }

    return this.searchEngine.search(searchOpts, embedding);
  }

  /**
   * High-level recall for agent use.
   * Searches memories and formats results as a context string suitable for
   * injection into an AI prompt.
   */
  async recall(
    query: string,
    context?: { channelId?: string; senderId?: string; sessionId?: string }
  ): Promise<string> {
    const results = await this.search({
      query,
      topK: this.config.defaultTopK,
      threshold: this.config.defaultThreshold,
      searchType: 'hybrid',
      filters: context ? {
        channelId: context.channelId,
        senderId: context.senderId,
      } : undefined,
    });

    if (results.length === 0) {
      return '';
    }

    const formattedMemories = results.map((result, index) => {
      const meta = result.document.metadata;
      const age = this.formatAge(result.document.createdAt);
      const typeLabel = meta.type.charAt(0).toUpperCase() + meta.type.slice(1);
      return `[${index + 1}] (${typeLabel}, ${age} ago, relevance: ${(result.score * 100).toFixed(0)}%) ${result.document.content}`;
    });

    return `Relevant memories:\n${formattedMemories.join('\n')}`;
  }

  /**
   * Delete a specific memory by ID.
   */
  forget(id: string): boolean {
    const existed = this.documentIndex.delete(id);
    if (existed) {
      this.vectorStore.delete(id);
      this.logger.debug(`Forgot memory: ${id}`);
    }
    return existed;
  }

  /**
   * Bulk delete memories matching the given filters.
   */
  forgetAll(filters: {
    source?: string;
    type?: MemoryMetadata['type'];
    channelId?: string;
    senderId?: string;
    before?: number;
  }): number {
    let deleted = 0;

    for (const [id, doc] of this.documentIndex) {
      const meta = doc.metadata;
      let matches = true;

      if (filters.source && meta.source !== filters.source) matches = false;
      if (filters.type && meta.type !== filters.type) matches = false;
      if (filters.channelId && meta.channelId !== filters.channelId) matches = false;
      if (filters.senderId && meta.senderId !== filters.senderId) matches = false;
      if (filters.before && doc.createdAt >= filters.before) matches = false;

      if (matches) {
        this.documentIndex.delete(id);
        this.vectorStore.delete(id);
        deleted++;
      }
    }

    this.logger.info(`Forgot ${deleted} memories matching filters`);
    return deleted;
  }

  /**
   * Summarize memories from a specific session.
   * Retrieves all memories for the session and produces a condensed summary.
   */
  async summarize(sessionId: string): Promise<string> {
    const sessionDocs: MemoryDocument[] = [];

    for (const doc of this.documentIndex.values()) {
      if (doc.metadata.sessionId === sessionId) {
        sessionDocs.push(doc);
      }
    }

    if (sessionDocs.length === 0) {
      return `No memories found for session ${sessionId}`;
    }

    // Sort by creation time
    sessionDocs.sort((a, b) => a.createdAt - b.createdAt);

    const lines: string[] = [
      `Session ${sessionId} - ${sessionDocs.length} memories:`,
      '',
    ];

    // Group by type
    const byType = new Map<string, MemoryDocument[]>();
    for (const doc of sessionDocs) {
      const type = doc.metadata.type;
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(doc);
    }

    for (const [type, docs] of byType) {
      lines.push(`${type.charAt(0).toUpperCase() + type.slice(1)}s (${docs.length}):`);
      for (const doc of docs) {
        const preview = doc.content.length > 100
          ? doc.content.slice(0, 100) + '...'
          : doc.content;
        lines.push(`  - ${preview}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get statistics about the memory store.
   */
  getStats(): MemoryStats {
    let totalSize = 0;
    let oldestDocument: number | null = null;
    let newestDocument: number | null = null;
    const typeBreakdown: Record<string, number> = {};

    for (const doc of this.documentIndex.values()) {
      totalSize += doc.content.length;

      if (oldestDocument === null || doc.createdAt < oldestDocument) {
        oldestDocument = doc.createdAt;
      }
      if (newestDocument === null || doc.createdAt > newestDocument) {
        newestDocument = doc.createdAt;
      }

      const type = doc.metadata.type;
      typeBreakdown[type] = (typeBreakdown[type] ?? 0) + 1;
    }

    return {
      totalDocuments: this.documentIndex.size,
      totalSize,
      oldestDocument,
      newestDocument,
      typeBreakdown,
    };
  }

  /**
   * Sync and reindex all memories.
   * Rebuilds embeddings for all documents in the index.
   */
  async sync(): Promise<void> {
    const docs = Array.from(this.documentIndex.values());
    if (docs.length === 0) {
      this.logger.info('No documents to sync');
      return;
    }

    this.logger.info(`Syncing ${docs.length} memory documents...`);

    const contents = docs.map(d => d.content);
    const embeddings = await this.embeddingProvider.embedBatch(contents);

    this.vectorStore.clear();

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      doc.embedding = embeddings[i];
      doc.updatedAt = Date.now();

      this.vectorStore.add({
        id: doc.id,
        content: doc.content,
        embedding: embeddings[i],
        metadata: doc.metadata as Record<string, unknown>,
      });
    }

    this.logger.info(`Sync complete: ${docs.length} documents reindexed`);
  }

  /**
   * Get the internal document index (for advanced use cases).
   */
  getDocumentIndex(): ReadonlyMap<string, MemoryDocument> {
    return this.documentIndex;
  }

  /**
   * Generate a unique document ID.
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Format a timestamp age as a human-readable string.
   */
  private formatAge(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }
}
