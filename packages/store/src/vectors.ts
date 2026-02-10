import type { SQLiteStore } from './sqlite.js';
import type { Logger } from '@hydraclaw/core';

export interface VectorEntry {
  id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export class VectorStore {
  private store: SQLiteStore;
  private logger: Logger;
  private dimensions: number;

  constructor(store: SQLiteStore, logger: Logger, dimensions: number = 1536) {
    this.store = store;
    this.logger = logger;
    this.dimensions = dimensions;
    this.initTables();
  }

  private initTables(): void {
    const db = this.store.getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS vector_entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    this.logger.debug('Vector tables initialized');
  }

  add(entry: VectorEntry): void {
    const db = this.store.getDb();
    const embeddingBlob = Buffer.from(new Float32Array(entry.embedding).buffer);
    db.prepare(
      'INSERT OR REPLACE INTO vector_entries (id, content, metadata, embedding) VALUES (?, ?, ?, ?)'
    ).run(entry.id, entry.content, entry.metadata ? JSON.stringify(entry.metadata) : null, embeddingBlob);
  }

  search(queryEmbedding: number[], limit: number = 10): VectorSearchResult[] {
    const db = this.store.getDb();
    const rows = db.prepare(
      'SELECT id, content, metadata, embedding FROM vector_entries'
    ).all() as Array<{
      id: string;
      content: string;
      metadata: string | null;
      embedding: Buffer;
    }>;

    const results = rows.map(row => {
      const stored = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const score = cosineSimilarity(queryEmbedding, Array.from(stored));
      return {
        id: row.id,
        content: row.content,
        score,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      };
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  delete(id: string): void {
    this.store.getDb().prepare('DELETE FROM vector_entries WHERE id = ?').run(id);
  }

  clear(): void {
    this.store.getDb().prepare('DELETE FROM vector_entries').run();
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
