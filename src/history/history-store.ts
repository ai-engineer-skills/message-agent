import { ChatMessage } from '../llm/llm-provider.js';
import { MessageMetadata } from '../storage/types.js';

export interface HistoryStore {
  getMessages(
    channelId: string,
    conversationId: string,
    limit?: number,
  ): Promise<ChatMessage[]>;

  addMessage(
    channelId: string,
    conversationId: string,
    message: ChatMessage,
    metadata?: MessageMetadata,
  ): Promise<void>;

  clear(channelId: string, conversationId: string): Promise<void>;
}
