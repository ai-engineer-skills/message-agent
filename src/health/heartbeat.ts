import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from 'agent-toolkit/logger';

const log = createLogger('heartbeat');

/**
 * Heartbeat payload written to disk and served via HTTP.
 * The watchdog reads this to determine if the host is alive.
 */
interface HeartbeatPayload {
  readonly pid: number;
  readonly timestamp: number;
  readonly uptimeSeconds: number;
  readonly status: 'ok' | 'degraded' | 'error';
  readonly channels: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly status: string;
    readonly error?: string;
  }>;
  readonly memoryMB: number;
}

interface HeartbeatConfig {
  /** Interval in ms between heartbeat writes. Default: 10_000 (10s) */
  readonly intervalMs?: number;
  /** Path to the heartbeat file on disk. Default: ./data/heartbeat.json */
  readonly filePath?: string;
  /** HTTP port for the health endpoint. Default: 3001 */
  readonly httpPort?: number;
  /** Whether to enable the HTTP health endpoint. Default: true */
  readonly httpEnabled?: boolean;
}

type ChannelStatusProvider = () => ReadonlyArray<{
  id: string;
  type: string;
  status: string;
  error?: string;
}>;

/**
 * Emits periodic heartbeats to a file and optionally via HTTP.
 * The watchdog process monitors the heartbeat file to detect host death.
 */
export class HeartbeatService {
  private readonly intervalMs: number;
  private readonly filePath: string;
  private readonly httpPort: number;
  private readonly httpEnabled: boolean;
  private timer: ReturnType<typeof setInterval> | undefined;
  private server: Server | undefined;
  private getChannelStatuses: ChannelStatusProvider = () => [];

  constructor(config: HeartbeatConfig = {}) {
    this.intervalMs = config.intervalMs ?? 10_000;
    this.filePath = config.filePath ?? './data/heartbeat.json';
    this.httpPort = config.httpPort ?? 3001;
    this.httpEnabled = config.httpEnabled ?? true;
  }

  /** Register a function that provides current channel statuses. */
  setChannelStatusProvider(provider: ChannelStatusProvider): void {
    this.getChannelStatuses = provider;
  }

  /** Start emitting heartbeats. */
  async start(): Promise<void> {
    // Ensure the directory for the heartbeat file exists
    mkdirSync(dirname(this.filePath), { recursive: true });

    // Write initial heartbeat immediately
    this.writeHeartbeat();

    // Start periodic heartbeat
    this.timer = setInterval(() => {
      this.writeHeartbeat();
    }, this.intervalMs);

    // Ensure timer doesn't keep the process alive if everything else shuts down
    this.timer.unref();

    log.info('Heartbeat started', {
      intervalMs: this.intervalMs,
      filePath: this.filePath,
    });

    // Start HTTP health endpoint
    if (this.httpEnabled) {
      await this.startHttpServer();
    }
  }

  /** Stop heartbeat emission and shut down the HTTP server. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.server = undefined;
    }

    log.info('Heartbeat stopped');
  }

  private buildPayload(): HeartbeatPayload {
    const channels = this.getChannelStatuses();
    const allConnected = channels.length > 0 && channels.every((c) => c.status === 'connected');
    const anyError = channels.some((c) => c.status === 'error');

    let status: HeartbeatPayload['status'] = 'ok';
    if (anyError) status = 'error';
    else if (!allConnected && channels.length > 0) status = 'degraded';

    return {
      pid: process.pid,
      timestamp: Date.now(),
      uptimeSeconds: Math.floor(process.uptime()),
      status,
      channels,
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }

  private writeHeartbeat(): void {
    try {
      const payload = this.buildPayload();
      writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      log.error('Failed to write heartbeat', { error: String(err) });
    }
  }

  private async startHttpServer(): Promise<void> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/health' || req.url === '/') {
        const payload = this.buildPayload();
        const statusCode = payload.status === 'ok' ? 200 : 503;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    // Don't let the health server keep the process alive
    this.server.unref();

    await new Promise<void>((resolve, reject) => {
      this.server!.on('error', (err) => {
        log.error('Health HTTP server error', { error: String(err) });
        reject(err);
      });
      this.server!.listen(this.httpPort, () => {
        log.info('Health endpoint listening', { port: this.httpPort });
        resolve();
      });
    });
  }
}
