import { createLogger } from 'agent-toolkit/logger';
import {
  ExtendedLLMProvider,
  ChatMessage,
  ChatCompletionResult,
  ToolDefinition,
  LLMCompletionResult,
} from './llm-provider.js';

const log = createLogger('llm-service');

export class ExtendedLLMService {
  private provider: ExtendedLLMProvider;

  constructor(provider: ExtendedLLMProvider) {
    this.provider = provider;
  }

  async initialize(): Promise<void> {
    log.info('Initializing LLM provider', { provider: this.provider.name });
    const start = Date.now();
    await this.provider.initialize();
    log.info('LLM provider initialized', {
      provider: this.provider.name,
      durationMs: Date.now() - start,
    });
  }

  async dispose(): Promise<void> {
    log.info('Disposing LLM provider', { provider: this.provider.name });
    await this.provider.dispose();
  }

  async complete(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMCompletionResult> {
    log.debug('LLM completion request', { provider: this.provider.name });
    const start = Date.now();
    const result = await this.provider.complete(systemPrompt, userPrompt);
    log.info('LLM completion done', {
      provider: this.provider.name,
      model: result.model,
      durationMs: Date.now() - start,
    });
    return result;
  }

  async chat(
    messages: ChatMessage[],
    options?: { tools?: ToolDefinition[]; maxTokens?: number },
  ): Promise<ChatCompletionResult> {
    log.debug('LLM chat request', {
      provider: this.provider.name,
      messageCount: messages.length,
      toolCount: options?.tools?.length ?? 0,
    });
    const start = Date.now();
    const result = await this.provider.chat(messages, options);
    log.info('LLM chat done', {
      provider: this.provider.name,
      model: result.model,
      toolCalls: result.toolCalls?.length ?? 0,
      durationMs: Date.now() - start,
    });
    return result;
  }

  getProviderName(): string {
    return this.provider.name;
  }
}
