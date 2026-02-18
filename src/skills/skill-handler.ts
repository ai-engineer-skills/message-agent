import { createLogger } from 'agent-toolkit/logger';
import { NormalizedMessage } from '../types/message.js';
import { SkillContext, SkillResult } from '../types/skill.js';
import { SkillRegistry } from './skill-registry.js';

const log = createLogger('skills:handler');

export interface SkillDispatchResult {
  handled: boolean;
  result?: SkillResult;
  skillName?: string;
  args?: string;
  instructions?: string;
}

export class SkillHandler {
  constructor(private registry: SkillRegistry) {}

  parseSlashCommand(text: string): { name: string; args: string } | null {
    const match = text.match(/^\/(\S+)\s*(.*)?$/s);
    if (!match) return null;
    return { name: match[1], args: (match[2] ?? '').trim() };
  }

  async dispatch(message: NormalizedMessage): Promise<SkillDispatchResult> {
    const parsed = this.parseSlashCommand(message.text);
    if (!parsed) return { handled: false };

    const skill = this.registry.get(parsed.name);
    if (!skill) return { handled: false };

    if (!skill.userInvocable) {
      return { handled: false };
    }

    log.info('Dispatching skill', { skill: parsed.name, args: parsed.args });

    // Builtin programmatic skills
    if (skill.execute) {
      const ctx: SkillContext = {
        message,
        args: parsed.args,
        channelId: message.channelId,
        conversationId: message.conversationId,
      };
      const result = await skill.execute(ctx);
      return { handled: true, result, skillName: parsed.name };
    }

    // SKILL.md-based skills — return instructions for LLM call
    if (skill.instructions) {
      const instructions = skill.instructions.replace(
        /\$ARGUMENTS/g,
        parsed.args || '(no arguments provided)',
      );
      return {
        handled: true,
        skillName: parsed.name,
        args: parsed.args,
        instructions,
      };
    }

    return { handled: false };
  }
}
