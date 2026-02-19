import { NormalizedMessage } from '../types/message.js';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ConversationTask {
  id: string;
  conversationId: string;
  channelId: string;
  originalMessage: NormalizedMessage;
  status: TaskStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export type TaskPipelineRunner = (message: NormalizedMessage) => Promise<void>;
