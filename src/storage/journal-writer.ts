import { existsSync, readFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from 'agent-toolkit/logger';
import { JournalEntry, JournalEventType } from './types.js';
import { appendJsonLine, atomicWriteJson, formatTimestampFilename } from './atomic-write.js';

const log = createLogger('journal');

interface JournalSegmentMeta {
  file: string;
  sizeBytes: number;
}

interface JournalIndex {
  segments: JournalSegmentMeta[];
}

/**
 * Append-only JSONL journal writer for recording agent pipeline activity.
 * Uses the same segment/rollover pattern as the history store.
 */
export class JournalWriter {
  private enabled: boolean;
  private journalDir: string;
  private maxSegmentSizeBytes: number;
  private maxSegments: number;

  // Cache current segment info per conversation to avoid re-reading index on every log
  private currentSegments = new Map<string, { file: string; sizeBytes: number }>();

  constructor(opts: {
    enabled?: boolean;
    journalDir: string;
    maxSegmentSizeBytes?: number;
    maxSegments?: number;
  }) {
    this.enabled = opts.enabled ?? true;
    this.journalDir = opts.journalDir;
    this.maxSegmentSizeBytes = opts.maxSegmentSizeBytes ?? 1_048_576;
    this.maxSegments = opts.maxSegments ?? 10;
  }

  /**
   * Fire-and-forget log of a journal event. Never throws.
   */
  log(
    event: JournalEventType,
    taskId: string,
    channelId: string,
    conversationId: string,
    data?: Record<string, unknown>,
  ): void {
    if (!this.enabled) return;

    try {
      const entry: JournalEntry = {
        ts: new Date().toISOString(),
        event,
        taskId,
        channelId,
        conversationId,
        data,
      };

      const dir = join(this.journalDir, channelId, conversationId);
      const key = `${channelId}:${conversationId}`;

      let current = this.currentSegments.get(key);

      // If no cached segment or segment is full, resolve from index
      if (!current || current.sizeBytes >= this.maxSegmentSizeBytes) {
        const index = this.readIndex(dir);

        // Need a new segment?
        if (index.segments.length === 0 || (current && current.sizeBytes >= this.maxSegmentSizeBytes)) {
          const filename = formatTimestampFilename() + '.jsonl';
          index.segments.push({ file: filename, sizeBytes: 0 });

          // Prune old segments
          while (index.segments.length > this.maxSegments) {
            const oldest = index.segments.shift()!;
            try {
              const oldPath = join(dir, oldest.file);
              if (existsSync(oldPath)) unlinkSync(oldPath);
            } catch {
              // ignore
            }
          }

          this.writeIndex(dir, index);
        }

        const seg = index.segments[index.segments.length - 1];
        current = { file: seg.file, sizeBytes: seg.sizeBytes };
      }

      const segPath = join(dir, current.file);
      const bytesWritten = appendJsonLine(segPath, entry);
      current.sizeBytes += bytesWritten;
      this.currentSegments.set(key, current);

      // Persist updated size in index periodically (every ~10 writes or on rollover)
      // For simplicity, we update on rollover only; the cache tracks runtime size
    } catch (err) {
      // Fire-and-forget — log but don't propagate
      log.error('Failed to write journal entry', { error: String(err) });
    }
  }

  private readIndex(dir: string): JournalIndex {
    const indexPath = join(dir, '_index.json');
    if (!existsSync(indexPath)) {
      return { segments: [] };
    }
    try {
      return JSON.parse(readFileSync(indexPath, 'utf-8')) as JournalIndex;
    } catch {
      return { segments: [] };
    }
  }

  private writeIndex(dir: string, index: JournalIndex): void {
    atomicWriteJson(join(dir, '_index.json'), index);
  }
}
