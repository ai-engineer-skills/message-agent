import { createLogger } from 'agent-toolkit/logger';
import { SkillDefinition } from '../types/skill.js';

const log = createLogger('skills:registry');

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
    log.debug('Skill registered', { name: skill.name, source: skill.source });
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  getUserInvocable(): SkillDefinition[] {
    return this.getAll().filter((s) => s.userInvocable);
  }

  getForLLM(): SkillDefinition[] {
    return this.getAll().filter((s) => !s.disableModelInvocation);
  }

  getFiltered(enabledSkills?: string[]): SkillDefinition[] {
    if (!enabledSkills) return this.getAll();
    return this.getAll().filter((s) => enabledSkills.includes(s.name));
  }
}
