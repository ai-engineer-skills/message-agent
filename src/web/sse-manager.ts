import { ServerResponse } from 'node:http';
import { createLogger } from 'agent-toolkit/logger';

const log = createLogger('sse-manager');

export interface SSEMessage {
  event: string;
  data: unknown;
}

export class SSEManager {
  private connections = new Map<string, Set<ServerResponse>>();

  register(conversationId: string, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial comment to keep connection alive
    res.write(':ok\n\n');

    let clients = this.connections.get(conversationId);
    if (!clients) {
      clients = new Set();
      this.connections.set(conversationId, clients);
    }
    clients.add(res);

    res.on('close', () => {
      clients!.delete(res);
      if (clients!.size === 0) {
        this.connections.delete(conversationId);
      }
      log.info('SSE client disconnected', { conversationId });
    });

    log.info('SSE client connected', { conversationId });
  }

  send(conversationId: string, message: SSEMessage): void {
    const clients = this.connections.get(conversationId);
    if (!clients || clients.size === 0) return;

    const payload = `event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  }

  closeAll(): void {
    for (const [, clients] of this.connections) {
      for (const res of clients) {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
    }
    this.connections.clear();
  }
}
