import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import { BaseChannel } from '../channel.js';
import { NormalizedMessage, OutgoingMessage } from '../../types/message.js';

export class IMessageChannel extends BaseChannel {
  public readonly type = 'imessage';
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastCheckTime = Date.now();

  constructor(id: string) {
    super(id);
  }

  async connect(): Promise<void> {
    if (platform() !== 'darwin') {
      this.setStatus('error', 'iMessage is only available on macOS');
      this.log.warn('iMessage channel skipped — not running on macOS');
      return;
    }

    this.setStatus('connecting');

    try {
      // Verify osascript is available
      const { execSync } = await import('node:child_process');
      execSync('osascript -e "return 1"', { stdio: 'pipe' });
    } catch {
      this.setStatus('error', 'AppleScript not available');
      return;
    }

    // Start polling for new messages
    this.pollInterval = setInterval(() => this.pollMessages(), 5000);
    this.setStatus('connected');
    this.log.info('iMessage polling started');
  }

  async disconnect(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.setStatus('disconnected');
  }

  private async pollMessages(): Promise<void> {
    if (!this.handler) return;

    try {
      const { execSync } = await import('node:child_process');
      const script = `
        tell application "Messages"
          set msgs to {}
          repeat with aChat in chats
            repeat with aMsg in messages of aChat
              if date received of aMsg > (current date) - 10 then
                set end of msgs to {id of aChat, sender of aMsg, text of aMsg}
              end if
            end repeat
          end repeat
          return msgs
        end tell
      `;

      const result = execSync(`osascript -e '${script}'`, {
        stdio: 'pipe',
        timeout: 10000,
      }).toString();

      // Parse simple messages from osascript output
      if (result.trim()) {
        const msg: NormalizedMessage = {
          id: randomUUID(),
          channelId: this.id,
          conversationId: 'imessage-default',
          senderId: 'unknown',
          text: result.trim(),
          timestamp: Date.now(),
        };
        await this.handler(msg);
      }
    } catch {
      // Polling failures are expected (no new messages)
    }

    this.lastCheckTime = Date.now();
  }

  async sendMessage(
    conversationId: string,
    message: OutgoingMessage,
  ): Promise<void> {
    if (platform() !== 'darwin') {
      throw new Error('iMessage is only available on macOS');
    }

    const { execSync } = await import('node:child_process');
    const escapedText = message.text.replace(/'/g, "'\\''");
    const script = `tell application "Messages" to send "${escapedText}" to chat id "${conversationId}"`;
    execSync(`osascript -e '${script}'`, { stdio: 'pipe' });
  }

  async sendTypingIndicator(_conversationId: string): Promise<void> {
    // iMessage doesn't support typing indicators via AppleScript
  }
}
