import { NormalizedMessage, OutgoingMessage } from './message.js';

export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type MessageHandler = (message: NormalizedMessage) => Promise<void>;

export interface ChannelInfo {
  id: string;
  type: string;
  status: ChannelStatus;
  error?: string;
}

export interface Channel {
  id: string;
  type: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: MessageHandler): void;
  sendMessage(conversationId: string, message: OutgoingMessage): Promise<void>;
  sendTypingIndicator(conversationId: string): Promise<void>;
  getStatus(): ChannelInfo;
}
