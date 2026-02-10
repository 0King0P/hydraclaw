export interface HydraClawConfig {
  gateway: GatewayConfig;
  agent: AgentConfig;
  providers: Record<string, ProviderConfig>;
  channels: Record<string, ChannelConfig>;
  tools: Record<string, ToolConfig>;
  store: StoreConfig;
  security?: Record<string, unknown>;
}

export interface GatewayConfig {
  host: string;
  port: number;
  wsPort: number;
}

export interface AgentConfig {
  defaultProvider: string;
  defaultModel: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  maxHistory: number;
  failoverProviders?: string[];
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  enabled?: boolean;
  models?: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxOutputTokens?: number;
  }>;
  [key: string]: unknown;
}

export interface ChannelConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

export interface ToolConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

export interface StoreConfig {
  path: string;
  vectorStore: boolean;
}
