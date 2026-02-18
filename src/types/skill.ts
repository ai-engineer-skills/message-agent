import { NormalizedMessage } from './message.js';

export interface SkillDefinition {
  name: string;
  description: string;
  userInvocable: boolean;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  allowedTools?: string[];
  context?: 'fork' | 'inherit';
  instructions?: string;
  source: 'builtin' | 'skillmd';
  execute?: (ctx: SkillContext) => Promise<SkillResult>;
}

export interface SkillContext {
  message: NormalizedMessage;
  args: string;
  channelId: string;
  conversationId: string;
}

export interface SkillResult {
  text: string;
  handled: boolean;
}
