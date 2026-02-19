import { randomUUID } from 'node:crypto';
import { BaseChannel } from '../channel.js';
import { NormalizedMessage, OutgoingMessage } from '../../types/message.js';

export class WhatsAppChannel extends BaseChannel {
  public readonly type = 'whatsapp';
  private client: any = null;
  private sessionDataPath?: string;

  constructor(id: string, sessionDataPath?: string) {
    super(id);
    this.sessionDataPath = sessionDataPath;
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');

    let WAWebJS: any;
    try {
      WAWebJS = await import('whatsapp-web.js');
    } catch {
      this.setStatus('error', 'whatsapp-web.js not installed');
      return;
    }

    const clientOptions: Record<string, unknown> = {};
    if (this.sessionDataPath) {
      clientOptions.authStrategy = new WAWebJS.LocalAuth({
        dataPath: this.sessionDataPath,
      });
    }

    this.client = new WAWebJS.Client(clientOptions);

    this.client.on('qr', (qr: string) => {
      this.log.info('WhatsApp QR code received — scan to authenticate');
      process.stderr.write(`WhatsApp QR: ${qr}\n`);
    });

    this.client.on('ready', () => {
      this.setStatus('connected');
      this.log.info('WhatsApp client ready');
    });

    this.client.on('message', async (waMsg: any) => {
      if (!this.handler) return;

      const msg: NormalizedMessage = {
        id: randomUUID(),
        channelId: this.id,
        conversationId: waMsg.from,
        senderId: waMsg.author || waMsg.from,
        senderName: waMsg._data?.notifyName,
        text: waMsg.body ?? '',
        timestamp: waMsg.timestamp * 1000,
        platformMessageId: waMsg.id?._serialized ?? waMsg.id?.id,
        raw: waMsg,
      };

      try {
        await this.handler(msg);
      } catch (err) {
        this.log.error('Error handling message', { error: String(err) });
      }
    });

    this.client.on('disconnected', () => {
      this.setStatus('disconnected');
    });

    await this.client.initialize();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
    this.setStatus('disconnected');
  }

  async sendMessage(
    conversationId: string,
    message: OutgoingMessage,
  ): Promise<void> {
    if (!this.client) throw new Error('WhatsApp client not connected');
    const options: Record<string, unknown> = {};
    if (message.replyToMessageId) {
      options.quotedMessageId = message.replyToMessageId;
    }
    await this.client.sendMessage(conversationId, message.text, options);
  }

  async sendTypingIndicator(conversationId: string): Promise<void> {
    if (!this.client) return;
    try {
      const chat = await this.client.getChatById(conversationId);
      await chat.sendStateTyping();
    } catch {
      // Typing indicator is best-effort
    }
  }
}
