import { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChannelManager } from '../../channels/channel-manager.js';
import { TaskManager } from '../../concurrency/task-manager.js';
import { TaskPersistence } from '../../storage/task-persistence.js';

export interface DashboardRouteDeps {
  channelManager: ChannelManager;
  taskManager: TaskManager;
  taskPersistence: TaskPersistence;
  dataRoot: string;
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

export async function handleDashboardRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: DashboardRouteDeps,
): Promise<boolean> {
  // GET /api/status
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const channels = deps.channelManager.getAllStatuses();
    const activeTasks = deps.taskManager.getTaskStatus();
    const memUsage = process.memoryUsage();
    json(res, 200, {
      channels,
      activeTasks: activeTasks.length,
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
      uptime: Math.round(process.uptime()),
    });
    return true;
  }

  // GET /api/tasks
  if (req.method === 'GET' && url.pathname === '/api/tasks') {
    const active = deps.taskManager.getTaskStatus();
    const persisted = deps.taskPersistence.listActive();
    json(res, 200, { active, persisted });
    return true;
  }

  // GET /api/journal?channelId=&conversationId=
  if (req.method === 'GET' && url.pathname === '/api/journal') {
    const channelId = url.searchParams.get('channelId');
    const conversationId = url.searchParams.get('conversationId');
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

    const journalDir = join(deps.dataRoot, 'journal');
    const entries: unknown[] = [];

    try {
      if (channelId && conversationId) {
        // Read specific conversation journal
        const convDir = join(journalDir, channelId, conversationId);
        readJournalDir(convDir, entries, limit);
      } else {
        // Scan all journal directories
        if (existsSync(journalDir)) {
          for (const ch of readdirSync(journalDir)) {
            const chDir = join(journalDir, ch);
            try {
              for (const cv of readdirSync(chDir)) {
                const cvDir = join(chDir, cv);
                readJournalDir(cvDir, entries, limit);
                if (entries.length >= limit) break;
              }
            } catch {
              // skip non-directories
            }
            if (entries.length >= limit) break;
          }
        }
      }
    } catch {
      // return whatever we collected
    }

    // Sort by timestamp descending, limit
    entries.sort((a: any, b: any) => (b.ts ?? '').localeCompare(a.ts ?? ''));
    json(res, 200, { entries: entries.slice(0, limit) });
    return true;
  }

  return false;
}

function readJournalDir(dir: string, entries: unknown[], limit: number): void {
  if (!existsSync(dir)) return;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .reverse();

  for (const file of files) {
    if (entries.length >= limit) return;

    try {
      const content = readFileSync(join(dir, file), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      // Read from newest to oldest
      for (let i = lines.length - 1; i >= 0; i--) {
        if (entries.length >= limit) return;
        try {
          entries.push(JSON.parse(lines[i]));
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // skip unreadable files
    }
  }
}
