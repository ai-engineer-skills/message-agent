import { createLogger } from 'agent-toolkit/logger';
import { ChannelManager } from '../channels/channel-manager.js';

const log = createLogger('channel-monitor');

interface ChannelMonitorConfig {
  /** How often to check channel health (ms). Default: 30_000 (30s) */
  readonly checkIntervalMs?: number;
  /** Initial delay before first reconnect attempt (ms). Default: 2_000 */
  readonly reconnectBaseDelayMs?: number;
  /** Maximum reconnect delay after backoff (ms). Default: 120_000 (2 min) */
  readonly reconnectMaxDelayMs?: number;
  /** Maximum consecutive reconnect attempts before giving up temporarily. Default: 10 */
  readonly maxReconnectAttempts?: number;
}

/**
 * Monitors channel health and automatically reconnects dead channels
 * with exponential backoff.
 */
export class ChannelMonitor {
  private readonly checkIntervalMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly maxReconnectAttempts: number;

  /** Tracks consecutive failures per channel for exponential backoff */
  private readonly failureCounts = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly channelManager: ChannelManager,
    config: ChannelMonitorConfig = {},
  ) {
    this.checkIntervalMs = config.checkIntervalMs ?? 30_000;
    this.reconnectBaseDelayMs = config.reconnectBaseDelayMs ?? 2_000;
    this.reconnectMaxDelayMs = config.reconnectMaxDelayMs ?? 120_000;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
  }

  /** Start the health monitoring loop. */
  start(): void {
    this.timer = setInterval(() => {
      void this.checkAndRecover();
    }, this.checkIntervalMs);

    // Don't block process exit
    this.timer.unref();

    log.info('Channel monitor started', {
      checkIntervalMs: this.checkIntervalMs,
    });
  }

  /** Stop the health monitoring loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    log.info('Channel monitor stopped');
  }

  /** Run a single health check cycle across all channels. */
  private async checkAndRecover(): Promise<void> {
    const statuses = this.channelManager.getAllStatuses();

    for (const info of statuses) {
      if (info.status === 'connected') {
        // Channel healthy — reset failure counter
        this.failureCounts.set(info.id, 0);
        continue;
      }

      if (info.status === 'connecting') {
        // Channel is in the process of connecting — don't interfere
        continue;
      }

      // Channel is disconnected or in error state — attempt recovery
      const failures = this.failureCounts.get(info.id) ?? 0;

      if (failures >= this.maxReconnectAttempts) {
        log.warn('Channel exceeded max reconnect attempts, skipping cycle', {
          id: info.id,
          failures,
        });
        // Reset counter so we try again after a full rest cycle
        this.failureCounts.set(info.id, 0);
        continue;
      }

      // Exponential backoff: don't reconnect if not enough time has passed
      const delay = Math.min(
        this.reconnectBaseDelayMs * Math.pow(2, failures),
        this.reconnectMaxDelayMs,
      );

      log.info('Attempting channel reconnection', {
        id: info.id,
        type: info.type,
        status: info.status,
        attempt: failures + 1,
        delayMs: delay,
      });

      // Wait for backoff delay before attempting reconnect
      await new Promise<void>((resolve) => setTimeout(resolve, delay));

      try {
        const channel = this.channelManager.getChannel(info.id);
        if (!channel) continue;

        // Disconnect first to clean up stale state
        try {
          await channel.disconnect();
        } catch {
          // Ignore disconnect errors — channel may already be dead
        }

        await channel.connect();
        this.failureCounts.set(info.id, 0);
        log.info('Channel reconnected successfully', { id: info.id });
      } catch (err) {
        this.failureCounts.set(info.id, failures + 1);
        log.error('Channel reconnect failed', {
          id: info.id,
          attempt: failures + 1,
          error: String(err),
        });
      }
    }
  }
}
