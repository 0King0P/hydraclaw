export type MediaType = 'image' | 'audio' | 'video' | 'document' | 'link';

export interface MediaInput {
  type: MediaType;
  url?: string;
  data?: Buffer;
  mimeType: string;
  filename?: string;
  size?: number;
}

export interface MediaAnalysis {
  type: MediaType;
  description: string;
  text?: string;
  metadata: Record<string, unknown>;
  transcription?: string;
  summary?: string;
}

export interface MediaProcessor {
  supports(type: MediaType, mimeType: string): boolean;
  process(input: MediaInput): Promise<MediaAnalysis>;
}
