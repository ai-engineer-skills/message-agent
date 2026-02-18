import { randomUUID } from 'node:crypto';
import { Telegraf } from 'telegraf';
import { BaseChannel } from '../channel.js';
import { NormalizedMessage, OutgoingMessage } from '../../types/message.js';

export class TelegramChannel extends BaseChannel {
  public readonly type = 'telegram';
  private bot: Telegraf;

  constructor(id: string, token: string) {
    super(id);
    this.bot = new Telegraf(token);
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');

    this.bot.on('message', async (ctx) => {
      if (!this.handler) return;
      if (!('text' in ctx.message)) return;

      const msg: NormalizedMessage = {
        id: randomUUID(),
        channelId: this.id,
        conversationId: String(ctx.chat.id),
        senderId: String(ctx.from.id),
        senderName:
          ctx.from.first_name +
          (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
        text: ctx.message.text,
        timestamp: ctx.message.date * 1000,
        raw: ctx.message,
      };

      try {
        await this.handler(msg);
      } catch (err) {
        this.log.error('Error handling message', { error: String(err) });
      }
    });

    await this.bot.launch();
    this.setStatus('connected');
    this.log.info('Telegram bot launched');
  }

  async disconnect(): Promise<void> {
    this.bot.stop('shutdown');
    this.setStatus('disconnected');
  }

  async sendMessage(
    conversationId: string,
    message: OutgoingMessage,
  ): Promise<void> {
    await this.bot.telegram.sendMessage(conversationId, message.text, {
      parse_mode: 'Markdown',
    });
  }

  async sendTypingIndicator(conversationId: string): Promise<void> {
    await this.bot.telegram.sendChatAction(conversationId, 'typing');
  }
}
