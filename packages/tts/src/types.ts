export interface TTSProvider {
  id: string;
  name: string;
  voices(): TTSVoice[];
  synthesize(text: string, options?: TTSOptions): Promise<TTSResult>;
}

export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  preview?: string;
}

export interface TTSOptions {
  voice?: string;
  speed?: number;
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  sampleRate?: number;
}

export interface TTSResult {
  audio: Buffer;
  format: string;
  duration?: number;
  sampleRate?: number;
}

export interface STTProvider {
  id: string;
  name: string;
  transcribe(audio: Buffer, options?: STTOptions): Promise<STTResult>;
}

export interface STTOptions {
  language?: string;
  format?: string;
  prompt?: string;
}

export interface STTResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
}
