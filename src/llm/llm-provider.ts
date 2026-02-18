import {
  LLMProvider as BaseLLMProvider,
  LLMCompletionResult,
} from 'agent-toolkit/services/llm-provider';

export { LLMCompletionResult } from 'agent-toolkit/services/llm-provider';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatCompletionResult extends LLMCompletionResult {
  toolCalls?: ToolCall[];
}

export interface ExtendedLLMProvider extends BaseLLMProvider {
  chat(
    messages: ChatMessage[],
    options?: { tools?: ToolDefinition[]; maxTokens?: number },
  ): Promise<ChatCompletionResult>;
}
