import { SkillRegistry } from '../skill-registry.js';
import { helpSkill } from './help.js';
import { clearSkill } from './clear.js';
import { statusSkill } from './status.js';
import { personaSkill } from './persona.js';
import { retrySkill } from './retry.js';

export function registerBuiltinSkills(registry: SkillRegistry): void {
  registry.register(helpSkill);
  registry.register(clearSkill);
  registry.register(statusSkill);
  registry.register(personaSkill);
  registry.register(retrySkill);
}
