import { SkillDefinition } from '../../types/skill.js';

export const helpSkill: SkillDefinition = {
  name: 'help',
  description: 'List available skills and commands',
  userInvocable: true,
  source: 'builtin',
  execute: async (ctx) => {
    // This is a placeholder — the agent-service wires in the actual registry
    return {
      text: 'Use /help to see available commands. The skill list will be populated by the agent.',
      handled: true,
    };
  },
};
