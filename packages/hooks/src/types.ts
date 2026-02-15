export type HookPhase = 'before' | 'after';

export type HookEvent =
  | 'message:receive'
  | 'message:send'
  | 'agent:run'
  | 'agent:complete'
  | 'tool:execute'
  | 'tool:result'
  | 'channel:connect'
  | 'channel:disconnect'
  | 'gateway:start'
  | 'gateway:stop'
  | 'config:reload'
  | 'session:create'
  | 'session:destroy';

export interface HookDefinition {
  id: string;
  event: HookEvent;
  phase: HookPhase;
  priority: number;
  handler: HookHandler;
  enabled: boolean;
}

export type HookHandler = (context: HookContext) => Promise<HookResult>;

export interface HookContext {
  event: HookEvent;
  phase: HookPhase;
  data: Record<string, unknown>;
  metadata: { timestamp: number; hookId: string };
}

export interface HookResult {
  proceed: boolean;
  data?: Record<string, unknown>;
  reason?: string;
}
