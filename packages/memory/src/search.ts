import type { VectorStore, VectorSearchResult } from '@hydraclaw/store';
import type { Logger } from '@hydraclaw/core';
import type {
  MemoryDocument,
  MemorySearchResult,
  MemorySearchOptions,
  MemorySearchFilters,
} from './types.js';

export interface HybridSearchConfig {
  semanticWeight: number;
  keywordWeight: number;
  fusionK: number;
}

const DEFAULT_CONFIG: HybridSearchConfig = {
  semanticWeight: 0.7,
  keywordWeight: 0.3,
  fusionK: 60,
};

/**
 * Hybrid search engine combining semantic (vector) search with keyword (text) search.
 * Uses reciprocal rank fusion to combine results from both methods.
 */
export class HybridSearchEngine {
  private vectorStore: VectorStore;
  private logger: Logger;
  private config: HybridSearchConfig;
  private documentIndex: Map<string, MemoryDocument>;

  constructor(
    vectorStore: VectorStore,
    logger: Logger,
    documentIndex: Map<string, MemoryDocument>,
    config?: Partial<HybridSearchConfig>
  ) {
    this.vectorStore = vectorStore;
    this.logger = logger;
    this.documentIndex = documentIndex;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Perform semantic search using vector similarity.
   */
  async semanticSearch(embedding: number[], topK: number): Promise<MemorySearchResult[]> {
    const vectorResults = this.vectorStore.search(embedding, topK);
    return this.vectorResultsToMemoryResults(vectorResults, 'semantic');
  }

  /**
   * Perform keyword-based text search across documents.
   */
  keywordSearch(query: string, topK: number): MemorySearchResult[] {
    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) {
      return [];
    }

    const scored: Array<{ document: MemoryDocument; score: number }> = [];

    for (const doc of this.documentIndex.values()) {
      const docTerms = this.tokenize(doc.content);
      const score = this.computeBM25Score(queryTerms, docTerms);
      if (score > 0) {
        scored.push({ document: doc, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map(({ document, score }) => ({
      document,
      score,
      matchType: 'keyword' as const,
    }));
  }

  /**
   * Perform hybrid search combining semantic and keyword results
   * using reciprocal rank fusion.
   */
  async hybridSearch(
    query: string,
    embedding: number[],
    topK: number
  ): Promise<MemorySearchResult[]> {
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(embedding, topK * 2),
      Promise.resolve(this.keywordSearch(query, topK * 2)),
    ]);

    return this.reciprocalRankFusion(semanticResults, keywordResults, topK);
  }

  /**
   * Execute a search with the given options, routing to the appropriate method.
   */
  async search(
    options: MemorySearchOptions,
    embedding?: number[]
  ): Promise<MemorySearchResult[]> {
    const topK = options.topK ?? 10;
    const searchType = options.searchType ?? 'hybrid';
    const threshold = options.threshold ?? 0;

    let results: MemorySearchResult[];

    switch (searchType) {
      case 'semantic': {
        if (!embedding) {
          this.logger.warn('Semantic search requested but no embedding provided, falling back to keyword');
          results = this.keywordSearch(options.query, topK);
        } else {
          results = await this.semanticSearch(embedding, topK);
        }
        break;
      }
      case 'keyword': {
        results = this.keywordSearch(options.query, topK);
        break;
      }
      case 'hybrid':
      default: {
        if (!embedding) {
          this.logger.debug('No embedding for hybrid search, using keyword only');
          results = this.keywordSearch(options.query, topK);
        } else {
          results = await this.hybridSearch(options.query, embedding, topK);
        }
        break;
      }
    }

    // Apply filters
    if (options.filters) {
      results = this.applyFilters(results, options.filters);
    }

    // Apply threshold
    if (threshold > 0) {
      results = results.filter(r => r.score >= threshold);
    }

    return results.slice(0, topK);
  }

  /**
   * Combine semantic and keyword results using reciprocal rank fusion (RRF).
   * RRF = sum(1 / (k + rank_i)) for each ranking list where the document appears.
   */
  private reciprocalRankFusion(
    semanticResults: MemorySearchResult[],
    keywordResults: MemorySearchResult[],
    topK: number
  ): MemorySearchResult[] {
    const k = this.config.fusionK;
    const fusedScores = new Map<string, { document: MemoryDocument; score: number }>();

    // Score from semantic results
    for (let i = 0; i < semanticResults.length; i++) {
      const result = semanticResults[i];
      const rrfScore = this.config.semanticWeight * (1 / (k + i + 1));
      const existing = fusedScores.get(result.document.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        fusedScores.set(result.document.id, {
          document: result.document,
          score: rrfScore,
        });
      }
    }

    // Score from keyword results
    for (let i = 0; i < keywordResults.length; i++) {
      const result = keywordResults[i];
      const rrfScore = this.config.keywordWeight * (1 / (k + i + 1));
      const existing = fusedScores.get(result.document.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        fusedScores.set(result.document.id, {
          document: result.document,
          score: rrfScore,
        });
      }
    }

    const combined = Array.from(fusedScores.values());
    combined.sort((a, b) => b.score - a.score);

    return combined.slice(0, topK).map(({ document, score }) => ({
      document,
      score,
      matchType: 'hybrid' as const,
    }));
  }

  /**
   * Apply metadata filters to search results.
   */
  private applyFilters(
    results: MemorySearchResult[],
    filters: MemorySearchFilters
  ): MemorySearchResult[] {
    return results.filter(result => {
      const meta = result.document.metadata;

      if (filters.source && meta.source !== filters.source) return false;
      if (filters.type && meta.type !== filters.type) return false;
      if (filters.channelId && meta.channelId !== filters.channelId) return false;
      if (filters.senderId && meta.senderId !== filters.senderId) return false;

      if (filters.tags && filters.tags.length > 0) {
        if (!meta.tags || !filters.tags.some(t => meta.tags!.includes(t))) {
          return false;
        }
      }

      if (filters.after && result.document.createdAt < filters.after) return false;
      if (filters.before && result.document.createdAt > filters.before) return false;

      return true;
    });
  }

  /**
   * Convert VectorStore results to MemorySearchResults by looking up full documents.
   */
  private vectorResultsToMemoryResults(
    vectorResults: VectorSearchResult[],
    matchType: 'semantic' | 'keyword' | 'hybrid'
  ): MemorySearchResult[] {
    const results: MemorySearchResult[] = [];

    for (const vr of vectorResults) {
      const document = this.documentIndex.get(vr.id);
      if (document) {
        results.push({
          document,
          score: vr.score,
          matchType,
        });
      } else {
        this.logger.debug(`Vector result ${vr.id} not found in document index`);
      }
    }

    return results;
  }

  /**
   * Simple tokenizer that lowercases, removes punctuation, and splits on whitespace.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOP_WORDS.has(t));
  }

  /**
   * Compute BM25 score for a query against a document.
   */
  private computeBM25Score(queryTerms: string[], docTerms: string[]): number {
    const k1 = 1.2;
    const b = 0.75;
    const avgDocLength = 200; // Approximate average document length
    const totalDocs = Math.max(this.documentIndex.size, 1);

    const termFreqs = new Map<string, number>();
    for (const term of docTerms) {
      termFreqs.set(term, (termFreqs.get(term) ?? 0) + 1);
    }

    let score = 0;

    for (const queryTerm of queryTerms) {
      const tf = termFreqs.get(queryTerm) ?? 0;
      if (tf === 0) continue;

      // Count documents containing this term (approximate)
      let docsContaining = 0;
      for (const doc of this.documentIndex.values()) {
        if (doc.content.toLowerCase().includes(queryTerm)) {
          docsContaining++;
        }
      }

      const idf = Math.log(
        (totalDocs - docsContaining + 0.5) / (docsContaining + 0.5) + 1
      );

      const tfNorm =
        (tf * (k1 + 1)) /
        (tf + k1 * (1 - b + b * (docTerms.length / avgDocLength)));

      score += idf * tfNorm;
    }

    return score;
  }
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'to', 'was', 'were', 'will', 'with', 'this', 'but', 'they',
  'have', 'had', 'what', 'when', 'where', 'who', 'which', 'how',
  'not', 'no', 'do', 'does', 'did', 'can', 'could', 'would', 'should',
  'may', 'might', 'shall', 'if', 'then', 'than', 'so', 'just', 'about',
  'up', 'out', 'into', 'over', 'after', 'before', 'between', 'under',
  'again', 'there', 'here', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
  'too', 'very', 'also', 'any', 'been', 'being', 'because',
]);
