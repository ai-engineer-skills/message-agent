import { createLogger } from 'agent-toolkit/logger';
import { Channel, ChannelInfo, MessageHandler } from '../types/channel.js';

const log = createLogger('channel-manager');

export class ChannelManager {
  private channels = new Map<string, Channel>();

  register(channel: Channel): void {
    this.channels.set(channel.id, channel);
    log.info('Channel registered', { id: channel.id, type: channel.type });
  }

  setHandler(handler: MessageHandler): void {
    for (const channel of this.channels.values()) {
      channel.onMessage(handler);
    }
  }

  async connectAll(): Promise<void> {
    for (const [id, channel] of this.channels) {
      try {
        await channel.connect();
        log.info('Channel connected', { id });
      } catch (err) {
        log.error('Failed to connect channel', { id, error: String(err) });
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [id, channel] of this.channels) {
      try {
        await channel.disconnect();
        log.info('Channel disconnected', { id });
      } catch (err) {
        log.error('Error disconnecting channel', { id, error: String(err) });
      }
    }
  }

  getChannel(id: string): Channel | undefined {
    return this.channels.get(id);
  }

  getAllStatuses(): ChannelInfo[] {
    return Array.from(this.channels.values()).map((c) => c.getStatus());
  }
}
