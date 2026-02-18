import { createLogger } from 'agent-toolkit/logger';
import { NormalizedMessage, OutgoingMessage } from '../types/message.js';
import { HostConfig, VerificationConfig } from '../types/config.js';
import { ExtendedLLMService } from '../llm/llm-service.js';
import { ChatMessage, ToolDefinition } from '../llm/llm-provider.js';
import { McpClientManager } from '../mcp/mcp-client-manager.js';
import { SkillHandler } from '../skills/skill-handler.js';
import { SkillRegistry } from '../skills/skill-registry.js';
import { HistoryStore } from '../history/history-store.js';
import { ChannelManager } from '../channels/channel-manager.js';
import {
  Verifier,
  CompositeVerifier,
  VerificationContext,
} from './verification/verifier.js';
import { RuleVerifier } from './verification/rule-verifier.js';
import { LLMVerifier } from './verification/llm-verifier.js';
import { getBuiltinRules } from './verification/rules/index.js';

const log = createLogger('agent');

export class AgentService {
  private skillHandler: SkillHandler;
  private verifier: Verifier;
  private verificationConfig: VerificationConfig;
  private lastResponses = new Map<string, string>();

  constructor(
    private config: HostConfig,
    private llmService: ExtendedLLMService,
    private mcpManager: McpClientManager,
    private skillRegistry: SkillRegistry,
    private historyStore: HistoryStore,
    private channelManager: ChannelManager,
    reviewLlmService?: ExtendedLLMService,
  ) {
    this.skillHandler = new SkillHandler(skillRegistry);
    this.verificationConfig = config.verification;

    // Build composite verifier
    const verifiers: Verifier[] = [];

    if (config.verification.rules.enabled) {
      const ruleVerifier = new RuleVerifier();
      for (const rule of getBuiltinRules()) {
        ruleVerifier.addRule(rule);
      }
      verifiers.push(ruleVerifier);
    }

    if (config.verification.llmReview.enabled) {
      verifiers.push(
        new LLMVerifier(
          reviewLlmService ?? llmService,
          config.verification.confidenceThreshold,
        ),
      );
    }

    this.verifier = new CompositeVerifier(verifiers);

    // Wire up builtin skills with concrete implementations
    this.wireBuiltinSkills();
  }

  private wireBuiltinSkills(): void {
    const helpDef = this.skillRegistry.get('help');
    if (helpDef) {
      helpDef.execute = async () => {
        const skills = this.skillRegistry.getUserInvocable();
        const lines = skills.map(
          (s) => `/${s.name} — ${s.description}${s.argumentHint ? ` (${s.argumentHint})` : ''}`,
        );
        return {
          text: `**Available commands:**\n${lines.join('\n')}`,
          handled: true,
        };
      };
    }

    const clearDef = this.skillRegistry.get('clear');
    if (clearDef) {
      clearDef.execute = async (ctx) => {
        await this.historyStore.clear(ctx.channelId, ctx.conversationId);
        return { text: 'Conversation history cleared.', handled: true };
      };
    }

    const statusDef = this.skillRegistry.get('status');
    if (statusDef) {
      statusDef.execute = async () => {
        const statuses = this.channelManager.getAllStatuses();
        const lines = statuses.map(
          (s) => `• ${s.id} (${s.type}): ${s.status}${s.error ? ` — ${s.error}` : ''}`,
        );
        return {
          text: `**Channel Status:**\n${lines.join('\n')}`,
          handled: true,
        };
      };
    }

    const personaDef = this.skillRegistry.get('persona');
    if (personaDef) {
      personaDef.execute = async () => {
        return {
          text: `**Current Persona:** ${this.config.persona.name}\n\n${this.config.persona.systemPrompt}`,
          handled: true,
        };
      };
    }

    const retryDef = this.skillRegistry.get('retry');
    if (retryDef) {
      retryDef.execute = async (ctx) => {
        const key = `${ctx.channelId}:${ctx.conversationId}`;
        const lastResponse = this.lastResponses.get(key);
        if (!lastResponse) {
          return { text: 'No previous response to retry.', handled: true };
        }

        const history = await this.historyStore.getMessages(
          ctx.channelId,
          ctx.conversationId,
        );
        const lastUserMsg = [...history]
          .reverse()
          .find((m) => m.role === 'user');
        if (!lastUserMsg) {
          return { text: 'No previous request found.', handled: true };
        }

        const result = await this.runVerificationLoop(
          lastUserMsg.content,
          lastResponse,
          ctx.channelId,
          ctx.conversationId,
          history,
        );
        return { text: result, handled: true };
      };
    }
  }

  async handleMessage(message: NormalizedMessage): Promise<void> {
    const channel = this.channelManager.getChannel(message.channelId);
    if (!channel) {
      log.error('Unknown channel', { channelId: message.channelId });
      return;
    }

    // Layer 1: Slash command detection
    const dispatch = await this.skillHandler.dispatch(message);

    if (dispatch.handled) {
      if (dispatch.result) {
        // Builtin skill with direct result
        await channel.sendMessage(message.conversationId, {
          text: dispatch.result.text,
        });
        return;
      }

      if (dispatch.instructions) {
        // SKILL.md-based skill — use instructions as system prompt
        await channel.sendTypingIndicator(message.conversationId);
        const result = await this.llmService.complete(
          dispatch.instructions,
          message.text,
        );
        await channel.sendMessage(message.conversationId, {
          text: result.content,
        });
        return;
      }
    }

    // Normal LLM conversation pipeline
    await channel.sendTypingIndicator(message.conversationId);

    // Append user message to history
    await this.historyStore.addMessage(
      message.channelId,
      message.conversationId,
      { role: 'user', content: message.text },
    );

    // Build messages
    const history = await this.historyStore.getMessages(
      message.channelId,
      message.conversationId,
    );
    const messages: ChatMessage[] = [
      { role: 'system', content: this.config.persona.systemPrompt },
      ...history,
    ];

    // Gather MCP tools
    const tools = this.mcpManager.getAllTools();

    // Add SKILL.md-based skills as LLM-selectable tools (intent classification)
    const skillTools = this.skillRegistry
      .getForLLM()
      .filter((s) => s.source === 'skillmd')
      .map((s) => ({
        name: `skill__${s.name}`,
        description: s.description,
        inputSchema: {
          type: 'object' as const,
          properties: {
            arguments: { type: 'string', description: 'Arguments for the skill' },
          },
        },
      }));

    const allTools: ToolDefinition[] = [...tools, ...skillTools];

    // LLM call with tool-use loop
    let response = await this.runToolLoop(messages, allTools);

    // Verification loop
    const channelConfig = Object.values(this.config.channels).find(
      (c) => c.type === channel.type,
    );
    const verificationConfig = {
      ...this.verificationConfig,
      ...(channelConfig?.verification ?? {}),
    };

    if (this.shouldVerify(message.text, response, verificationConfig)) {
      response = await this.runVerificationLoop(
        message.text,
        response,
        message.channelId,
        message.conversationId,
        history,
        verificationConfig,
      );
    }

    // Save response to history
    await this.historyStore.addMessage(
      message.channelId,
      message.conversationId,
      { role: 'assistant', content: response },
    );

    // Track last response for /retry
    const key = `${message.channelId}:${message.conversationId}`;
    this.lastResponses.set(key, response);

    // Send response
    await channel.sendMessage(message.conversationId, { text: response });
  }

  private async runToolLoop(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    maxIterations: number = 10,
  ): Promise<string> {
    let currentMessages = [...messages];
    let iterations = 0;

    while (iterations < maxIterations) {
      const result = await this.llmService.chat(currentMessages, {
        tools: tools.length > 0 ? tools : undefined,
      });

      if (!result.toolCalls || result.toolCalls.length === 0) {
        return result.content;
      }

      // Add assistant message with tool calls
      currentMessages.push({
        role: 'assistant',
        content: result.content || '',
      });

      // Execute each tool call
      for (const toolCall of result.toolCalls) {
        let toolResult: string;

        if (toolCall.name.startsWith('skill__')) {
          // Skill invocation via LLM intent classification
          const skillName = toolCall.name.slice(7);
          const skill = this.skillRegistry.get(skillName);
          if (skill?.instructions) {
            const args = (toolCall.arguments as { arguments?: string }).arguments ?? '';
            const instructions = skill.instructions.replace(
              /\$ARGUMENTS/g,
              args || '(no arguments)',
            );
            const skillResult = await this.llmService.complete(
              instructions,
              args,
            );
            toolResult = skillResult.content;
          } else {
            toolResult = `Skill ${skillName} not found`;
          }
        } else {
          // MCP tool invocation
          try {
            toolResult = await this.mcpManager.invokeTool(
              toolCall.name,
              toolCall.arguments,
            );
          } catch (err) {
            toolResult = `Tool error: ${String(err)}`;
            log.error('Tool invocation failed', {
              tool: toolCall.name,
              error: String(err),
            });
          }
        }

        currentMessages.push({
          role: 'tool',
          content: toolResult,
          toolCallId: toolCall.id,
        });
      }

      iterations++;
    }

    log.warn('Tool loop reached max iterations', { maxIterations });
    const finalResult = await this.llmService.chat(currentMessages);
    return finalResult.content;
  }

  private shouldVerify(
    request: string,
    response: string,
    config: VerificationConfig,
  ): boolean {
    if (!config.enabled) return false;

    if (
      config.skipForShortResponses &&
      response.length < config.shortResponseThreshold
    ) {
      return false;
    }

    // Skip for simple greetings
    const greetingPatterns = /^(hi|hello|hey|thanks|thank you|ok|bye)\s*[!.]?$/i;
    if (greetingPatterns.test(request.trim())) return false;

    return true;
  }

  private async runVerificationLoop(
    request: string,
    response: string,
    channelId: string,
    conversationId: string,
    history: ChatMessage[],
    config?: VerificationConfig,
  ): Promise<string> {
    const maxRetries = config?.maxRetries ?? this.verificationConfig.maxRetries;
    let currentResponse = response;
    let cumulativeFeedback = '';

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const context: VerificationContext = {
        conversationHistory: history.map((m) => m.content),
        attempt,
      };

      const result = await this.verifier.verify(
        request,
        currentResponse,
        context,
      );

      log.info('Verification result', {
        attempt,
        rating: result.rating,
        confidence: result.confidence,
        passed: result.passed,
      });

      if (result.passed) return currentResponse;

      cumulativeFeedback += `\nAttempt ${attempt + 1} feedback: ${result.feedback}`;

      if (result.rating === 'REDO') {
        // Full restart
        const messages: ChatMessage[] = [
          {
            role: 'system',
            content: `${this.config.persona.systemPrompt}\n\nPrevious attempt failed verification. Feedback:${cumulativeFeedback}\n\nPlease provide a complete, improved response.`,
          },
          ...history,
        ];
        const newResult = await this.llmService.chat(messages);
        currentResponse = newResult.content;
      } else {
        // Selective revision (NEEDS_FIX)
        const messages: ChatMessage[] = [
          { role: 'system', content: this.config.persona.systemPrompt },
          ...history,
          { role: 'assistant', content: currentResponse },
          {
            role: 'user',
            content: `Your response has issues that need fixing:\n${result.feedback}\n\nPlease revise your response to address these specific issues.`,
          },
        ];
        const newResult = await this.llmService.chat(messages);
        currentResponse = newResult.content;
      }
    }

    log.warn('Verification exhausted retries, sending last response');
    return currentResponse;
  }
}
