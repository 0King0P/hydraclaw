import OpenAI from 'openai';
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

const OPENAI_MODELS: ModelInfo[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 2.5,
    outputCostPer1M: 10,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 10,
    outputCostPer1M: 30,
  },
  {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 30,
    outputCostPer1M: 60,
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'openai',
    contextWindow: 16385,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.5,
    outputCostPer1M: 1.5,
  },
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 15,
    outputCostPer1M: 60,
  },
  {
    id: 'o1-mini',
    name: 'o1 Mini',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 65536,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    inputCostPer1M: 3,
    outputCostPer1M: 12,
  },
  {
    id: 'o3-mini',
    name: 'o3 Mini',
    provider: 'openai',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 1.1,
    outputCostPer1M: 4.4,
  },
];

// o1/o3 reasoning models that don't support certain params
const REASONING_MODELS = new Set(['o1', 'o1-mini', 'o3-mini']);

type OpenAIRole = 'system' | 'user' | 'assistant' | 'tool';

interface OpenAIImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

interface OpenAITextContentPart {
  type: 'text';
  text: string;
}

type OpenAIContentPart = OpenAITextContentPart | OpenAIImageContentPart;

interface OpenAIMessage {
  role: OpenAIRole;
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

function buildImageUrl(image: ImageInput): string {
  if (image.type === 'url') {
    return image.data;
  }
  const mimeType = image.mimeType ?? 'image/png';
  return `data:${mimeType};base64,${image.data}`;
}

function convertMessages(messages: ChatMessage[], systemPrompt?: string): OpenAIMessage[] {
  const openaiMessages: OpenAIMessage[] = [];

  // Add system prompt as first message if provided
  if (systemPrompt) {
    openaiMessages.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  for (const msg of messages) {
    if (msg.role === 'system') {
      // If we already added one from systemPrompt, skip duplicates.
      // If not, add it.
      if (!systemPrompt) {
        openaiMessages.push({
          role: 'system',
          content: msg.content,
        });
      }
      continue;
    }

    if (msg.role === 'tool') {
      openaiMessages.push({
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId ?? '',
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const assistantMsg: OpenAIMessage = {
        role: 'assistant',
        content: msg.content || null,
      };

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }

      openaiMessages.push(assistantMsg);
      continue;
    }

    // User messages - may contain images
    if ((msg.images && msg.images.length > 0)) {
      const contentParts: OpenAIContentPart[] = [];
      for (const image of msg.images) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: buildImageUrl(image) },
        });
      }
      if (msg.content) {
        contentParts.push({ type: 'text', text: msg.content });
      }
      openaiMessages.push({ role: 'user', content: contentParts });
      continue;
    }

    openaiMessages.push({
      role: 'user',
      content: msg.content,
      ...(msg.name ? { name: msg.name } : {}),
    });
  }

  return openaiMessages;
}

function convertTools(tools: ToolDefinitionForProvider[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function mapFinishReason(reason: string | null): CompletionResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'stop';
    default:
      return 'stop';
  }
}

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';
  readonly version = '1.0.0';
  readonly type = 'provider' as const;

  private client!: OpenAI;
  private logger!: Logger;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: this.id });

    const apiKey = ctx.config.apiKey as string | undefined;
    if (!apiKey) {
      throw new Error('OpenAI provider requires config.apiKey');
    }

    const baseURL = ctx.config.baseUrl as string | undefined;

    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });

    this.logger.info('OpenAI provider initialized');
  }

  async destroy(): Promise<void> {
    this.logger.info('OpenAI provider destroyed');
  }

  models(): ModelInfo[] {
    return OPENAI_MODELS;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const isReasoning = REASONING_MODELS.has(req.model);
    const messages = convertMessages(req.messages, req.systemPrompt);

    // Handle request-level images by appending to last user message
    if (req.images && req.images.length > 0) {
      const lastUserIdx = messages.findLastIndex((m) => m.role === 'user');
      if (lastUserIdx >= 0) {
        const lastUser = messages[lastUserIdx];
        const imageParts: OpenAIContentPart[] = req.images.map((img) => ({
          type: 'image_url' as const,
          image_url: { url: buildImageUrl(img) },
        }));
        if (typeof lastUser.content === 'string') {
          messages[lastUserIdx] = {
            ...lastUser,
            content: [...imageParts, { type: 'text', text: lastUser.content }],
          };
        } else if (Array.isArray(lastUser.content)) {
          messages[lastUserIdx] = {
            ...lastUser,
            content: [...imageParts, ...lastUser.content],
          };
        }
      }
    }

    const params: OpenAI.ChatCompletionCreateParams = {
      model: req.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      // Reasoning models use max_completion_tokens instead of max_tokens
      ...(isReasoning
        ? (req.maxTokens !== undefined ? { max_completion_tokens: req.maxTokens } : {})
        : (req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {})),
      // Reasoning models don't support temperature, top_p, frequency/presence penalty
      ...(!isReasoning && req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(!isReasoning && req.topP !== undefined ? { top_p: req.topP } : {}),
      ...(!isReasoning && req.frequencyPenalty !== undefined ? { frequency_penalty: req.frequencyPenalty } : {}),
      ...(!isReasoning && req.presencePenalty !== undefined ? { presence_penalty: req.presencePenalty } : {}),
      ...(req.stop ? { stop: req.stop } : {}),
      ...(req.tools && req.tools.length > 0 ? { tools: convertTools(req.tools) } : {}),
      ...(req.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
    };

    this.logger.debug('OpenAI complete request: model=%s, messages=%d', req.model, messages.length);

    const response = await this.client.chat.completions.create(params);

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    const usage: TokenUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    return {
      content: choice.message.content ?? '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      model: response.model,
      finishReason: mapFinishReason(choice.finish_reason),
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
    const isReasoning = REASONING_MODELS.has(req.model);
    const messages = convertMessages(req.messages, req.systemPrompt);

    // Handle request-level images
    if (req.images && req.images.length > 0) {
      const lastUserIdx = messages.findLastIndex((m) => m.role === 'user');
      if (lastUserIdx >= 0) {
        const lastUser = messages[lastUserIdx];
        const imageParts: OpenAIContentPart[] = req.images.map((img) => ({
          type: 'image_url' as const,
          image_url: { url: buildImageUrl(img) },
        }));
        if (typeof lastUser.content === 'string') {
          messages[lastUserIdx] = {
            ...lastUser,
            content: [...imageParts, { type: 'text', text: lastUser.content }],
          };
        } else if (Array.isArray(lastUser.content)) {
          messages[lastUserIdx] = {
            ...lastUser,
            content: [...imageParts, ...lastUser.content],
          };
        }
      }
    }

    const params: OpenAI.ChatCompletionCreateParams = {
      model: req.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      stream: true,
      // Include stream_options to get usage in streaming mode
      stream_options: { include_usage: true },
      ...(isReasoning
        ? (req.maxTokens !== undefined ? { max_completion_tokens: req.maxTokens } : {})
        : (req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {})),
      ...(!isReasoning && req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(!isReasoning && req.topP !== undefined ? { top_p: req.topP } : {}),
      ...(!isReasoning && req.frequencyPenalty !== undefined ? { frequency_penalty: req.frequencyPenalty } : {}),
      ...(!isReasoning && req.presencePenalty !== undefined ? { presence_penalty: req.presencePenalty } : {}),
      ...(req.stop ? { stop: req.stop } : {}),
      ...(req.tools && req.tools.length > 0 ? { tools: convertTools(req.tools) } : {}),
      ...(req.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
    };

    this.logger.debug('OpenAI stream request: model=%s, messages=%d', req.model, messages.length);

    const stream = await this.client.chat.completions.create(params);

    // Track active tool calls across deltas
    const activeToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let finalUsage: TokenUsage | undefined;
    let finalFinishReason: string | undefined;

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];

      // Usage info comes in the final chunk (with stream_options.include_usage)
      if (chunk.usage) {
        finalUsage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens ?? 0,
        };
      }

      if (!choice) {
        continue;
      }

      if (choice.finish_reason) {
        finalFinishReason = choice.finish_reason;
      }

      const delta = choice.delta;
      if (!delta) {
        continue;
      }

      // Text content delta
      if (delta.content) {
        yield {
          type: 'text',
          content: delta.content,
          delta: delta.content,
        };
      }

      // Tool call deltas
      if (delta.tool_calls) {
        for (const tcDelta of delta.tool_calls) {
          const idx = tcDelta.index;

          if (!activeToolCalls.has(idx)) {
            // New tool call starting
            activeToolCalls.set(idx, {
              id: tcDelta.id ?? '',
              name: tcDelta.function?.name ?? '',
              arguments: tcDelta.function?.arguments ?? '',
            });

            if (tcDelta.id) {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: tcDelta.id,
                  name: tcDelta.function?.name ?? '',
                  arguments: tcDelta.function?.arguments ?? '',
                },
              };
            }
          } else {
            // Continuation of existing tool call
            const tc = activeToolCalls.get(idx)!;
            if (tcDelta.function?.arguments) {
              tc.arguments += tcDelta.function.arguments;
              yield {
                type: 'tool_call_delta',
                toolCall: {
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments,
                },
                delta: tcDelta.function.arguments,
              };
            }
          }
        }
      }
    }

    // Yield the done chunk with accumulated usage
    yield {
      type: 'done',
      usage: finalUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: finalFinishReason ?? 'stop',
    };
  }
}

export default OpenAIProvider;
