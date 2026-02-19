/**
 * watchdog.ts — External process that monitors the message-agent host.
 *
 * Run this as a separate process (via PM2, systemd, or a second terminal).
 * It reads the heartbeat file written by the host and restarts the host
 * process if the heartbeat goes stale (no update within the threshold).
 *
 * Usage:
 *   node dist/watchdog.js [options]
 *
 * Environment variables:
 *   HEARTBEAT_FILE     — Path to heartbeat JSON file (default: ./data/heartbeat.json)
 *   HEARTBEAT_TIMEOUT  — Max age in seconds before restarting (default: 60)
 *   CHECK_INTERVAL     — Check interval in seconds (default: 15)
 *   HOST_COMMAND       — Command to start the host (default: node dist/index.js)
 *   MAX_RESTARTS       — Max restarts within RESTART_WINDOW before pausing (default: 5)
 *   RESTART_WINDOW     — Window in seconds for max restart tracking (default: 300)
 *   HEALTH_URL         — Optional HTTP health endpoint to check (default: http://localhost:3001/health)
 *   RECOVERY_EVENT_FILE — Path to recovery event file (default: ./data/recovery-event.json)
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';

// ─── Configuration ──────────────────────────────────────────────────────────────

interface WatchdogConfig {
  readonly heartbeatFile: string;
  readonly heartbeatTimeoutMs: number;
  readonly checkIntervalMs: number;
  readonly hostCommand: string;
  readonly hostArgs: readonly string[];
  readonly maxRestarts: number;
  readonly restartWindowMs: number;
  readonly healthUrl: string | undefined;
  readonly recoveryEventFile: string;
}

function loadConfig(): WatchdogConfig {
  const hostCommandRaw = process.env.HOST_COMMAND ?? 'node dist/index.js';
  const parts = hostCommandRaw.split(' ');

  return {
    heartbeatFile: process.env.HEARTBEAT_FILE ?? './data/heartbeat.json',
    heartbeatTimeoutMs: (parseInt(process.env.HEARTBEAT_TIMEOUT ?? '60', 10)) * 1000,
    checkIntervalMs: (parseInt(process.env.CHECK_INTERVAL ?? '15', 10)) * 1000,
    hostCommand: parts[0],
    hostArgs: parts.slice(1),
    maxRestarts: parseInt(process.env.MAX_RESTARTS ?? '5', 10),
    restartWindowMs: (parseInt(process.env.RESTART_WINDOW ?? '300', 10)) * 1000,
    healthUrl: process.env.HEALTH_URL ?? 'http://localhost:3001/health',
    recoveryEventFile: process.env.RECOVERY_EVENT_FILE ?? './data/recovery-event.json',
  };
}

// ─── Heartbeat types ────────────────────────────────────────────────────────────

interface HeartbeatPayload {
  readonly pid: number;
  readonly timestamp: number;
  readonly uptimeSeconds: number;
  readonly status: 'ok' | 'degraded' | 'error';
  readonly channels: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly status: string;
  }>;
  readonly memoryMB?: number;
}

// ─── Logger (standalone — no dependency on agent-toolkit) ───────────────────────

function logInfo(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const extra = data ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${timestamp}] [WATCHDOG] INFO  ${message}${extra}`);
}

function logWarn(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const extra = data ? ` ${JSON.stringify(data)}` : '';
  console.warn(`[${timestamp}] [WATCHDOG] WARN  ${message}${extra}`);
}

function logError(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const extra = data ? ` ${JSON.stringify(data)}` : '';
  console.error(`[${timestamp}] [WATCHDOG] ERROR ${message}${extra}`);
}

// ─── Heartbeat reader ───────────────────────────────────────────────────────────

type HeartbeatResult =
  | { readonly ok: true; readonly data: HeartbeatPayload }
  | { readonly ok: false; readonly error: string };

function readHeartbeat(filePath: string): HeartbeatResult {
  if (!existsSync(filePath)) {
    return { ok: false, error: 'Heartbeat file does not exist' };
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as HeartbeatPayload;

    if (typeof data.timestamp !== 'number' || typeof data.pid !== 'number') {
      return { ok: false, error: 'Invalid heartbeat payload' };
    }

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: `Failed to read heartbeat: ${String(err)}` };
  }
}

// ─── HTTP health check ──────────────────────────────────────────────────────────

async function checkHttpHealth(url: string, timeoutMs: number = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    return response.ok;
  } catch {
    return false;
  }
}

// ─── Process management ─────────────────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 checks if the process exists without actually killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
    logInfo('Sent SIGTERM to host process', { pid });

    // Give it 5 seconds then SIGKILL
    setTimeout(() => {
      if (isProcessAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
          logWarn('Sent SIGKILL to host process (did not exit gracefully)', { pid });
        } catch {
          // Process already exited
        }
      }
    }, 5000);
  } catch {
    // Process already dead
  }
}

function spawnHost(config: WatchdogConfig): ChildProcess {
  logInfo('Starting host process', {
    command: config.hostCommand,
    args: config.hostArgs,
  });

  const child = spawn(config.hostCommand, [...config.hostArgs], {
    stdio: 'inherit',
    env: { ...process.env },
    detached: false,
  });

  child.on('exit', (code, signal) => {
    logWarn('Host process exited', { code, signal });
  });

  child.on('error', (err) => {
    logError('Host process spawn error', { error: String(err) });
  });

  return child;
}

// ─── Restart rate limiter ───────────────────────────────────────────────────────

class RestartTracker {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly maxRestarts: number,
    private readonly windowMs: number,
  ) {}

  /** Record a restart and return whether we're within limits. */
  recordAndCheck(): boolean {
    const now = Date.now();
    this.timestamps.push(now);

    // Prune old entries outside the window
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }

    return this.timestamps.length <= this.maxRestarts;
  }

  get recentCount(): number {
    const cutoff = Date.now() - this.windowMs;
    return this.timestamps.filter((t) => t >= cutoff).length;
  }
}

// ─── Recovery event file ─────────────────────────────────────────────────────

function writeRecoveryEvent(filePath: string, reason: string, restartCount: number): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const event = {
      timestamp: Date.now(),
      reason,
      restartCount,
      watchdogPid: process.pid,
    };
    writeFileSync(filePath, JSON.stringify(event, null, 2), 'utf-8');
    logInfo('Recovery event written', { filePath });
  } catch (err) {
    logError('Failed to write recovery event', { error: String(err) });
  }
}

// ─── Main watchdog loop ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();
  const restartTracker = new RestartTracker(config.maxRestarts, config.restartWindowMs);
  let hostProcess: ChildProcess | undefined;
  let paused = false;

  logInfo('Watchdog starting', {
    heartbeatFile: config.heartbeatFile,
    heartbeatTimeoutMs: config.heartbeatTimeoutMs,
    checkIntervalMs: config.checkIntervalMs,
    maxRestarts: config.maxRestarts,
    restartWindowSec: config.restartWindowMs / 1000,
  });

  // Start the host process initially
  hostProcess = spawnHost(config);

  // Give the host time to boot and write its first heartbeat
  logInfo('Waiting for host to initialize...');
  await new Promise<void>((resolve) => setTimeout(resolve, 15_000));

  // Main monitoring loop
  const checkHealth = async (): Promise<void> => {
    if (paused) {
      logInfo('Watchdog paused (too many restarts), waiting for cooldown...');
      paused = false; // Will re-evaluate on next cycle
      return;
    }

    let needsRestart = false;
    let reason = '';

    // Check 1: Heartbeat file freshness
    const heartbeat = readHeartbeat(config.heartbeatFile);

    if (!heartbeat.ok) {
      needsRestart = true;
      reason = heartbeat.error;
    } else {
      const ageMs = Date.now() - heartbeat.data.timestamp;

      if (ageMs > config.heartbeatTimeoutMs) {
        needsRestart = true;
        reason = `Heartbeat stale (age: ${Math.round(ageMs / 1000)}s, threshold: ${config.heartbeatTimeoutMs / 1000}s)`;
      } else if (!isProcessAlive(heartbeat.data.pid)) {
        needsRestart = true;
        reason = `Host PID ${heartbeat.data.pid} is not alive`;
      }
    }

    // Check 2: HTTP health (supplementary — only triggers restart if heartbeat also stale)
    if (!needsRestart && config.healthUrl) {
      const httpOk = await checkHttpHealth(config.healthUrl);
      if (!httpOk) {
        // Don't restart on HTTP failure alone (could be port conflict),
        // but log a warning
        logWarn('HTTP health check failed (heartbeat still fresh, not restarting)', {
          url: config.healthUrl,
        });
      }
    }

    if (!needsRestart) {
      // Everything healthy
      if (heartbeat.ok) {
        logInfo('Host healthy', {
          pid: heartbeat.data.pid,
          uptime: `${heartbeat.data.uptimeSeconds}s`,
          status: heartbeat.data.status,
          memoryMB: heartbeat.data.memoryMB,
          channelCount: heartbeat.data.channels.length,
        });
      }
      return;
    }

    // ─── Restart needed ───────────────────────────────────────────────

    logError('Host needs restart', { reason });

    // Rate limit restarts
    const withinLimits = restartTracker.recordAndCheck();
    if (!withinLimits) {
      logError('Too many restarts, pausing watchdog', {
        recentRestarts: restartTracker.recentCount,
        maxRestarts: config.maxRestarts,
        windowSec: config.restartWindowMs / 1000,
      });
      paused = true;
      return;
    }

    // Kill existing process if still alive
    if (heartbeat.ok && isProcessAlive(heartbeat.data.pid)) {
      killProcess(heartbeat.data.pid);
      // Wait for graceful shutdown
      await new Promise<void>((resolve) => setTimeout(resolve, 6_000));
    }

    // Also kill our tracked child process
    if (hostProcess?.pid && isProcessAlive(hostProcess.pid)) {
      killProcess(hostProcess.pid);
      await new Promise<void>((resolve) => setTimeout(resolve, 6_000));
    }

    // Spawn a new host
    hostProcess = spawnHost(config);

    // Give it time to boot
    logInfo('Waiting for new host to initialize...');
    await new Promise<void>((resolve) => setTimeout(resolve, 15_000));

    logInfo('Restart complete', {
      newPid: hostProcess.pid,
      recentRestarts: restartTracker.recentCount,
    });

    // Write recovery event file so the host can notify users on startup
    writeRecoveryEvent(config.recoveryEventFile, reason, restartTracker.recentCount);
  };

  // Run the check loop
  setInterval(() => {
    void checkHealth();
  }, config.checkIntervalMs);

  // Graceful shutdown of the watchdog itself
  const shutdown = (): void => {
    logInfo('Watchdog shutting down');
    if (hostProcess?.pid && isProcessAlive(hostProcess.pid)) {
      logInfo('Sending SIGTERM to host process', { pid: hostProcess.pid });
      killProcess(hostProcess.pid);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logError('Watchdog fatal error', { error: String(err) });
  process.exit(1);
});
