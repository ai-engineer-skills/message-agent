import { createLogger, Logger } from 'agent-toolkit/logger';
import {
  Channel,
  ChannelStatus,
  ChannelInfo,
  MessageHandler,
} from '../types/channel.js';
import { OutgoingMessage } from '../types/message.js';

export abstract class BaseChannel implements Channel {
  public abstract readonly type: string;
  protected status: ChannelStatus = 'disconnected';
  protected error?: string;
  protected handler?: MessageHandler;
  protected log: Logger;

  constructor(public readonly id: string) {
    this.log = createLogger(`channel:${id}`);
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  getStatus(): ChannelInfo {
    return {
      id: this.id,
      type: this.type,
      status: this.status,
      error: this.error,
    };
  }

  protected setStatus(status: ChannelStatus, error?: string): void {
    this.status = status;
    this.error = error;
    this.log.info('Channel status changed', { status, error });
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract sendMessage(
    conversationId: string,
    message: OutgoingMessage,
  ): Promise<void>;
  abstract sendTypingIndicator(conversationId: string): Promise<void>;
}
