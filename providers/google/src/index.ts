import {
  GoogleGenerativeAI,
  type GenerativeModel,
  type Content,
  type Part,
  type GenerateContentRequest,
} from '@google/generative-ai';
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

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const GOOGLE_MODELS: ModelInfo[] = [
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
  },
  {
    id: 'gemini-2.0-flash-lite',
    name: 'Gemini 2.0 Flash Lite',
    provider: 'google',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.3,
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    contextWindow: 2097152,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 1.25,
    outputCostPer1M: 5,
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'google',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.3,
  },
];

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

function buildImagePart(image: ImageInput): Part {
  if (image.type === 'base64') {
    return {
      inlineData: {
        mimeType: image.mimeType ?? 'image/png',
        data: image.data,
      },
    };
  }
  // URL-based images – Gemini supports fileData for GCS URIs but for
  // general HTTP URLs we need to inline-encode. The caller is expected
  // to provide base64 for best compatibility; we pass the URL as-is
  // for file URIs.
  return {
    fileData: {
      mimeType: image.mimeType ?? 'image/png',
      fileUri: image.data,
    },
  };
}

function convertMessages(
  messages: ChatMessage[],
  systemPrompt?: string,
): { systemInstruction: string | undefined; contents: Content[] } {
  let systemInstruction: string | undefined = systemPrompt;
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (!systemInstruction) {
        systemInstruction = msg.content;
      }
      continue;
    }

    if (msg.role === 'tool') {
      // Tool results are sent as "function" role in Gemini
      contents.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: msg.name ?? 'tool',
              response: { content: msg.content },
            },
          },
        ],
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: Part[] = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.arguments) as Record<string, unknown>;
          } catch {
            // ignore parse error
          }
          parts.push({
            functionCall: { name: tc.name, args },
          });
        }
      }
      contents.push({ role: 'model', parts });
      continue;
    }

    // User message
    const parts: Part[] = [];
    if (msg.images && msg.images.length > 0) {
      for (const image of msg.images) {
        parts.push(buildImagePart(image));
      }
    }
    if (msg.content) {
      parts.push({ text: msg.content });
    }
    contents.push({ role: 'user', parts });
  }

  return { systemInstruction, contents };
}

function convertTools(tools: ToolDefinitionForProvider[]): unknown[] {
  const declarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  return [{ functionDeclarations: declarations }];
}

function mapFinishReason(reason: string | undefined): CompletionResponse['finishReason'] {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'TOOL_CALLS':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class GoogleProvider implements AIProvider {
  readonly id = 'google';
  readonly name = 'Google Gemini';
  readonly version = '1.0.0';
  readonly type = 'provider' as const;

  private genAI!: GoogleGenerativeAI;
  private logger!: Logger;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: this.id });

    const apiKey = ctx.config.apiKey as string | undefined;
    if (!apiKey) {
      throw new Error('Google provider requires config.apiKey');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);

    this.logger.info('Google Gemini provider initialized');
  }

  async destroy(): Promise<void> {
    this.logger.info('Google Gemini provider destroyed');
  }

  models(): ModelInfo[] {
    return GOOGLE_MODELS;
  }

  private getModel(req: CompletionRequest): GenerativeModel {
    const tools = req.tools && req.tools.length > 0 ? convertTools(req.tools) : undefined;

    const modelParams: Record<string, unknown> = {
      model: req.model,
      generationConfig: {
        ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.topP !== undefined ? { topP: req.topP } : {}),
        ...(req.stop ? { stopSequences: req.stop } : {}),
        ...(req.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
      },
      ...(tools ? { tools } : {}),
    };

    return this.genAI.getGenerativeModel(modelParams as unknown as Parameters<GoogleGenerativeAI['getGenerativeModel']>[0]);
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const { systemInstruction, contents } = convertMessages(req.messages, req.systemPrompt);
    const model = this.getModel(req);

    // Append request-level images to last user content
    if (req.images && req.images.length > 0) {
      const lastUserIdx = contents.findLastIndex((c) => c.role === 'user');
      if (lastUserIdx >= 0) {
        const imageParts: Part[] = req.images.map(buildImagePart);
        contents[lastUserIdx].parts = [...imageParts, ...contents[lastUserIdx].parts];
      }
    }

    const request: GenerateContentRequest = {
      contents,
      ...(systemInstruction ? { systemInstruction: { role: 'user', parts: [{ text: systemInstruction }] } } : {}),
    };

    this.logger.debug('Google complete: model=%s, contents=%d', req.model, contents.length);

    const result = await model.generateContent(request);
    const response = result.response;
    const candidate = response.candidates?.[0];

    // Extract text and tool calls
    let textContent = '';
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if ('text' in part && part.text) {
          textContent += part.text;
        }
        if ('functionCall' in part && part.functionCall) {
          toolCalls.push({
            id: `call_${Math.random().toString(36).substring(2, 11)}`,
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args ?? {}),
          });
        }
      }
    }

    const usageMeta = response.usageMetadata;
    const usage: TokenUsage = {
      promptTokens: usageMeta?.promptTokenCount ?? 0,
      completionTokens: usageMeta?.candidatesTokenCount ?? 0,
      totalTokens: usageMeta?.totalTokenCount ?? 0,
    };

    const finishReason = candidate?.finishReason;
    const hasToolCalls = toolCalls.length > 0;

    return {
      content: textContent,
      toolCalls: hasToolCalls ? toolCalls : undefined,
      usage,
      model: req.model,
      finishReason: hasToolCalls ? 'tool_calls' : mapFinishReason(finishReason),
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
    const { systemInstruction, contents } = convertMessages(req.messages, req.systemPrompt);
    const model = this.getModel(req);

    // Append request-level images
    if (req.images && req.images.length > 0) {
      const lastUserIdx = contents.findLastIndex((c) => c.role === 'user');
      if (lastUserIdx >= 0) {
        const imageParts: Part[] = req.images.map(buildImagePart);
        contents[lastUserIdx].parts = [...imageParts, ...contents[lastUserIdx].parts];
      }
    }

    const request: GenerateContentRequest = {
      contents,
      ...(systemInstruction ? { systemInstruction: { role: 'user', parts: [{ text: systemInstruction }] } } : {}),
    };

    this.logger.debug('Google stream: model=%s, contents=%d', req.model, contents.length);

    const result = await model.generateContentStream(request);

    let finalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let toolCallIndex = 0;

    for await (const chunk of result.stream) {
      const candidate = chunk.candidates?.[0];

      if (chunk.usageMetadata) {
        finalUsage = {
          promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          completionTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
        };
      }

      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if ('text' in part && part.text) {
            yield { type: 'text', content: part.text, delta: part.text };
          }
          if ('functionCall' in part && part.functionCall) {
            const id = `call_${Math.random().toString(36).substring(2, 11)}`;
            yield {
              type: 'tool_call',
              toolCall: {
                id,
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args ?? {}),
              },
            };
            toolCallIndex++;
          }
        }
      }
    }

    yield {
      type: 'done',
      usage: finalUsage,
      finishReason: toolCallIndex > 0 ? 'tool_calls' : 'stop',
    };
  }
}

export default GoogleProvider;
