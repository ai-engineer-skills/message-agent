import { existsSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from 'agent-toolkit/logger';
import { ChatMessage } from '../llm/llm-provider.js';
import { HistoryEntry, SegmentIndex } from './types.js';
import { appendJsonLine, atomicWriteJson, formatTimestampFilename } from './atomic-write.js';

const log = createLogger('migrator');

/**
 * Migrates old flat JSON history files from `./data/history/` into the
 * new JSONL segment format under the data root.
 *
 * Runs automatically on first startup when the new history dir is empty
 * but the legacy dir exists.
 */
export function migrateOldHistory(
  legacyDir: string,
  newHistoryDir: string,
): void {
  if (!existsSync(legacyDir)) {
    log.info('No legacy history directory found, skipping migration');
    return;
  }

  // Check if migration is needed — skip if new dir already has content
  if (existsSync(newHistoryDir) && readdirSync(newHistoryDir).length > 0) {
    log.info('New history directory already has content, skipping migration');
    return;
  }

  log.info('Starting history migration', { from: legacyDir, to: newHistoryDir });

  let migratedCount = 0;
  let errorCount = 0;

  // Iterate channel dirs
  const channelDirs = safeReaddir(legacyDir);
  for (const channelId of channelDirs) {
    const channelPath = join(legacyDir, channelId);
    if (!isDirectory(channelPath)) continue;

    const files = safeReaddir(channelPath);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const conversationId = file.replace(/\.json$/, '');
      const filePath = join(channelPath, file);

      try {
        const raw = readFileSync(filePath, 'utf-8');
        const messages = JSON.parse(raw) as ChatMessage[];

        if (!Array.isArray(messages) || messages.length === 0) continue;

        // Get file mtime as fallback timestamp
        const mtime = statSync(filePath).mtime;

        // Write to new format
        const convDir = join(newHistoryDir, channelId, conversationId);
        const segmentFile = formatTimestampFilename(mtime) + '.jsonl';
        const segPath = join(convDir, segmentFile);

        let totalBytes = 0;
        let seq = 1;
        for (const msg of messages) {
          const entry: HistoryEntry = {
            seq,
            ts: mtime.toISOString(),
            role: msg.role,
            content: msg.content,
            toolCallId: msg.toolCallId,
          };
          totalBytes += appendJsonLine(segPath, entry);
          seq++;
        }

        // Write index
        const index: SegmentIndex = {
          nextSeq: seq,
          segments: [
            {
              file: segmentFile,
              firstSeq: 1,
              lastSeq: seq - 1,
              count: messages.length,
              sizeBytes: totalBytes,
              startedAt: mtime.toISOString(),
              endedAt: mtime.toISOString(),
            },
          ],
        };
        atomicWriteJson(join(convDir, '_index.json'), index);
        migratedCount++;
      } catch (err) {
        log.error('Failed to migrate conversation', {
          channelId,
          conversationId,
          error: String(err),
        });
        errorCount++;
      }
    }
  }

  // Rename old directory to .bak
  try {
    const bakDir = legacyDir + '.bak';
    if (existsSync(bakDir)) {
      log.warn('Backup directory already exists, not renaming legacy dir', { bakDir });
    } else {
      renameSync(legacyDir, bakDir);
      log.info('Legacy history directory renamed', { from: legacyDir, to: bakDir });
    }
  } catch (err) {
    log.error('Failed to rename legacy history directory', { error: String(err) });
  }

  log.info('Migration complete', { migratedCount, errorCount });
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
