import { randomUUID } from 'node:crypto';
import { BaseChannel } from '../channel.js';
import { NormalizedMessage, OutgoingMessage } from '../../types/message.js';

export class WeChatChannel extends BaseChannel {
  public readonly type = 'wechat';
  private bot: any = null;
  private puppetProvider?: string;

  constructor(id: string, puppetProvider?: string) {
    super(id);
    this.puppetProvider = puppetProvider;
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');

    let WechatyModule: any;
    try {
      WechatyModule = await import('wechaty');
    } catch {
      this.setStatus('error', 'wechaty not installed');
      return;
    }

    const options: Record<string, unknown> = {
      name: this.id,
    };

    if (this.puppetProvider) {
      options.puppet = this.puppetProvider;
    }

    this.bot = WechatyModule.WechatyBuilder.build(options);

    this.bot.on('scan', (qrcode: string, status: number) => {
      this.log.info('WeChat QR scan required', { status });
      process.stderr.write(`WeChat QR: ${qrcode}\n`);
    });

    this.bot.on('login', (user: any) => {
      this.setStatus('connected');
      this.log.info('WeChat logged in', { user: user?.name?.() });
    });

    this.bot.on('logout', () => {
      this.setStatus('disconnected');
    });

    this.bot.on('message', async (message: any) => {
      if (!this.handler) return;
      if (message.self()) return; // Ignore own messages

      const room = message.room();
      const talker = message.talker();

      const msg: NormalizedMessage = {
        id: randomUUID(),
        channelId: this.id,
        conversationId: room ? room.id : talker.id,
        senderId: talker.id,
        senderName: talker.name(),
        text: message.text() ?? '',
        timestamp: message.date().getTime(),
        platformMessageId: message.id,
        raw: message,
      };

      try {
        await this.handler(msg);
      } catch (err) {
        this.log.error('Error handling message', { error: String(err) });
      }
    });

    await this.bot.start();
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
    }
    this.setStatus('disconnected');
  }

  async sendMessage(
    conversationId: string,
    message: OutgoingMessage,
  ): Promise<void> {
    if (!this.bot) throw new Error('WeChat bot not connected');

    // Try room first, then contact
    const room = await this.bot.Room.find({ id: conversationId });
    if (room) {
      await room.say(message.text);
      return;
    }

    const contact = await this.bot.Contact.find({ id: conversationId });
    if (contact) {
      await contact.say(message.text);
      return;
    }

    throw new Error(`WeChat conversation not found: ${conversationId}`);
  }

  async sendTypingIndicator(_conversationId: string): Promise<void> {
    // WeChat doesn't support typing indicators via Wechaty
  }
}
