import { createLogger } from 'agent-toolkit/logger';
import { ChannelManager } from '../channels/channel-manager.js';
import { TaskPersistence } from './task-persistence.js';
import { JournalWriter } from './journal-writer.js';
import { PersistedTask } from './types.js';

const log = createLogger('task-recovery');

/**
 * On startup, recovers orphaned tasks that were in-flight when the process
 * was interrupted. Notifies the user and moves tasks to completed.
 */
export class TaskRecoveryService {
  constructor(
    private channelManager: ChannelManager,
    private taskPersistence: TaskPersistence,
    private journal?: JournalWriter,
  ) {}

  async recover(): Promise<void> {
    const orphanedTasks = this.taskPersistence.listActive();

    if (orphanedTasks.length === 0) {
      log.info('No orphaned tasks found');
      return;
    }

    log.info('Found orphaned tasks', { count: orphanedTasks.length });

    for (const task of orphanedTasks) {
      await this.recoverTask(task);
    }
  }

  private async recoverTask(task: PersistedTask): Promise<void> {
    log.info('Recovering task', { taskId: task.id, phase: task.phase, channelId: task.channelId });

    const channel = this.channelManager.getChannel(task.channelId);

    try {
      switch (task.phase) {
        case 'received':
        case 'history_written':
        case 'llm_calling': {
          // Early phases — message was not processed, ask user to resend
          if (channel) {
            await channel.sendMessage(task.conversationId, {
              text: `Your message was interrupted during processing. Please resend it.`,
              replyToMessageId: task.originalMessage.platformMessageId,
            });
          }
          this.journal?.log('task_failed', task.id, task.channelId, task.conversationId, {
            recovery: true,
            phase: task.phase,
            action: 'notify_resend',
          });
          break;
        }

        case 'verifying': {
          // Had a pending response — send it with a disclaimer
          if (task.pendingResponse && channel) {
            await channel.sendMessage(task.conversationId, {
              text: `[Recovered after interruption — response may not have been fully verified]\n\n${task.pendingResponse}`,
              replyToMessageId: task.originalMessage.platformMessageId,
            });
          } else if (channel) {
            await channel.sendMessage(task.conversationId, {
              text: `Your message was interrupted during processing. Please resend it.`,
              replyToMessageId: task.originalMessage.platformMessageId,
            });
          }
          this.journal?.log('task_failed', task.id, task.channelId, task.conversationId, {
            recovery: true,
            phase: task.phase,
            action: task.pendingResponse ? 'sent_unverified' : 'notify_resend',
          });
          break;
        }

        case 'responding': {
          // Had a response ready to send
          if (task.pendingResponse && channel) {
            await channel.sendMessage(task.conversationId, {
              text: task.pendingResponse,
              replyToMessageId: task.originalMessage.platformMessageId,
            });
          }
          this.journal?.log('task_failed', task.id, task.channelId, task.conversationId, {
            recovery: true,
            phase: task.phase,
            action: task.pendingResponse ? 'resent_response' : 'no_response',
          });
          break;
        }

        case 'completed':
        case 'failed': {
          // Stale files — just move to completed
          log.info('Stale task file, moving to completed', { taskId: task.id, phase: task.phase });
          break;
        }
      }

      // Move task to completed regardless
      this.taskPersistence.complete(task.id);
    } catch (err) {
      log.error('Failed to recover task', { taskId: task.id, error: String(err) });
      // Still move to completed to avoid infinite retry
      this.taskPersistence.fail(task.id, `Recovery failed: ${String(err)}`);
    }
  }
}
