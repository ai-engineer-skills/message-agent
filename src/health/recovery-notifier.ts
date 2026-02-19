import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { createLogger } from 'agent-toolkit/logger';
import { ChannelManager } from '../channels/channel-manager.js';

const log = createLogger('recovery');

interface RecoveryEvent {
  timestamp: number;
  reason: string;
  restartCount: number;
  watchdogPid: number;
}

/**
 * On startup, checks if the watchdog wrote a recovery event file.
 * If found, sends a notification to configured conversations and
 * deletes the event file.
 */
export class RecoveryNotifier {
  constructor(
    private readonly channelManager: ChannelManager,
    private readonly recoveryEventFile: string,
    private readonly notifyTargets: string[],
  ) {}

  async checkAndNotify(): Promise<void> {
    if (this.notifyTargets.length === 0) return;

    if (!existsSync(this.recoveryEventFile)) return;

    let event: RecoveryEvent;
    try {
      const raw = readFileSync(this.recoveryEventFile, 'utf-8');
      event = JSON.parse(raw) as RecoveryEvent;
    } catch (err) {
      log.error('Failed to read recovery event file', { error: String(err) });
      this.cleanup();
      return;
    }

    const downtime = Math.round((Date.now() - event.timestamp) / 1000);
    const message = [
      `**Bot Recovered**`,
      `The bot was automatically restarted by the watchdog.`,
      `• Reason: ${event.reason}`,
      `• Restart #${event.restartCount} in current window`,
      `• Downtime: ~${downtime}s`,
      `• Recovered at: ${new Date().toISOString()}`,
    ].join('\n');

    for (const target of this.notifyTargets) {
      const sepIdx = target.indexOf(':');
      if (sepIdx === -1) {
        log.warn('Invalid notify target (expected channelId:conversationId)', { target });
        continue;
      }
      const channelId = target.slice(0, sepIdx);
      const conversationId = target.slice(sepIdx + 1);

      const channel = this.channelManager.getChannel(channelId);
      if (!channel) {
        log.warn('Channel not found for recovery notification', { channelId });
        continue;
      }

      try {
        await channel.sendMessage(conversationId, { text: message });
        log.info('Recovery notification sent', { channelId, conversationId });
      } catch (err) {
        log.error('Failed to send recovery notification', {
          channelId,
          conversationId,
          error: String(err),
        });
      }
    }

    this.cleanup();
  }

  private cleanup(): void {
    try {
      unlinkSync(this.recoveryEventFile);
      log.info('Recovery event file removed', { path: this.recoveryEventFile });
    } catch {
      // File may already be gone
    }
  }
}
