import type { Logger } from '@hydraclaw/core';
import type { MemoryDocument, EmbeddingProvider, MemoryMetadata } from './types.js';
import type { MemoryManager } from './manager.js';

export interface MemorySyncConfig {
  maxAge?: number;
  batchSize?: number;
}

export interface ExportedMemories {
  version: number;
  exportedAt: number;
  documents: ExportedDocument[];
}

export interface ExportedDocument {
  id: string;
  content: string;
  metadata: MemoryMetadata;
  createdAt: number;
  updatedAt: number;
}

/**
 * Memory synchronization, maintenance, and backup utilities.
 * Handles reindexing, pruning, and import/export of the memory store.
 */
export class MemorySync {
  private manager: MemoryManager;
  private embeddingProvider: EmbeddingProvider;
  private logger: Logger;
  private config: Required<MemorySyncConfig>;

  constructor(
    manager: MemoryManager,
    embeddingProvider: EmbeddingProvider,
    logger: Logger,
    config: MemorySyncConfig = {}
  ) {
    this.manager = manager;
    this.embeddingProvider = embeddingProvider;
    this.logger = logger;
    this.config = {
      maxAge: config.maxAge ?? 30 * 24 * 60 * 60 * 1000, // 30 days default
      batchSize: config.batchSize ?? 50,
    };
  }

  /**
   * Extract and store important facts from a conversation session.
   * Analyzes the session's existing memories and identifies key information
   * worth preserving as long-term facts.
   */
  async syncSession(sessionId: string): Promise<number> {
    const index = this.manager.getDocumentIndex();
    const sessionDocs: MemoryDocument[] = [];

    for (const doc of index.values()) {
      if (doc.metadata.sessionId === sessionId) {
        sessionDocs.push(doc);
      }
    }

    if (sessionDocs.length === 0) {
      this.logger.debug(`No documents found for session ${sessionId}`);
      return 0;
    }

    // Sort by creation time
    sessionDocs.sort((a, b) => a.createdAt - b.createdAt);

    // Extract facts from conversation memories
    const facts: Array<{ content: string; metadata: MemoryMetadata }> = [];

    for (const doc of sessionDocs) {
      if (doc.metadata.type === 'conversation') {
        // Extract declarative statements that look like facts or preferences
        const extracted = this.extractFacts(doc.content, doc.metadata);
        facts.push(...extracted);
      }
    }

    if (facts.length === 0) {
      this.logger.debug(`No facts extracted from session ${sessionId}`);
      return 0;
    }

    // Store extracted facts
    const stored = await this.manager.storeBatch(facts);
    this.logger.info(`Synced session ${sessionId}: extracted and stored ${stored.length} facts`);
    return stored.length;
  }

  /**
   * Rebuild all embeddings in the memory store.
   * Useful when switching embedding providers or after data corruption.
   */
  async reindex(): Promise<number> {
    this.logger.info('Starting full reindex...');
    await this.manager.sync();
    const stats = this.manager.getStats();
    this.logger.info(`Reindex complete: ${stats.totalDocuments} documents reindexed`);
    return stats.totalDocuments;
  }

  /**
   * Remove memories older than the specified maximum age.
   */
  pruneOld(maxAge?: number): number {
    const cutoff = Date.now() - (maxAge ?? this.config.maxAge);
    const deleted = this.manager.forgetAll({ before: cutoff });
    this.logger.info(`Pruned ${deleted} memories older than ${this.formatDuration(maxAge ?? this.config.maxAge)}`);
    return deleted;
  }

  /**
   * Export all memories to a serializable format for backup.
   * Embeddings are excluded to keep the export compact and portable.
   */
  exportMemories(): ExportedMemories {
    const index = this.manager.getDocumentIndex();
    const documents: ExportedDocument[] = [];

    for (const doc of index.values()) {
      documents.push({
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      });
    }

    // Sort by creation time for consistent ordering
    documents.sort((a, b) => a.createdAt - b.createdAt);

    const exported: ExportedMemories = {
      version: 1,
      exportedAt: Date.now(),
      documents,
    };

    this.logger.info(`Exported ${documents.length} memories`);
    return exported;
  }

  /**
   * Import memories from a previously exported backup.
   * Re-generates embeddings for all imported documents.
   */
  async importMemories(data: ExportedMemories): Promise<number> {
    if (data.version !== 1) {
      throw new Error(`Unsupported export version: ${data.version}`);
    }

    this.logger.info(`Importing ${data.documents.length} memories from export (${new Date(data.exportedAt).toISOString()})...`);

    const batchItems: Array<{ content: string; metadata: MemoryMetadata }> = [];

    for (const doc of data.documents) {
      batchItems.push({
        content: doc.content,
        metadata: doc.metadata,
      });
    }

    // Process in batches to avoid overwhelming the embedding provider
    let totalImported = 0;

    for (let i = 0; i < batchItems.length; i += this.config.batchSize) {
      const batch = batchItems.slice(i, i + this.config.batchSize);
      const stored = await this.manager.storeBatch(batch);
      totalImported += stored.length;
      this.logger.debug(`Imported batch ${Math.floor(i / this.config.batchSize) + 1}: ${stored.length} documents`);
    }

    this.logger.info(`Import complete: ${totalImported} memories imported`);
    return totalImported;
  }

  /**
   * Extract factual statements from conversation content.
   * Looks for patterns that indicate preferences, facts, or important information.
   */
  private extractFacts(
    content: string,
    sourceMetadata: MemoryMetadata
  ): Array<{ content: string; metadata: MemoryMetadata }> {
    const facts: Array<{ content: string; metadata: MemoryMetadata }> = [];
    const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();

      // Detect preference statements
      const isPreference =
        lower.includes('i prefer') ||
        lower.includes('i like') ||
        lower.includes('i want') ||
        lower.includes('i need') ||
        lower.includes('i love') ||
        lower.includes('i hate') ||
        lower.includes('my favorite') ||
        lower.includes('i always') ||
        lower.includes('i never');

      // Detect factual statements
      const isFact =
        lower.includes('my name is') ||
        lower.includes('i am a') ||
        lower.includes('i work') ||
        lower.includes('i live') ||
        lower.includes('i use') ||
        lower.includes('i have') ||
        lower.startsWith('remember that') ||
        lower.startsWith('note that') ||
        lower.includes('important:') ||
        lower.includes('keep in mind');

      if (isPreference) {
        facts.push({
          content: sentence,
          metadata: {
            ...sourceMetadata,
            type: 'preference',
            tags: [...(sourceMetadata.tags ?? []), 'auto-extracted'],
          },
        });
      } else if (isFact) {
        facts.push({
          content: sentence,
          metadata: {
            ...sourceMetadata,
            type: 'fact',
            tags: [...(sourceMetadata.tags ?? []), 'auto-extracted'],
          },
        });
      }
    }

    return facts;
  }

  /**
   * Format a duration in milliseconds as a human-readable string.
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }
}
