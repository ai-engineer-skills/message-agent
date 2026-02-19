import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { createLogger } from 'agent-toolkit/logger';
import { WebChannel } from '../channels/web/web-channel.js';
import { SSEManager } from './sse-manager.js';
import { HistoryStore } from '../history/history-store.js';
import { ChannelManager } from '../channels/channel-manager.js';
import { TaskManager } from '../concurrency/task-manager.js';
import { TaskPersistence } from '../storage/task-persistence.js';
import { handleChatRoutes } from './routes/chat-routes.js';
import { handleDashboardRoutes } from './routes/dashboard-routes.js';
import { getWebAppHtml } from './web-html.js';

const log = createLogger('web-server');

export interface WebServerDeps {
  webChannel: WebChannel;
  sseManager: SSEManager;
  historyStore: HistoryStore;
  channelManager: ChannelManager;
  taskManager: TaskManager;
  taskPersistence: TaskPersistence;
  dataRoot: string;
  personaName: string;
}

export class WebServer {
  private server: Server | null = null;
  private port: number;
  private deps: WebServerDeps;
  private cachedHtml: string;

  constructor(port: number, deps: WebServerDeps) {
    this.port = port;
    this.deps = deps;
    this.cachedHtml = getWebAppHtml(deps.personaName);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err) => {
        log.error('Web server error', { error: String(err) });
        reject(err);
      });

      this.server.listen(this.port, () => {
        log.info('Web server started', { port: this.port, url: `http://localhost:${this.port}` });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.deps.sseManager.closeAll();
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        log.info('Web server stopped');
        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      // Chat routes
      const chatHandled = await handleChatRoutes(req, res, url, {
        webChannel: this.deps.webChannel,
        sseManager: this.deps.sseManager,
        historyStore: this.deps.historyStore,
      });
      if (chatHandled) return;

      // Dashboard routes
      const dashHandled = await handleDashboardRoutes(req, res, url, {
        channelManager: this.deps.channelManager,
        taskManager: this.deps.taskManager,
        taskPersistence: this.deps.taskPersistence,
        dataRoot: this.deps.dataRoot,
      });
      if (dashHandled) return;

      // Serve SPA
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
        res.end(this.cachedHtml);
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      log.error('Request handler error', { error: String(err) });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
