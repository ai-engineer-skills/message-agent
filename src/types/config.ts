export interface HostConfig {
  persona: PersonaConfig;
  llm: LlmConfig;
  channels: Record<string, ChannelConfig>;
  mcp?: McpConfig;
  verification: VerificationConfig;
  skills?: SkillsConfig;
  history?: HistoryConfig;
  health?: HealthConfig;
  journal?: JournalConfig;
  taskPersistence?: TaskPersistenceConfig;
  web?: WebConfig;
}

export interface PersonaConfig {
  name: string;
  systemPrompt: string;
}

export interface LlmConfig {
  provider: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  githubToken?: string;
}

export interface ChannelConfig {
  type: 'telegram' | 'whatsapp' | 'wechat' | 'imessage' | 'web';
  enabled: boolean;
  token?: string;
  sessionDataPath?: string;
  puppetProvider?: string;
  enabledSkills?: string[];
  verification?: Partial<VerificationConfig>;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface VerificationConfig {
  enabled: boolean;
  maxRetries: number;
  confidenceThreshold: number;
  skipForShortResponses: boolean;
  shortResponseThreshold: number;
  llmReview: {
    enabled: boolean;
    provider?: string;
    model?: string;
  };
  rules: {
    enabled: boolean;
  };
}

export interface SkillsConfig {
  directories?: string[];
}

export interface HistoryConfig {
  dataDir?: string;
  maxMessages?: number;
  maxSegmentSizeBytes?: number;
  maxSegments?: number;
}

export interface HealthConfig {
  /** Heartbeat write interval in ms. Default: 10_000 */
  heartbeatIntervalMs?: number;
  /** Path to heartbeat file. Default: <DATA_ROOT>/health/heartbeat.json */
  heartbeatFile?: string;
  /** HTTP health endpoint port. Default: 3001 */
  httpPort?: number;
  /** Whether to enable the HTTP health endpoint. Default: true */
  httpEnabled?: boolean;
  /** Channel health check interval in ms. Default: 30_000 */
  channelCheckIntervalMs?: number;
  /** Initial reconnect delay in ms. Default: 2_000 */
  reconnectBaseDelayMs?: number;
  /** Max reconnect delay after backoff in ms. Default: 120_000 */
  reconnectMaxDelayMs?: number;
  /** Max consecutive reconnect attempts. Default: 10 */
  maxReconnectAttempts?: number;
  /** Path to the recovery event file written by the watchdog. Default: <DATA_ROOT>/health/recovery-event.json */
  recoveryEventFile?: string;
  /** Conversations to notify on recovery. Format: ["channelId:conversationId", ...] */
  notifyOnRecovery?: string[];
}

export interface JournalConfig {
  enabled?: boolean;
  maxSegmentSizeBytes?: number;
  maxSegments?: number;
}

export interface TaskPersistenceConfig {
  enabled?: boolean;
  completedRetentionDays?: number;
  recoverOnStartup?: boolean;
}

export interface WebConfig {
  enabled?: boolean;
  port?: number;
}
