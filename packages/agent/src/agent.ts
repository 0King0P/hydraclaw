import type {
  AIProvider,
  ChatMessage,
  InboundMessage,
  CompletionRequest,
  StreamChunk,
  ToolCall,
  ToolResult,
  ToolExecutionGuard,
  Logger,
  MessageBus,
  AgentConfig,
} from '@hydraclaw/core';
import { Events } from '@hydraclaw/core';
import type { DefaultPluginRegistry } from '@hydraclaw/core';
import type { Tool, ToolDefinition } from '@hydraclaw/core';
import { ConversationManager } from './conversation.js';
import { createStreamCollector, processChunk } from './streaming.js';

export interface AgentRunOptions {
  message: InboundMessage;
  provider?: AIProvider;
  model?: string;
  onStream?: (chunk: StreamChunk) => void;
}

export interface AgentRunResult {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  model: string;
  provider: string;
}

export class Agent {
  private config: AgentConfig;
  private registry: DefaultPluginRegistry;
  private conversation: ConversationManager;
  private logger: Logger;
  private bus: MessageBus;
  private toolGuard?: ToolExecutionGuard;

  constructor(
    config: AgentConfig,
    registry: DefaultPluginRegistry,
    conversation: ConversationManager,
    logger: Logger,
    bus: MessageBus,
  ) {
    this.config = config;
    this.registry = registry;
    this.conversation = conversation;
    this.logger = logger;
    this.bus = bus;
  }

  setToolGuard(guard: ToolExecutionGuard): void {
    this.toolGuard = guard;
  }

  async run(opts: AgentRunOptions): Promise<AgentRunResult> {
    const { message, onStream } = opts;

    const provider = opts.provider ?? this.resolveProvider();
    const model = opts.model ?? this.config.defaultModel;
    const conversationId = this.conversation.getOrCreateConversation(
      message.channelId,
      message.senderId,
      message.target,
    );

    this.logger.info(`Agent run: provider=${provider.id}, model=${model}, sender=${message.senderId}`);
    await this.bus.emit(Events.AGENT_START, { message, provider: provider.id, model });

    const userMessage: ChatMessage = {
      role: 'user',
      content: message.content,
      images: message.images,
      timestamp: message.timestamp,
    };

    this.conversation.addMessage(conversationId, userMessage);
    const messages = this.conversation.buildMessages(conversationId, userMessage);
    // Remove the last user message since buildMessages already includes history + new message
    // but we've also already added it to history, so just use buildMessages output
    const builtMessages = this.conversation.buildMessages(conversationId, userMessage);

    const tools = this.getToolDefinitions();

    const request: CompletionRequest = {
      model,
      messages: builtMessages.slice(0, -1).concat([userMessage]), // avoid duplicate
      tools: tools.length > 0 ? tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })) : undefined,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    };

    let result: AgentRunResult;

    try {
      result = await this.executeWithToolLoop(provider, request, conversationId, onStream);
    } catch (err) {
      this.logger.error(`Agent run failed: ${err}`);

      // Try failover
      const failoverResult = await this.tryFailover(request, conversationId, onStream, provider.id);
      if (failoverResult) {
        result = failoverResult;
      } else {
        await this.bus.emit(Events.AGENT_ERROR, { error: err, message });
        throw err;
      }
    }

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: result.content,
      toolCalls: result.toolCalls?.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      timestamp: Math.floor(Date.now() / 1000),
    };
    this.conversation.addMessage(conversationId, assistantMessage);

    await this.bus.emit(Events.AGENT_COMPLETE, { result, message });
    return result;
  }

  private async executeWithToolLoop(
    provider: AIProvider,
    request: CompletionRequest,
    conversationId: string,
    onStream?: (chunk: StreamChunk) => void,
    maxIterations: number = 10,
  ): Promise<AgentRunResult> {
    let currentRequest = { ...request };
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      const collector = createStreamCollector();

      for await (const chunk of provider.stream(currentRequest)) {
        processChunk(collector, chunk);
        if (onStream) onStream(chunk);
        await this.bus.emit(Events.AGENT_STREAM, chunk);
      }

      if (collector.error) {
        throw new Error(collector.error);
      }

      if (collector.toolCalls.length === 0) {
        return {
          content: collector.fullText,
          model: request.model,
          provider: provider.id,
        };
      }

      // Execute tool calls
      const toolResults: ToolResult[] = [];
      for (const tc of collector.toolCalls) {
        await this.bus.emit(Events.TOOL_CALL, tc);
        const result = await this.executeTool({
          id: tc.id,
          name: tc.name,
          arguments: JSON.parse(tc.arguments),
        });
        toolResults.push(result);
        await this.bus.emit(Events.TOOL_RESULT, result);
      }

      // Add assistant message with tool calls and tool results to conversation
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: collector.fullText,
        toolCalls: collector.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })),
      };
      currentRequest.messages = [
        ...currentRequest.messages,
        assistantMsg,
        ...toolResults.map(tr => ({
          role: 'tool' as const,
          content: tr.content,
          toolCallId: tr.toolCallId,
        })),
      ];
    }

    return {
      content: 'Max tool iterations reached.',
      model: request.model,
      provider: provider.id,
    };
  }

  private async executeTool(call: ToolCall): Promise<ToolResult> {
    // Security guard check
    if (this.toolGuard) {
      const verdict = await this.toolGuard(call);
      if (verdict.action === 'block') {
        this.logger.warn(`Tool call blocked by security guard: ${call.name} - ${verdict.reason}`);
        return {
          toolCallId: call.id,
          content: `Tool call blocked by security policy: ${verdict.reason}`,
          isError: true,
        };
      }
    }

    for (const [, tool] of this.registry.tools) {
      const t = tool as Tool;
      const defs = t.definitions();
      if (defs.some(d => d.name === call.name)) {
        try {
          return await t.execute(call);
        } catch (err) {
          return {
            toolCallId: call.id,
            content: `Tool error: ${err}`,
            isError: true,
          };
        }
      }
    }
    return {
      toolCallId: call.id,
      content: `Unknown tool: ${call.name}`,
      isError: true,
    };
  }

  private async tryFailover(
    request: CompletionRequest,
    conversationId: string,
    onStream?: (chunk: StreamChunk) => void,
    failedProviderId?: string,
  ): Promise<AgentRunResult | null> {
    const failoverProviders = this.config.failoverProviders ?? [];

    for (const providerId of failoverProviders) {
      if (providerId === failedProviderId) continue;

      const provider = this.registry.getProvider(providerId);
      if (!provider) continue;

      this.logger.info(`Failing over to provider: ${providerId}`);
      await this.bus.emit(Events.PROVIDER_FAILOVER, { from: failedProviderId, to: providerId });

      try {
        return await this.executeWithToolLoop(
          provider as AIProvider,
          request,
          conversationId,
          onStream,
        );
      } catch (err) {
        this.logger.warn(`Failover to ${providerId} also failed: ${err}`);
      }
    }

    return null;
  }

  private resolveProvider(): AIProvider {
    const provider = this.registry.getProvider(this.config.defaultProvider);
    if (!provider) {
      // Try first available
      const first = this.registry.providers.values().next().value;
      if (!first) throw new Error('No AI providers registered');
      return first as AIProvider;
    }
    return provider as AIProvider;
  }

  private getToolDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const [, tool] of this.registry.tools) {
      defs.push(...(tool as Tool).definitions());
    }
    return defs;
  }
}
