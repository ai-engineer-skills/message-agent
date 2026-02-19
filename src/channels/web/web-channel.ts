import { randomUUID } from 'node:crypto';
import { BaseChannel } from '../channel.js';
import { NormalizedMessage, OutgoingMessage } from '../../types/message.js';
import { SSEManager } from '../../web/sse-manager.js';

export class WebChannel extends BaseChannel {
  public readonly type = 'web';
  private sseManager: SSEManager;
  private conversations = new Set<string>();

  constructor(id: string, sseManager: SSEManager) {
    super(id);
    this.sseManager = sseManager;
  }

  async connect(): Promise<void> {
    this.setStatus('connected');
  }

  async disconnect(): Promise<void> {
    this.sseManager.closeAll();
    this.setStatus('disconnected');
  }

  async sendMessage(conversationId: string, message: OutgoingMessage): Promise<void> {
    this.sseManager.send(conversationId, {
      event: 'message',
      data: {
        text: message.text,
        conversationId,
        timestamp: Date.now(),
      },
    });
  }

  async sendTypingIndicator(conversationId: string): Promise<void> {
    this.sseManager.send(conversationId, {
      event: 'typing',
      data: { conversationId },
    });
  }

  injectMessage(
    text: string,
    conversationId?: string,
  ): { conversationId: string; messageId: string } {
    const convId = conversationId ?? randomUUID();
    const messageId = randomUUID();

    this.conversations.add(convId);

    const msg: NormalizedMessage = {
      id: messageId,
      channelId: this.id,
      conversationId: convId,
      senderId: 'web-user',
      senderName: 'Web User',
      text,
      timestamp: Date.now(),
    };

    // Fire-and-forget — handler runs the agent pipeline in the background
    this.handler?.(msg);

    return { conversationId: convId, messageId };
  }

  getConversations(): string[] {
    return Array.from(this.conversations);
  }
}
