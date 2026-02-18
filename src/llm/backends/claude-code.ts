import { spawn } from 'node:child_process';
import { createLogger } from 'agent-toolkit/logger';
import {
  ExtendedLLMProvider,
  ChatMessage,
  ChatCompletionResult,
  ToolDefinition,
  LLMCompletionResult,
} from '../llm-provider.js';

const log = createLogger('llm:claude-code');

export class ClaudeCodeLLMProvider implements ExtendedLLMProvider {
  public readonly name = 'claude-code';
  private model: string;

  constructor(options?: { model?: string }) {
    this.model = options?.model ?? 'claude-sonnet-4-20250514';
  }

  async initialize(): Promise<void> {
    log.info('Claude Code provider ready', { model: this.model });
  }

  async dispose(): Promise<void> {}

  async complete(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMCompletionResult> {
    const prompt = `${systemPrompt}\n\n${userPrompt}`;
    const content = await this.runClaude(prompt);
    return { content, model: this.model };
  }

  async chat(
    messages: ChatMessage[],
    _options?: { tools?: ToolDefinition[]; maxTokens?: number },
  ): Promise<ChatCompletionResult> {
    const prompt = messages
      .map((m) => {
        if (m.role === 'system') return `[System]\n${m.content}`;
        if (m.role === 'user') return `[User]\n${m.content}`;
        if (m.role === 'assistant') return `[Assistant]\n${m.content}`;
        return `[Tool Result]\n${m.content}`;
      })
      .join('\n\n');

    const content = await this.runClaude(prompt);
    return { content, model: this.model };
  }

  private runClaude(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['--print', prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          log.error('claude CLI failed', { code, stderr });
          reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
          return;
        }
        resolve(stdout.trim());
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
      });
    });
  }
}
