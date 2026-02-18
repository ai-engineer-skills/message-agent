import { SkillDefinition } from '../../types/skill.js';

export const statusSkill: SkillDefinition = {
  name: 'status',
  description: 'Show channel statuses and connection health',
  userInvocable: true,
  source: 'builtin',
  // execute is wired by agent-service to access channel manager
};
