// Types
export type {
  MemoryDocument,
  MemoryMetadata,
  MemorySearchResult,
  MemorySearchOptions,
  MemorySearchFilters,
  EmbeddingProvider,
  MemoryManagerConfig,
  MemoryStats,
} from './types.js';

// Core
export { MemoryManager } from './manager.js';
export { HybridSearchEngine } from './search.js';
export type { HybridSearchConfig } from './search.js';

// Embedding providers
export { OpenAIEmbeddings } from './embeddings/openai.js';
export type { OpenAIEmbeddingsConfig } from './embeddings/openai.js';
export { OpenRouterEmbeddings } from './embeddings/openrouter.js';
export type { OpenRouterEmbeddingsConfig } from './embeddings/openrouter.js';
export { LocalEmbeddings } from './embeddings/local.js';
export type { LocalEmbeddingsConfig } from './embeddings/local.js';

// Chunking utilities
export { chunkText, chunkByParagraph, chunkBySentence, smartChunk } from './chunker.js';
export type { ChunkOptions } from './chunker.js';

// Sync and maintenance
export { MemorySync } from './sync.js';
export type { MemorySyncConfig, ExportedMemories, ExportedDocument } from './sync.js';
