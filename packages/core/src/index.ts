// Types
export type { Plugin, PluginContext, PluginManifest, PluginRegistry, PluginType } from './types/plugin.js';
export type { AIProvider, ModelInfo, CompletionRequest, CompletionResponse, StreamChunk, TokenUsage, ToolDefinitionForProvider } from './types/provider.js';
export type { Channel, ChannelCapabilities } from './types/channel.js';
export { DEFAULT_CAPABILITIES } from './types/channel.js';
export type { Tool, ToolDefinition, ToolCall, ToolResult, ToolExecutionGuard, JSONSchema } from './types/tool.js';
export type { ChatMessage, InboundMessage, OutboundMessage, ImageInput, FileAttachment, ToolCallMessage, MessageEvent } from './types/message.js';
export type { HydraClawConfig, GatewayConfig, AgentConfig, ProviderConfig, ChannelConfig, ToolConfig, StoreConfig } from './types/config.js';

// Core modules
export { Container } from './container.js';
export { MessageBus, Events } from './message-bus.js';
export type { EventHandler } from './message-bus.js';
export { createLogger } from './logger.js';
export type { Logger, LogLevel } from './logger.js';
export { loadConfig } from './config.js';
export { DefaultPluginRegistry, PluginLoader } from './plugin-loader.js';
