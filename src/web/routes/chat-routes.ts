import { IncomingMessage, ServerResponse } from 'node:http';
import { WebChannel } from '../../channels/web/web-channel.js';
import { SSEManager } from '../sse-manager.js';
import { HistoryStore } from '../../history/history-store.js';

export interface ChatRouteDeps {
  webChannel: WebChannel;
  sseManager: SSEManager;
  historyStore: HistoryStore;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

export async function handleChatRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: ChatRouteDeps,
): Promise<boolean> {
  // POST /api/chat
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const body = JSON.parse(await readBody(req)) as { text?: string; conversationId?: string };
      if (!body.text || typeof body.text !== 'string') {
        json(res, 400, { error: 'text is required' });
        return true;
      }
      const result = deps.webChannel.injectMessage(body.text, body.conversationId);
      json(res, 200, result);
    } catch (err) {
      json(res, 400, { error: 'Invalid JSON body' });
    }
    return true;
  }

  // GET /api/chat/stream?conversationId=
  if (req.method === 'GET' && url.pathname === '/api/chat/stream') {
    const conversationId = url.searchParams.get('conversationId');
    if (!conversationId) {
      json(res, 400, { error: 'conversationId query param required' });
      return true;
    }
    deps.sseManager.register(conversationId, res);
    return true;
  }

  // GET /api/history?conversationId=
  if (req.method === 'GET' && url.pathname === '/api/history') {
    const conversationId = url.searchParams.get('conversationId');
    if (!conversationId) {
      json(res, 400, { error: 'conversationId query param required' });
      return true;
    }
    const messages = await deps.historyStore.getMessages(
      deps.webChannel.id,
      conversationId,
    );
    json(res, 200, { conversationId, messages });
    return true;
  }

  // GET /api/conversations
  if (req.method === 'GET' && url.pathname === '/api/conversations') {
    const conversations = deps.webChannel.getConversations();
    json(res, 200, { conversations });
    return true;
  }

  return false;
}
