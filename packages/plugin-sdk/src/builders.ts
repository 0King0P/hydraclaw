/**
 * Fluent builder pattern classes for creating HydraClaw plugins.
 */

import type {
  AIProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  PluginContext,
  Channel,
  ChannelCapabilities,
  InboundMessage,
  OutboundMessage,
  Tool,
  ToolDefinition,
  ToolCall,
  ToolResult,
} from '@hydraclaw/core';
import { DEFAULT_CAPABILITIES } from '@hydraclaw/core';

// Re-export Skill types from the skills package convention
import type { Skill, SkillTrigger, SkillToolDefinition } from './skill-types.js';

// ---------------------------------------------------------------------------
// ProviderBuilder
// ---------------------------------------------------------------------------

type CompleteHandler = (req: CompletionRequest) => Promise<CompletionResponse>;
type StreamHandler = (req: CompletionRequest) => AsyncIterable<StreamChunk>;

/**
 * Fluent builder for creating AI provider plugins.
 *
 * @example
 * ```ts
 * const provider = new ProviderBuilder()
 *   .withId('my-provider')
 *   .withName('My Provider')
 *   .withModels([{ id: 'model-1', name: 'Model 1', provider: 'my-provider', contextWindow: 4096, supportsVision: false, supportsTools: false, supportsStreaming: true }])
 *   .withComplete(async (req) => { ... })
 *   .withStream(async function*(req) { ... })
 *   .build();
 * ```
 */
export class ProviderBuilder {
  private _id = '';
  private _name = '';
  private _version = '1.0.0';
  private _models: ModelInfo[] = [];
  private _completeHandler: CompleteHandler | null = null;
  private _streamHandler: StreamHandler | null = null;
  private _initHandler: ((ctx: PluginContext) => Promise<void>) | null = null;
  private _destroyHandler: (() => Promise<void>) | null = null;

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withName(name: string): this {
    this._name = name;
    return this;
  }

  withVersion(version: string): this {
    this._version = version;
    return this;
  }

  withModels(models: ModelInfo[]): this {
    this._models = models;
    return this;
  }

  withComplete(handler: CompleteHandler): this {
    this._completeHandler = handler;
    return this;
  }

  withStream(handler: StreamHandler): this {
    this._streamHandler = handler;
    return this;
  }

  withInit(handler: (ctx: PluginContext) => Promise<void>): this {
    this._initHandler = handler;
    return this;
  }

  withDestroy(handler: () => Promise<void>): this {
    this._destroyHandler = handler;
    return this;
  }

  build(): AIProvider {
    if (!this._id) throw new Error('Provider id is required');
    if (!this._name) throw new Error('Provider name is required');
    if (!this._completeHandler) throw new Error('Complete handler is required');

    const models = this._models;
    const completeHandler = this._completeHandler;
    const streamHandler = this._streamHandler;
    const initHandler = this._initHandler;
    const destroyHandler = this._destroyHandler;

    return {
      id: this._id,
      name: this._name,
      version: this._version,
      type: 'provider' as const,
      models: () => models,
      complete: (req: CompletionRequest) => completeHandler(req),
      stream: streamHandler
        ? (req: CompletionRequest) => streamHandler(req)
        : async function* () {
            yield { type: 'error' as const, content: 'Streaming not supported' };
          },
      init: initHandler ?? (async () => {}),
      destroy: destroyHandler,
    };
  }
}

// ---------------------------------------------------------------------------
// ChannelBuilder
// ---------------------------------------------------------------------------

type MessageHandler = (handler: (message: InboundMessage) => void) => void;
type SendHandler = (target: string, message: OutboundMessage) => Promise<void>;

/**
 * Fluent builder for creating channel plugins.
 *
 * @example
 * ```ts
 * const channel = new ChannelBuilder()
 *   .withId('my-channel')
 *   .withName('My Channel')
 *   .withCapabilities({ text: true, images: true })
 *   .onMessage((handler) => { ... })
 *   .onSend(async (target, msg) => { ... })
 *   .build();
 * ```
 */
export class ChannelBuilder {
  private _id = '';
  private _name = '';
  private _version = '1.0.0';
  private _capabilities: ChannelCapabilities = { ...DEFAULT_CAPABILITIES };
  private _messageHandler: MessageHandler | null = null;
  private _sendHandler: SendHandler | null = null;
  private _startHandler: (() => Promise<void>) | null = null;
  private _stopHandler: (() => Promise<void>) | null = null;
  private _initHandler: ((ctx: PluginContext) => Promise<void>) | null = null;
  private _destroyHandler: (() => Promise<void>) | null = null;

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withName(name: string): this {
    this._name = name;
    return this;
  }

  withVersion(version: string): this {
    this._version = version;
    return this;
  }

  withCapabilities(caps: Partial<ChannelCapabilities>): this {
    this._capabilities = { ...this._capabilities, ...caps };
    return this;
  }

  onMessage(handler: MessageHandler): this {
    this._messageHandler = handler;
    return this;
  }

  onSend(handler: SendHandler): this {
    this._sendHandler = handler;
    return this;
  }

  withStart(handler: () => Promise<void>): this {
    this._startHandler = handler;
    return this;
  }

  withStop(handler: () => Promise<void>): this {
    this._stopHandler = handler;
    return this;
  }

  withInit(handler: (ctx: PluginContext) => Promise<void>): this {
    this._initHandler = handler;
    return this;
  }

  withDestroy(handler: () => Promise<void>): this {
    this._destroyHandler = handler;
    return this;
  }

  build(): Channel {
    if (!this._id) throw new Error('Channel id is required');
    if (!this._name) throw new Error('Channel name is required');
    if (!this._sendHandler) throw new Error('Send handler is required');

    const sendHandler = this._sendHandler;
    const messageHandler = this._messageHandler;
    const startHandler = this._startHandler;
    const stopHandler = this._stopHandler;
    const initHandler = this._initHandler;
    const destroyHandler = this._destroyHandler;

    return {
      id: this._id,
      name: this._name,
      version: this._version,
      type: 'channel' as const,
      capabilities: this._capabilities,
      start: startHandler ?? (async () => {}),
      stop: stopHandler ?? (async () => {}),
      send: (target: string, message: OutboundMessage) => sendHandler(target, message),
      onMessage: messageHandler ?? undefined,
      init: initHandler ?? (async () => {}),
      destroy: destroyHandler,
    };
  }
}

// ---------------------------------------------------------------------------
// ToolBuilder
// ---------------------------------------------------------------------------

type ExecuteHandler = (call: ToolCall) => Promise<ToolResult>;

/**
 * Fluent builder for creating tool plugins.
 *
 * @example
 * ```ts
 * const tool = new ToolBuilder()
 *   .withId('my-tool')
 *   .withName('My Tool')
 *   .addDefinition({ name: 'doSomething', description: 'Does something', parameters: { type: 'object', properties: {} } })
 *   .onExecute(async (call) => ({ toolCallId: call.id, content: 'done' }))
 *   .build();
 * ```
 */
export class ToolBuilder {
  private _id = '';
  private _name = '';
  private _version = '1.0.0';
  private _definitions: ToolDefinition[] = [];
  private _executeHandler: ExecuteHandler | null = null;
  private _initHandler: ((ctx: PluginContext) => Promise<void>) | null = null;
  private _destroyHandler: (() => Promise<void>) | null = null;

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withName(name: string): this {
    this._name = name;
    return this;
  }

  withVersion(version: string): this {
    this._version = version;
    return this;
  }

  addDefinition(def: ToolDefinition): this {
    this._definitions.push(def);
    return this;
  }

  onExecute(handler: ExecuteHandler): this {
    this._executeHandler = handler;
    return this;
  }

  withInit(handler: (ctx: PluginContext) => Promise<void>): this {
    this._initHandler = handler;
    return this;
  }

  withDestroy(handler: () => Promise<void>): this {
    this._destroyHandler = handler;
    return this;
  }

  build(): Tool {
    if (!this._id) throw new Error('Tool id is required');
    if (!this._name) throw new Error('Tool name is required');
    if (!this._executeHandler) throw new Error('Execute handler is required');

    const definitions = this._definitions;
    const executeHandler = this._executeHandler;
    const initHandler = this._initHandler;
    const destroyHandler = this._destroyHandler;

    return {
      id: this._id,
      name: this._name,
      version: this._version,
      type: 'tool' as const,
      definitions: () => definitions,
      execute: (call: ToolCall) => executeHandler(call),
      init: initHandler ?? (async () => {}),
      destroy: destroyHandler,
    };
  }
}

// ---------------------------------------------------------------------------
// SkillBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for creating skills.
 *
 * @example
 * ```ts
 * const skill = new SkillBuilder()
 *   .withId('my-skill')
 *   .withName('My Skill')
 *   .withDescription('Does useful things')
 *   .addTrigger({ type: 'command', pattern: '/myskill', description: 'Trigger my skill' })
 *   .addTool({ name: 'myAction', description: 'Run action', parameters: {}, handler: async () => 'done' })
 *   .withSystemPrompt('You are a helpful assistant with my skill.')
 *   .build();
 * ```
 */
export class SkillBuilder {
  private _id = '';
  private _name = '';
  private _description = '';
  private _version = '1.0.0';
  private _author?: string;
  private _triggers: SkillTrigger[] = [];
  private _tools: SkillToolDefinition[] = [];
  private _systemPrompt?: string;
  private _initHandler: ((config: Record<string, unknown>) => Promise<void>) | null = null;
  private _destroyHandler: (() => Promise<void>) | null = null;

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withName(name: string): this {
    this._name = name;
    return this;
  }

  withDescription(desc: string): this {
    this._description = desc;
    return this;
  }

  withVersion(version: string): this {
    this._version = version;
    return this;
  }

  withAuthor(author: string): this {
    this._author = author;
    return this;
  }

  addTrigger(trigger: SkillTrigger): this {
    this._triggers.push(trigger);
    return this;
  }

  addTool(tool: SkillToolDefinition): this {
    this._tools.push(tool);
    return this;
  }

  withSystemPrompt(prompt: string): this {
    this._systemPrompt = prompt;
    return this;
  }

  withInit(handler: (config: Record<string, unknown>) => Promise<void>): this {
    this._initHandler = handler;
    return this;
  }

  withDestroy(handler: () => Promise<void>): this {
    this._destroyHandler = handler;
    return this;
  }

  build(): Skill {
    if (!this._id) throw new Error('Skill id is required');
    if (!this._name) throw new Error('Skill name is required');
    if (!this._description) throw new Error('Skill description is required');

    const initHandler = this._initHandler;
    const destroyHandler = this._destroyHandler;

    return {
      id: this._id,
      name: this._name,
      description: this._description,
      version: this._version,
      author: this._author,
      triggers: this._triggers.length > 0 ? this._triggers : undefined,
      tools: this._tools.length > 0 ? this._tools : undefined,
      systemPromptAddition: this._systemPrompt,
      init: initHandler ?? undefined,
      destroy: destroyHandler ?? undefined,
    };
  }
}
