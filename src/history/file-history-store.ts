import { mkdirSync, readFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from 'agent-toolkit/logger';
import { ChatMessage } from '../llm/llm-provider.js';
import { HistoryStore } from './history-store.js';
import { HistoryEntry, SegmentIndex, SegmentMeta, MessageMetadata } from '../storage/types.js';
import { atomicWriteJson, appendJsonLine, formatTimestampFilename } from '../storage/atomic-write.js';

const log = createLogger('history');

export class FileHistoryStore implements HistoryStore {
  private dataDir: string;
  private maxMessages: number;
  private maxSegmentSizeBytes: number;
  private maxSegments: number;

  constructor(
    dataDir: string,
    maxMessages: number = 100,
    maxSegmentSizeBytes: number = 524_288,
    maxSegments: number = 20,
  ) {
    this.dataDir = dataDir;
    this.maxMessages = maxMessages;
    this.maxSegmentSizeBytes = maxSegmentSizeBytes;
    this.maxSegments = maxSegments;
  }

  private getConversationDir(channelId: string, conversationId: string): string {
    const dir = join(this.dataDir, channelId, conversationId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getIndexPath(dir: string): string {
    return join(dir, '_index.json');
  }

  private readIndex(dir: string): SegmentIndex {
    const indexPath = this.getIndexPath(dir);
    if (!existsSync(indexPath)) {
      return { nextSeq: 1, segments: [] };
    }
    try {
      return JSON.parse(readFileSync(indexPath, 'utf-8')) as SegmentIndex;
    } catch (err) {
      log.error('Failed to read segment index, resetting', { dir, error: String(err) });
      return { nextSeq: 1, segments: [] };
    }
  }

  private writeIndex(dir: string, index: SegmentIndex): void {
    atomicWriteJson(this.getIndexPath(dir), index);
  }

  async getMessages(
    channelId: string,
    conversationId: string,
    limit?: number,
  ): Promise<ChatMessage[]> {
    const dir = join(this.dataDir, channelId, conversationId);
    if (!existsSync(dir)) return [];

    const index = this.readIndex(dir);
    if (index.segments.length === 0) return [];

    const max = limit ?? this.maxMessages;
    const collected: HistoryEntry[] = [];

    // Read segments from newest to oldest until we have enough
    for (let i = index.segments.length - 1; i >= 0 && collected.length < max; i--) {
      const seg = index.segments[i];
      const segPath = join(dir, seg.file);

      if (!existsSync(segPath)) {
        log.warn('Segment file missing, skipping', { file: seg.file });
        continue;
      }

      const entries = this.readSegmentFile(segPath);
      // Prepend in reverse order to maintain chronological order later
      collected.unshift(...entries);
    }

    // Trim to requested limit (take from end for most recent)
    const trimmed = collected.slice(-max);

    return trimmed.map(entryToChatMessage);
  }

  async addMessage(
    channelId: string,
    conversationId: string,
    message: ChatMessage,
    metadata?: MessageMetadata,
  ): Promise<void> {
    const dir = this.getConversationDir(channelId, conversationId);
    const index = this.readIndex(dir);

    const entry: HistoryEntry = {
      seq: index.nextSeq,
      ts: new Date().toISOString(),
      role: message.role,
      content: message.content,
      toolCallId: message.toolCallId,
      senderId: metadata?.senderId,
      platformMessageId: metadata?.platformMessageId,
      taskId: metadata?.taskId,
    };

    let currentSeg = index.segments[index.segments.length - 1];

    // Check if we need a new segment
    if (!currentSeg || currentSeg.sizeBytes >= this.maxSegmentSizeBytes) {
      const filename = formatTimestampFilename() + '.jsonl';
      currentSeg = {
        file: filename,
        firstSeq: entry.seq,
        lastSeq: entry.seq,
        count: 0,
        sizeBytes: 0,
        startedAt: entry.ts,
        endedAt: entry.ts,
      };
      index.segments.push(currentSeg);
    }

    // Append to the current segment file
    const segPath = join(dir, currentSeg.file);
    const bytesWritten = appendJsonLine(segPath, entry);

    // Update segment metadata
    currentSeg.lastSeq = entry.seq;
    currentSeg.count++;
    currentSeg.sizeBytes += bytesWritten;
    currentSeg.endedAt = entry.ts;

    index.nextSeq++;

    // Prune oldest segments if over limit
    while (index.segments.length > this.maxSegments) {
      const oldest = index.segments.shift()!;
      const oldPath = join(dir, oldest.file);
      try {
        if (existsSync(oldPath)) {
          unlinkSync(oldPath);
        }
      } catch (err) {
        log.warn('Failed to delete old segment', { file: oldest.file, error: String(err) });
      }
    }

    this.writeIndex(dir, index);
  }

  async clear(channelId: string, conversationId: string): Promise<void> {
    const dir = join(this.dataDir, channelId, conversationId);
    if (!existsSync(dir)) return;

    const index = this.readIndex(dir);

    // Delete all segment files
    for (const seg of index.segments) {
      const segPath = join(dir, seg.file);
      try {
        if (existsSync(segPath)) {
          unlinkSync(segPath);
        }
      } catch {
        // ignore
      }
    }

    // Write empty index
    this.writeIndex(dir, { nextSeq: 1, segments: [] });
    log.info('History cleared', { channelId, conversationId });
  }

  private readSegmentFile(filePath: string): HistoryEntry[] {
    const entries: HistoryEntry[] = [];
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed) as HistoryEntry);
        } catch {
          log.warn('Skipping corrupt JSONL line', { file: filePath });
        }
      }
    } catch (err) {
      log.error('Failed to read segment file', { file: filePath, error: String(err) });
    }
    return entries;
  }
}

function entryToChatMessage(entry: HistoryEntry): ChatMessage {
  const msg: ChatMessage = {
    role: entry.role,
    content: entry.content,
  };
  if (entry.toolCallId) {
    msg.toolCallId = entry.toolCallId;
  }
  return msg;
}
