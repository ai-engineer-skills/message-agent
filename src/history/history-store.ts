import { ChatMessage } from '../llm/llm-provider.js';

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
  ): Promise<void>;

  clear(channelId: string, conversationId: string): Promise<void>;
}
