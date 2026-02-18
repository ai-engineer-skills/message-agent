export interface HostConfig {
  persona: PersonaConfig;
  llm: LlmConfig;
  channels: Record<string, ChannelConfig>;
  mcp?: McpConfig;
  verification: VerificationConfig;
  skills?: SkillsConfig;
  history?: HistoryConfig;
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
  type: 'telegram' | 'whatsapp' | 'wechat' | 'imessage';
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
}
