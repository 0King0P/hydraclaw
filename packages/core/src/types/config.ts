export interface HydraClawConfig {
  gateway: GatewayConfig;
  agent: AgentConfig;
  providers: Record<string, ProviderConfig>;
  channels: Record<string, ChannelConfig>;
  tools: Record<string, ToolConfig>;
  store: StoreConfig;
  memory?: MemoryConfig;
  skills?: SkillsConfig;
  extensions?: ExtensionsConfig;
  routing?: RoutingConfig;
  autoReply?: AutoReplyConfig;
  hooks?: HooksConfig;
  cron?: CronConfig;
  voice?: VoiceConfig;
  daemon?: DaemonConfig;
  security?: Record<string, unknown>;
}

export interface GatewayConfig {
  host: string;
  port: number;
  wsPort: number;
  webhookPort?: number;
  auth?: {
    enabled: boolean;
    tokens?: string[];
  };
  rateLimit?: {
    enabled: boolean;
    maxRequests: number;
    windowMs: number;
  };
  discovery?: {
    enabled: boolean;
    nodeId?: string;
  };
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
  routePreference?: 'price' | 'speed' | 'latency';
  dynamicModels?: boolean;
  fallbackModels?: string[];
  httpReferer?: string;
  xTitle?: string;
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

export interface MemoryConfig {
  enabled: boolean;
  embeddingProvider?: string;
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  maxMemories?: number;
  autoMemorize?: boolean;
}

export interface SkillsConfig {
  enabled: boolean;
  directory?: string;
  autoload?: boolean;
}

export interface ExtensionsConfig {
  enabled: boolean;
  directory?: string;
}

export interface RoutingConfig {
  defaultHandler?: string;
  commandPrefix?: string;
  routes?: Array<{
    name: string;
    match: Record<string, unknown>;
    handler: Record<string, unknown>;
  }>;
}

export interface AutoReplyConfig {
  enabled: boolean;
  rules?: Array<Record<string, unknown>>;
}

export interface HooksConfig {
  enabled: boolean;
  rateLimit?: { maxPerMinute: number };
  contentFilter?: { patterns: string[] };
}

export interface CronConfig {
  enabled: boolean;
  jobs?: Array<{
    name: string;
    schedule: string;
    action: string;
  }>;
}

export interface VoiceConfig {
  tts?: {
    enabled: boolean;
    provider?: string;
    voice?: string;
  };
  stt?: {
    enabled: boolean;
    provider?: string;
  };
}

export interface DaemonConfig {
  pidFile?: string;
  logFile?: string;
  autoRestart?: boolean;
  healthCheckInterval?: number;
}
