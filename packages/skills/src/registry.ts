import type { Skill, SkillRegistry, SkillTrigger } from './types.js';

export class DefaultSkillRegistry implements SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    if (this.skills.has(skill.id)) {
      throw new Error(`Skill "${skill.id}" is already registered`);
    }
    this.skills.set(skill.id, skill);
  }

  unregister(id: string): void {
    this.skills.delete(id);
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  findByTrigger(input: string): Skill[] {
    const matches: Skill[] = [];

    for (const skill of this.skills.values()) {
      if (!skill.triggers) continue;

      for (const trigger of skill.triggers) {
        if (this.matchesTrigger(trigger, input)) {
          matches.push(skill);
          break;
        }
      }
    }

    return matches;
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }

  count(): number {
    return this.skills.size;
  }

  clear(): void {
    this.skills.clear();
  }

  private matchesTrigger(trigger: SkillTrigger, input: string): boolean {
    const normalizedInput = input.trim().toLowerCase();

    switch (trigger.type) {
      case 'command': {
        const command = trigger.pattern.toLowerCase();
        return normalizedInput === command || normalizedInput.startsWith(command + ' ');
      }

      case 'keyword': {
        const keywords = trigger.pattern.toLowerCase().split(',').map(k => k.trim());
        return keywords.some(keyword => normalizedInput.includes(keyword));
      }

      case 'regex': {
        try {
          const regex = new RegExp(trigger.pattern, 'i');
          return regex.test(input);
        } catch {
          return false;
        }
      }

      case 'schedule':
        // Schedule triggers are not matched against user input;
        // they are handled by a separate scheduler component.
        return false;

      case 'event':
        // Event triggers are matched against event names, not user input.
        return normalizedInput === trigger.pattern.toLowerCase();

      default:
        return false;
    }
  }
}
