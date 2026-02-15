/**
 * Document chunking utilities for splitting text into manageable,
 * overlapping chunks that preserve context for embedding and retrieval.
 */

export interface ChunkOptions {
  maxChunkSize: number;
  overlap: number;
}

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_OVERLAP = 64;

/**
 * Split text into overlapping chunks of a maximum size.
 * Tries to split at sentence boundaries when possible to preserve coherence.
 */
export function chunkText(
  text: string,
  maxChunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP
): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  if (text.length <= maxChunkSize) {
    return [text.trim()];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChunkSize, text.length);

    // If we're not at the end of the text, try to find a good break point
    if (end < text.length) {
      const breakPoint = findBreakPoint(text, start, end);
      if (breakPoint > start) {
        end = breakPoint;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Move start forward, accounting for overlap
    const advance = end - start - overlap;
    start += Math.max(advance, 1);
  }

  return chunks;
}

/**
 * Split text into chunks by paragraph boundaries.
 * Paragraphs are defined by double newlines or other common paragraph separators.
 */
export function chunkByParagraph(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  return paragraphs;
}

/**
 * Split text into chunks by sentence boundaries.
 * Handles common abbreviations and edge cases to avoid false splits.
 */
export function chunkBySentence(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Split on sentence-ending punctuation followed by whitespace and an uppercase letter,
  // but avoid splitting on common abbreviations like Mr., Dr., etc.
  const abbreviations = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Inc|Ltd|Corp)\.\s/g;
  const placeholders: Array<{ original: string; placeholder: string }> = [];
  let processed = text;
  let match: RegExpExecArray | null;

  // Temporarily replace abbreviations to avoid false sentence splits
  while ((match = abbreviations.exec(text)) !== null) {
    const placeholder = `__ABBR_${placeholders.length}__`;
    placeholders.push({ original: match[0], placeholder });
    processed = processed.replace(match[0], placeholder);
  }

  // Split on sentence boundaries
  const rawSentences = processed.split(/(?<=[.!?])\s+(?=[A-Z])/);

  // Restore abbreviations and clean up
  const sentences = rawSentences
    .map(sentence => {
      let restored = sentence;
      for (const { original, placeholder } of placeholders) {
        restored = restored.replace(placeholder, original);
      }
      return restored.trim();
    })
    .filter(s => s.length > 0);

  return sentences;
}

/**
 * Smart chunking that combines paragraph and sentence chunking
 * to produce chunks near the target size while preserving context.
 */
export function smartChunk(
  text: string,
  targetSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP
): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  if (text.length <= targetSize) {
    return [text.trim()];
  }

  // First try paragraph-based chunking
  const paragraphs = chunkByParagraph(text);

  const chunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed the target size
    if (currentChunk.length + paragraph.length + 2 > targetSize) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
      }

      // If the paragraph itself is too large, chunk it by sentences
      if (paragraph.length > targetSize) {
        const sentences = chunkBySentence(paragraph);
        let sentenceChunk = '';

        for (const sentence of sentences) {
          if (sentenceChunk.length + sentence.length + 1 > targetSize) {
            if (sentenceChunk.length > 0) {
              chunks.push(sentenceChunk.trim());
            }
            // If a single sentence is too long, fall back to character chunking
            if (sentence.length > targetSize) {
              const subChunks = chunkText(sentence, targetSize, overlap);
              chunks.push(...subChunks);
              sentenceChunk = '';
            } else {
              sentenceChunk = sentence;
            }
          } else {
            sentenceChunk += (sentenceChunk.length > 0 ? ' ' : '') + sentence;
          }
        }

        if (sentenceChunk.length > 0) {
          currentChunk = sentenceChunk;
        } else {
          currentChunk = '';
        }
      } else {
        currentChunk = paragraph;
      }
    } else {
      currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Find the best break point in text near the end position.
 * Prefers sentence boundaries, then clause boundaries, then word boundaries.
 */
function findBreakPoint(text: string, start: number, end: number): number {
  const searchStart = Math.max(start, end - 100);
  const segment = text.slice(searchStart, end);

  // Try to find a sentence boundary
  const sentenceEnd = segment.lastIndexOf('. ');
  if (sentenceEnd !== -1) {
    return searchStart + sentenceEnd + 2;
  }

  // Try other sentence-ending punctuation
  for (const punct of ['! ', '? ', '.\n', '!\n', '?\n']) {
    const idx = segment.lastIndexOf(punct);
    if (idx !== -1) {
      return searchStart + idx + punct.length;
    }
  }

  // Try clause boundaries
  for (const delim of ['; ', ', ', ': ']) {
    const idx = segment.lastIndexOf(delim);
    if (idx !== -1) {
      return searchStart + idx + delim.length;
    }
  }

  // Fall back to word boundary
  const spaceIdx = segment.lastIndexOf(' ');
  if (spaceIdx !== -1) {
    return searchStart + spaceIdx + 1;
  }

  // No good break point found
  return end;
}
