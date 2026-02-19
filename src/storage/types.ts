/**
 * Storage types for history, journal, and task persistence.
 */

// ─── History ────────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  seq: number;
  ts: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  senderId?: string;
  platformMessageId?: string;
  taskId?: string;
}

export interface SegmentMeta {
  file: string;
  firstSeq: number;
  lastSeq: number;
  count: number;
  sizeBytes: number;
  startedAt: string;
  endedAt: string;
}

export interface SegmentIndex {
  nextSeq: number;
  segments: SegmentMeta[];
}

export interface MessageMetadata {
  senderId?: string;
  platformMessageId?: string;
  taskId?: string;
}

// ─── Journal ────────────────────────────────────────────────────────────────────

export type JournalEventType =
  | 'task_received'
  | 'pipeline_started'
  | 'history_appended'
  | 'llm_call_started'
  | 'llm_call_completed'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'verification_started'
  | 'verification_result'
  | 'response_sent'
  | 'task_completed'
  | 'task_failed'
  | 'skill_dispatched';

export interface JournalEntry {
  ts: string;
  event: JournalEventType;
  taskId: string;
  channelId: string;
  conversationId: string;
  data?: Record<string, unknown>;
}

// ─── Task Persistence ───────────────────────────────────────────────────────────

export type TaskPhase =
  | 'received'
  | 'history_written'
  | 'llm_calling'
  | 'verifying'
  | 'responding'
  | 'completed'
  | 'failed';

export interface PersistedTask {
  id: string;
  channelId: string;
  conversationId: string;
  originalMessage: {
    text: string;
    senderId: string;
    senderName?: string;
    platformMessageId?: string;
    timestamp: number;
  };
  phase: TaskPhase;
  startedAt: string;
  updatedAt: string;
  error?: string;
  pendingResponse?: string;
}
