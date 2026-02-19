import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { HostConfig, VerificationConfig } from './types/config.js';

const DEFAULT_VERIFICATION: VerificationConfig = {
  enabled: true,
  maxRetries: 3,
  confidenceThreshold: 0.7,
  skipForShortResponses: true,
  shortResponseThreshold: 50,
  llmReview: { enabled: true },
  rules: { enabled: true },
};

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
}

function walkAndResolve(obj: unknown): unknown {
  if (typeof obj === 'string') return resolveEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(walkAndResolve);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = walkAndResolve(v);
    }
    return result;
  }
  return obj;
}

export function loadConfig(path: string): HostConfig {
  const raw = readFileSync(path, 'utf-8');
  const parsed = walkAndResolve(parse(raw)) as Record<string, unknown>;

  const config: HostConfig = {
    persona: (parsed.persona as HostConfig['persona']) ?? {
      name: 'Assistant',
      systemPrompt: 'You are a helpful assistant.',
    },
    llm: (parsed.llm as HostConfig['llm']) ?? { provider: 'direct-api' },
    channels: (parsed.channels as HostConfig['channels']) ?? {},
    mcp: parsed.mcp as HostConfig['mcp'],
    verification: {
      ...DEFAULT_VERIFICATION,
      ...((parsed.verification as Partial<VerificationConfig>) ?? {}),
    },
    skills: parsed.skills as HostConfig['skills'],
    history: parsed.history as HostConfig['history'],
    health: parsed.health as HostConfig['health'],
    journal: parsed.journal as HostConfig['journal'],
    taskPersistence: parsed.taskPersistence as HostConfig['taskPersistence'],
    web: parsed.web as HostConfig['web'],
  };

  return config;
}
