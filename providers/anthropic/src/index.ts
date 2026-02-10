import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  TokenUsage,
  ToolDefinitionForProvider,
  PluginContext,
  ChatMessage,
  ImageInput,
  Logger,
} from '@hydraclaw/core';

const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 32000,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 15,
    outputCostPer1M: 75,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.8,
    outputCostPer1M: 4,
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.8,
    outputCostPer1M: 4,
  },
];

type AnthropicRole = 'user' | 'assistant';

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

type AnthropicContent = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: AnthropicRole;
  content: string | AnthropicContent[];
}

function buildImageContent(image: ImageInput): AnthropicImageBlock {
  if (image.type === 'base64') {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: (image.mimeType ?? 'image/png') as string,
        data: image.data,
      },
    };
  }
  return {
    type: 'image',
    source: {
      type: 'url',
      url: image.data,
    },
  };
}

function convertMessages(messages: ChatMessage[]): { system: string | undefined; messages: AnthropicMessage[] } {
  let systemPrompt: string | undefined;
  const anthropicMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Anthropic uses a separate system parameter, not a system message
      systemPrompt = msg.content;
      continue;
    }

    if (msg.role === 'tool') {
      // Tool results go as user messages with tool_result content blocks
      anthropicMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId ?? '',
            content: msg.content,
          },
        ],
      });
      continue;
    }

    const role: AnthropicRole = msg.role === 'user' ? 'user' : 'assistant';

    // If assistant message has tool calls, build content blocks
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const contentBlocks: AnthropicContent[] = [];
      if (msg.content) {
        contentBlocks.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = JSON.parse(tc.arguments) as Record<string, unknown>;
        } catch {
          parsedInput = {};
        }
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: parsedInput,
        });
      }
      anthropicMessages.push({ role, content: contentBlocks });
      continue;
    }

    // Handle images in messages
    if (msg.images && msg.images.length > 0) {
      const contentBlocks: AnthropicContent[] = [];
      for (const image of msg.images) {
        contentBlocks.push(buildImageContent(image));
      }
      if (msg.content) {
        contentBlocks.push({ type: 'text', text: msg.content });
      }
      anthropicMessages.push({ role, content: contentBlocks });
      continue;
    }

    // Plain text message
    anthropicMessages.push({ role, content: msg.content });
  }

  return { system: systemPrompt, messages: anthropicMessages };
}

function convertTools(tools: ToolDefinitionForProvider[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
}

function mapFinishReason(stopReason: string | null): CompletionResponse['finishReason'] {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    default:
      return 'stop';
  }
}

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  readonly version = '1.0.0';
  readonly type = 'provider' as const;

  private client!: Anthropic;
  private logger!: Logger;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: this.id });

    const apiKey = ctx.config.apiKey as string | undefined;
    if (!apiKey) {
      throw new Error('Anthropic provider requires config.apiKey');
    }

    const baseURL = ctx.config.baseUrl as string | undefined;

    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });

    this.logger.info('Anthropic provider initialized');
  }

  async destroy(): Promise<void> {
    this.logger.info('Anthropic provider destroyed');
  }

  models(): ModelInfo[] {
    return ANTHROPIC_MODELS;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const { system, messages } = convertMessages(req.messages);
    const effectiveSystem = req.systemPrompt ?? system;

    const params: Anthropic.MessageCreateParams = {
      model: req.model,
      messages: messages as Anthropic.MessageParam[],
      max_tokens: req.maxTokens ?? 4096,
      ...(effectiveSystem ? { system: effectiveSystem } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.topP !== undefined ? { top_p: req.topP } : {}),
      ...(req.stop ? { stop_sequences: req.stop } : {}),
      ...(req.tools && req.tools.length > 0 ? { tools: convertTools(req.tools) } : {}),
    };

    // Handle request-level images by prepending to the last user message
    if (req.images && req.images.length > 0) {
      const lastUserIdx = (params.messages as AnthropicMessage[]).findLastIndex((m) => m.role === 'user');
      if (lastUserIdx >= 0) {
        const lastUser = (params.messages as AnthropicMessage[])[lastUserIdx];
        const imageBlocks: AnthropicContent[] = req.images.map(buildImageContent);
        if (typeof lastUser.content === 'string') {
          (params.messages as AnthropicMessage[])[lastUserIdx] = {
            role: 'user',
            content: [...imageBlocks, { type: 'text', text: lastUser.content }],
          };
        } else {
          (params.messages as AnthropicMessage[])[lastUserIdx] = {
            role: 'user',
            content: [...imageBlocks, ...lastUser.content],
          };
        }
      }
    }

    this.logger.debug('Anthropic complete request: model=%s, messages=%d', req.model, messages.length);

    const response = await this.client.messages.create(params);

    // Extract text and tool calls from response content blocks
    let textContent = '';
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    const usage: TokenUsage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      model: response.model,
      finishReason: mapFinishReason(response.stop_reason),
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
    const { system, messages } = convertMessages(req.messages);
    const effectiveSystem = req.systemPrompt ?? system;

    const params: Anthropic.MessageCreateParams = {
      model: req.model,
      messages: messages as Anthropic.MessageParam[],
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      ...(effectiveSystem ? { system: effectiveSystem } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.topP !== undefined ? { top_p: req.topP } : {}),
      ...(req.stop ? { stop_sequences: req.stop } : {}),
      ...(req.tools && req.tools.length > 0 ? { tools: convertTools(req.tools) } : {}),
    };

    // Handle request-level images
    if (req.images && req.images.length > 0) {
      const lastUserIdx = (params.messages as AnthropicMessage[]).findLastIndex((m) => m.role === 'user');
      if (lastUserIdx >= 0) {
        const lastUser = (params.messages as AnthropicMessage[])[lastUserIdx];
        const imageBlocks: AnthropicContent[] = req.images.map(buildImageContent);
        if (typeof lastUser.content === 'string') {
          (params.messages as AnthropicMessage[])[lastUserIdx] = {
            role: 'user',
            content: [...imageBlocks, { type: 'text', text: lastUser.content }],
          };
        } else {
          (params.messages as AnthropicMessage[])[lastUserIdx] = {
            role: 'user',
            content: [...imageBlocks, ...lastUser.content],
          };
        }
      }
    }

    this.logger.debug('Anthropic stream request: model=%s, messages=%d', req.model, messages.length);

    const stream = this.client.messages.stream(params as Anthropic.MessageStreamParams);

    // Track active tool calls for assembling deltas
    const activeToolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_start': {
          const block = (event as unknown as { content_block: AnthropicContentBlock }).content_block;
          if (block.type === 'tool_use') {
            const index = (event as unknown as { index: number }).index;
            activeToolCalls.set(index, {
              id: block.id ?? '',
              name: block.name ?? '',
              arguments: '',
            });
            yield {
              type: 'tool_call',
              toolCall: {
                id: block.id ?? '',
                name: block.name ?? '',
                arguments: '',
              },
            };
          }
          break;
        }

        case 'content_block_delta': {
          const delta = (event as unknown as { delta: { type: string; text?: string; partial_json?: string } }).delta;
          const index = (event as unknown as { index: number }).index;

          if (delta.type === 'text_delta' && delta.text) {
            yield {
              type: 'text',
              content: delta.text,
              delta: delta.text,
            };
          } else if (delta.type === 'input_json_delta' && delta.partial_json) {
            const tc = activeToolCalls.get(index);
            if (tc) {
              tc.arguments += delta.partial_json;
              yield {
                type: 'tool_call_delta',
                toolCall: {
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments,
                },
                delta: delta.partial_json,
              };
            }
          } else if (delta.type === 'thinking_delta' && delta.text) {
            yield {
              type: 'thinking',
              content: delta.text,
              delta: delta.text,
            };
          }
          break;
        }

        case 'message_delta': {
          const messageDelta = event as unknown as {
            delta: { stop_reason?: string };
            usage?: { output_tokens: number };
          };
          // Message is ending
          break;
        }

        case 'message_stop': {
          // Final event - we'll yield done after the loop
          break;
        }
      }
    }

    // Get final message for usage info
    const finalMessage = await stream.finalMessage();
    const usage: TokenUsage = {
      promptTokens: finalMessage.usage.input_tokens,
      completionTokens: finalMessage.usage.output_tokens,
      totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
    };

    yield {
      type: 'done',
      usage,
      finishReason: mapFinishReason(finalMessage.stop_reason),
    };
  }
}

export default AnthropicProvider;
