import type { StreamChunk } from '@hydraclaw/core';

export interface StreamCollector {
  fullText: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  isComplete: boolean;
  error?: string;
}

export function createStreamCollector(): StreamCollector {
  return {
    fullText: '',
    toolCalls: [],
    isComplete: false,
  };
}

export function processChunk(collector: StreamCollector, chunk: StreamChunk): void {
  switch (chunk.type) {
    case 'text':
      collector.fullText += chunk.content ?? '';
      break;
    case 'tool_call':
      if (chunk.toolCall) {
        collector.toolCalls.push(chunk.toolCall);
      }
      break;
    case 'tool_call_delta':
      if (chunk.toolCall) {
        const existing = collector.toolCalls.find(tc => tc.id === chunk.toolCall!.id);
        if (existing) {
          existing.arguments += chunk.delta ?? '';
        } else {
          collector.toolCalls.push({
            id: chunk.toolCall.id,
            name: chunk.toolCall.name,
            arguments: chunk.delta ?? '',
          });
        }
      }
      break;
    case 'done':
      collector.isComplete = true;
      break;
    case 'error':
      collector.error = chunk.content;
      collector.isComplete = true;
      break;
  }
}

export async function collectStream(stream: AsyncIterable<StreamChunk>): Promise<StreamCollector> {
  const collector = createStreamCollector();
  for await (const chunk of stream) {
    processChunk(collector, chunk);
  }
  return collector;
}
