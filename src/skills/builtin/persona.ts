import { SkillDefinition } from '../../types/skill.js';

export const personaSkill: SkillDefinition = {
  name: 'persona',
  description: 'Show or change agent persona',
  userInvocable: true,
  source: 'builtin',
  // execute is wired by agent-service to access config
};
