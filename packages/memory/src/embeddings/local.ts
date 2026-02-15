import type { EmbeddingProvider } from '../types.js';

export interface LocalEmbeddingsConfig {
  dimensions?: number;
  maxVocabulary?: number;
}

const DEFAULT_DIMENSIONS = 384;
const DEFAULT_MAX_VOCABULARY = 10000;

/**
 * Local TF-IDF based embedding provider that works entirely offline.
 * Lower quality than neural embeddings but requires no API calls or network access.
 * Useful for development, testing, or environments without API access.
 */
export class LocalEmbeddings implements EmbeddingProvider {
  readonly id = 'local';
  readonly dimensions: number;

  private vocabulary: Map<string, number> = new Map();
  private documentFrequencies: Map<string, number> = new Map();
  private totalDocuments: number = 0;
  private maxVocabulary: number;

  constructor(config: LocalEmbeddingsConfig = {}) {
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.maxVocabulary = config.maxVocabulary ?? DEFAULT_MAX_VOCABULARY;
  }

  /**
   * Generate a TF-IDF based embedding for a single text.
   */
  async embed(text: string): Promise<number[]> {
    const tokens = this.tokenize(text);
    this.updateVocabulary(tokens);
    return this.computeEmbedding(tokens);
  }

  /**
   * Generate embeddings for multiple texts.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    // First pass: tokenize all and update vocabulary
    const tokenizedTexts = texts.map(text => this.tokenize(text));
    for (const tokens of tokenizedTexts) {
      this.updateVocabulary(tokens);
    }

    // Second pass: compute embeddings with the updated vocabulary
    return tokenizedTexts.map(tokens => this.computeEmbedding(tokens));
  }

  /**
   * Compute a fixed-dimension embedding from token frequencies.
   * Uses hashing to project the sparse TF-IDF vector into a dense vector.
   */
  private computeEmbedding(tokens: string[]): number[] {
    const embedding = new Float64Array(this.dimensions);

    // Compute term frequencies
    const termFreqs = new Map<string, number>();
    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
    }

    const docLength = tokens.length;
    if (docLength === 0) {
      return Array.from(embedding);
    }

    // Project TF-IDF values into the fixed-dimension embedding via hashing
    for (const [term, tf] of termFreqs) {
      const normalizedTf = tf / docLength;
      const df = this.documentFrequencies.get(term) ?? 1;
      const idf = Math.log((this.totalDocuments + 1) / (df + 1)) + 1;
      const tfidf = normalizedTf * idf;

      // Hash the term to multiple dimensions (simulated random projection)
      const hashes = this.multiHash(term, 3);
      for (const { index, sign } of hashes) {
        embedding[index] += sign * tfidf;
      }
    }

    // L2 normalize the embedding
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        embedding[i] /= norm;
      }
    }

    return Array.from(embedding);
  }

  /**
   * Update the vocabulary and document frequency counters with new tokens.
   */
  private updateVocabulary(tokens: string[]): void {
    this.totalDocuments++;

    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      if (!this.vocabulary.has(token) && this.vocabulary.size < this.maxVocabulary) {
        this.vocabulary.set(token, this.vocabulary.size);
      }
      this.documentFrequencies.set(
        token,
        (this.documentFrequencies.get(token) ?? 0) + 1
      );
    }
  }

  /**
   * Tokenize text into lowercase terms, removing punctuation and stop words.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOP_WORDS.has(t));
  }

  /**
   * Generate multiple hash-based projections for a term.
   * Each projection maps to an index in the embedding and a sign (+1 or -1).
   */
  private multiHash(term: string, count: number): Array<{ index: number; sign: number }> {
    const results: Array<{ index: number; sign: number }> = [];

    for (let i = 0; i < count; i++) {
      const hash = this.hashString(`${term}_${i}`);
      const index = Math.abs(hash) % this.dimensions;
      const sign = hash % 2 === 0 ? 1 : -1;
      results.push({ index, sign });
    }

    return results;
  }

  /**
   * Simple string hash function (DJB2 variant).
   */
  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return hash;
  }
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'to', 'was', 'were', 'will', 'with', 'this', 'but', 'they',
  'have', 'had', 'what', 'when', 'where', 'who', 'which', 'how',
  'not', 'no', 'do', 'does', 'did', 'can', 'could', 'would', 'should',
  'may', 'might', 'shall', 'if', 'then', 'than', 'so', 'just', 'about',
]);
