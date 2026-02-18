import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from 'agent-toolkit/logger';
import { ChatMessage } from '../llm/llm-provider.js';
import { HistoryStore } from './history-store.js';

const log = createLogger('history');

export class FileHistoryStore implements HistoryStore {
  private dataDir: string;
  private maxMessages: number;

  constructor(dataDir: string = './data/history', maxMessages: number = 100) {
    this.dataDir = dataDir;
    this.maxMessages = maxMessages;
  }

  private getFilePath(channelId: string, conversationId: string): string {
    const dir = join(this.dataDir, channelId);
    mkdirSync(dir, { recursive: true });
    return join(dir, `${conversationId}.json`);
  }

  async getMessages(
    channelId: string,
    conversationId: string,
    limit?: number,
  ): Promise<ChatMessage[]> {
    const filePath = this.getFilePath(channelId, conversationId);
    if (!existsSync(filePath)) return [];

    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as ChatMessage[];
      const max = limit ?? this.maxMessages;
      return data.slice(-max);
    } catch (err) {
      log.error('Failed to read history', {
        channelId,
        conversationId,
        error: String(err),
      });
      return [];
    }
  }

  async addMessage(
    channelId: string,
    conversationId: string,
    message: ChatMessage,
  ): Promise<void> {
    const messages = await this.getMessages(channelId, conversationId);
    messages.push(message);
    const trimmed = messages.slice(-this.maxMessages);
    const filePath = this.getFilePath(channelId, conversationId);
    writeFileSync(filePath, JSON.stringify(trimmed, null, 2));
  }

  async clear(channelId: string, conversationId: string): Promise<void> {
    const filePath = this.getFilePath(channelId, conversationId);
    writeFileSync(filePath, '[]');
    log.info('History cleared', { channelId, conversationId });
  }
}
