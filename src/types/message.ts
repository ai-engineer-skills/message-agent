export interface MessageAttachment {
  type: 'image' | 'audio' | 'video' | 'document' | 'other';
  url?: string;
  filename?: string;
  mimeType?: string;
  data?: Buffer;
}

export interface NormalizedMessage {
  id: string;
  channelId: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  text: string;
  timestamp: number;
  platformMessageId?: string;
  attachments?: MessageAttachment[];
  raw?: unknown;
}

export interface OutgoingMessage {
  text: string;
  attachments?: MessageAttachment[];
  replyToMessageId?: string;
}
