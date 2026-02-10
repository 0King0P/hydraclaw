import type { Plugin } from './plugin.js';

export interface Tool extends Plugin {
  type: 'tool';
  definitions(): ToolDefinition[];
  execute(call: ToolCall): Promise<ToolResult>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export type ToolExecutionGuard = (call: ToolCall) => Promise<{
  action: 'allow' | 'warn' | 'block';
  reason?: string;
}>;

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema & { description?: string }>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}
