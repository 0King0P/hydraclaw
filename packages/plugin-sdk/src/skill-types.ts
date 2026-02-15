/**
 * Skill types mirrored from the skills package for use in the plugin SDK
 * without creating a hard dependency on @hydraclaw/skills.
 */

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
