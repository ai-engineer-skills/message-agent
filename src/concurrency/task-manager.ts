import { randomUUID } from 'node:crypto';
import { createLogger } from 'agent-toolkit/logger';
import { NormalizedMessage } from '../types/message.js';
import { Channel } from '../types/channel.js';
import { ConversationTask, TaskPipelineRunner } from './types.js';
import { TaskPersistence } from '../storage/task-persistence.js';

const log = createLogger('task-manager');

export class TaskManager {
  private activeTasks = new Map<string, ConversationTask>();
  private typingIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private taskPersistence: TaskPersistence | undefined;

  constructor(
    private getChannel: (channelId: string) => Channel | undefined,
    taskPersistence?: TaskPersistence,
  ) {
    this.taskPersistence = taskPersistence;
  }

  submit(
    message: NormalizedMessage,
    pipeline: TaskPipelineRunner,
  ): string {
    const taskId = randomUUID();
    const task: ConversationTask = {
      id: taskId,
      conversationId: message.conversationId,
      channelId: message.channelId,
      originalMessage: message,
      status: 'running',
      startedAt: Date.now(),
    };

    this.activeTasks.set(taskId, task);
    this.ensureTypingIndicator(message.channelId, message.conversationId);

    // Persist initial task state
    this.taskPersistence?.persist(taskId, message);

    // Fire the pipeline in the background
    pipeline(message)
      .then(() => {
        task.status = 'completed';
        task.completedAt = Date.now();
        this.taskPersistence?.complete(taskId);
      })
      .catch((err) => {
        task.status = 'failed';
        task.completedAt = Date.now();
        task.error = String(err);
        log.error('Task pipeline failed', { taskId, error: String(err) });
        this.taskPersistence?.fail(taskId, String(err));
        this.sendErrorReply(message, String(err));
      })
      .finally(() => {
        this.activeTasks.delete(taskId);
        this.cleanupTypingIfDone(message.channelId, message.conversationId);
      });

    return taskId;
  }

  getTaskStatus(): ConversationTask[] {
    return Array.from(this.activeTasks.values());
  }

  private ensureTypingIndicator(channelId: string, conversationId: string): void {
    const key = `${channelId}:${conversationId}`;
    if (this.typingIntervals.has(key)) return;

    const channel = this.getChannel(channelId);
    if (!channel) return;

    // Send immediately
    channel.sendTypingIndicator(conversationId).catch(() => {});

    // Refresh every 4s (Telegram expires at ~5s)
    const interval = setInterval(() => {
      channel.sendTypingIndicator(conversationId).catch(() => {});
    }, 4000);

    this.typingIntervals.set(key, interval);
  }

  private cleanupTypingIfDone(channelId: string, conversationId: string): void {
    const key = `${channelId}:${conversationId}`;

    // Check if any active tasks remain for this conversation
    const hasActive = Array.from(this.activeTasks.values()).some(
      (t) => t.channelId === channelId && t.conversationId === conversationId,
    );

    if (!hasActive) {
      const interval = this.typingIntervals.get(key);
      if (interval) {
        clearInterval(interval);
        this.typingIntervals.delete(key);
      }
    }
  }

  private sendErrorReply(message: NormalizedMessage, error: string): void {
    const channel = this.getChannel(message.channelId);
    if (!channel) return;

    channel
      .sendMessage(message.conversationId, {
        text: `⚠ An error occurred processing your message: ${error}`,
        replyToMessageId: message.platformMessageId,
      })
      .catch((sendErr) => {
        log.error('Failed to send error reply', { error: String(sendErr) });
      });
  }
}
