export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  triggers?: SkillTrigger[];
  tools?: SkillToolDefinition[];
  systemPromptAddition?: string;
  init?(config: Record<string, unknown>): Promise<void>;
  destroy?(): Promise<void>;
}

export interface SkillTrigger {
  type: 'command' | 'keyword' | 'regex' | 'schedule' | 'event';
  pattern: string;
  description?: string;
}

export interface SkillToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
  repository?: string;
  configSchema?: Record<string, unknown>;
}

export interface SkillRegistry {
  register(skill: Skill): void;
  unregister(id: string): void;
  get(id: string): Skill | undefined;
  getAll(): Skill[];
  findByTrigger(input: string): Skill[];
}
