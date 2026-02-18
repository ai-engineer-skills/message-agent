import { SkillDefinition } from '../../types/skill.js';

export const retrySkill: SkillDefinition = {
  name: 'retry',
  description: 'Re-verify and iterate on last response',
  userInvocable: true,
  source: 'builtin',
  // execute is wired by agent-service to access verification pipeline
};
