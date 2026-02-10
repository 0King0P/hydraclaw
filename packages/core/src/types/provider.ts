import type { Plugin } from './plugin.js';
import type { ChatMessage, ImageInput } from './message.js';

export interface AIProvider extends Plugin {
  type: 'provider';
  models(): ModelInfo[];
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  stream(req: CompletionRequest): AsyncIterable<StreamChunk>;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens?: number;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinitionForProvider[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  images?: ImageInput[];
  responseFormat?: 'text' | 'json';
}

export interface ToolDefinitionForProvider {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  usage: TokenUsage;
  model: string;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_call_delta' | 'thinking' | 'done' | 'error';
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  delta?: string;
  usage?: TokenUsage;
  finishReason?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
