import { SkillDefinition } from '../../types/skill.js';

export const clearSkill: SkillDefinition = {
  name: 'clear',
  description: 'Reset conversation history',
  userInvocable: true,
  source: 'builtin',
  // execute is wired by agent-service to access history store
};
