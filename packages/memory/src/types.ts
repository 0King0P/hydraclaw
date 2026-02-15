export interface MemoryDocument {
  id: string;
  content: string;
  embedding?: number[];
  metadata: MemoryMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryMetadata {
  source: string;
  type: 'conversation' | 'document' | 'note' | 'fact' | 'preference';
  channelId?: string;
  senderId?: string;
  sessionId?: string;
  tags?: string[];
  importance?: number;
  [key: string]: unknown;
}

export interface MemorySearchResult {
  document: MemoryDocument;
  score: number;
  matchType: 'semantic' | 'keyword' | 'hybrid';
}

export interface MemorySearchOptions {
  query: string;
  topK?: number;
  threshold?: number;
  filters?: MemorySearchFilters;
  searchType?: 'semantic' | 'keyword' | 'hybrid';
}

export interface MemorySearchFilters {
  source?: string;
  type?: MemoryMetadata['type'];
  channelId?: string;
  senderId?: string;
  tags?: string[];
  after?: number;
  before?: number;
}

export interface EmbeddingProvider {
  id: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

export interface MemoryManagerConfig {
  maxDocuments?: number;
  defaultTopK?: number;
  defaultThreshold?: number;
  semanticWeight?: number;
  keywordWeight?: number;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface MemoryStats {
  totalDocuments: number;
  totalSize: number;
  oldestDocument: number | null;
  newestDocument: number | null;
  typeBreakdown: Record<string, number>;
}
