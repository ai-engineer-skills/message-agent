import { existsSync, readdirSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from 'agent-toolkit/logger';
import { PersistedTask, TaskPhase } from './types.js';
import { atomicWriteJson } from './atomic-write.js';
import { NormalizedMessage } from '../types/message.js';

const log = createLogger('task-persistence');

export class TaskPersistence {
  private activeDir: string;
  private completedDir: string;
  private enabled: boolean;

  constructor(opts: {
    tasksDir: string;
    enabled?: boolean;
  }) {
    this.enabled = opts.enabled ?? true;
    this.activeDir = join(opts.tasksDir, 'active');
    this.completedDir = join(opts.tasksDir, 'completed');

    if (this.enabled) {
      mkdirSync(this.activeDir, { recursive: true });
      mkdirSync(this.completedDir, { recursive: true });
    }
  }

  /**
   * Write initial task state when a task is submitted.
   */
  persist(taskId: string, message: NormalizedMessage): void {
    if (!this.enabled) return;

    try {
      const task: PersistedTask = {
        id: taskId,
        channelId: message.channelId,
        conversationId: message.conversationId,
        originalMessage: {
          text: message.text,
          senderId: message.senderId,
          senderName: message.senderName,
          platformMessageId: message.platformMessageId,
          timestamp: message.timestamp,
        },
        phase: 'received',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      atomicWriteJson(join(this.activeDir, `${taskId}.json`), task);
    } catch (err) {
      log.error('Failed to persist task', { taskId, error: String(err) });
    }
  }

  /**
   * Update task phase during pipeline execution.
   */
  async updatePhase(
    taskId: string,
    phase: TaskPhase,
    extra?: { pendingResponse?: string; error?: string },
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const filePath = join(this.activeDir, `${taskId}.json`);
      if (!existsSync(filePath)) return;

      const task = JSON.parse(readFileSync(filePath, 'utf-8')) as PersistedTask;
      task.phase = phase;
      task.updatedAt = new Date().toISOString();
      if (extra?.pendingResponse !== undefined) task.pendingResponse = extra.pendingResponse;
      if (extra?.error !== undefined) task.error = extra.error;

      atomicWriteJson(filePath, task);
    } catch (err) {
      log.error('Failed to update task phase', { taskId, phase, error: String(err) });
    }
  }

  /**
   * Move task from active to completed.
   */
  complete(taskId: string): void {
    if (!this.enabled) return;

    try {
      const activePath = join(this.activeDir, `${taskId}.json`);
      if (!existsSync(activePath)) return;

      const task = JSON.parse(readFileSync(activePath, 'utf-8')) as PersistedTask;
      task.updatedAt = new Date().toISOString();

      const dateDir = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const destDir = join(this.completedDir, dateDir);
      mkdirSync(destDir, { recursive: true });

      atomicWriteJson(join(destDir, `${taskId}.json`), task);
      unlinkSync(activePath);
    } catch (err) {
      log.error('Failed to complete task', { taskId, error: String(err) });
    }
  }

  /**
   * Mark a task as failed, then move to completed.
   */
  fail(taskId: string, error: string): void {
    if (!this.enabled) return;

    try {
      const activePath = join(this.activeDir, `${taskId}.json`);
      if (!existsSync(activePath)) return;

      const task = JSON.parse(readFileSync(activePath, 'utf-8')) as PersistedTask;
      task.phase = 'failed';
      task.error = error;
      task.updatedAt = new Date().toISOString();
      atomicWriteJson(activePath, task);

      this.complete(taskId);
    } catch (err) {
      log.error('Failed to mark task as failed', { taskId, error: String(err) });
    }
  }

  /**
   * List all orphaned (active) tasks.
   */
  listActive(): PersistedTask[] {
    if (!this.enabled) return [];

    try {
      if (!existsSync(this.activeDir)) return [];

      const files = readdirSync(this.activeDir).filter((f) => f.endsWith('.json'));
      const tasks: PersistedTask[] = [];

      for (const file of files) {
        try {
          const data = readFileSync(join(this.activeDir, file), 'utf-8');
          tasks.push(JSON.parse(data) as PersistedTask);
        } catch {
          log.warn('Failed to read active task file', { file });
        }
      }

      return tasks;
    } catch {
      return [];
    }
  }
}
