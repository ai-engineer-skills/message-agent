import { createLogger } from 'agent-toolkit/logger';
import { NormalizedMessage } from '../types/message.js';
import { HostConfig, VerificationConfig } from '../types/config.js';
import { ExtendedLLMService } from '../llm/llm-service.js';
import { ChatMessage, ToolDefinition } from '../llm/llm-provider.js';
import { McpClientManager } from '../mcp/mcp-client-manager.js';
import { SkillHandler } from '../skills/skill-handler.js';
import { SkillRegistry } from '../skills/skill-registry.js';
import { HistoryStore } from '../history/history-store.js';
import { ChannelManager } from '../channels/channel-manager.js';
import { TaskManager } from '../concurrency/task-manager.js';
import { ConversationMutex } from '../concurrency/conversation-mutex.js';
import {
  Verifier,
  CompositeVerifier,
  VerificationContext,
} from './verification/verifier.js';
import { RuleVerifier } from './verification/rule-verifier.js';
import { LLMVerifier } from './verification/llm-verifier.js';
import { getBuiltinRules } from './verification/rules/index.js';
import { JournalWriter } from '../storage/journal-writer.js';
import { TaskPersistence } from '../storage/task-persistence.js';

const log = createLogger('agent');

export class AgentService {
  private skillHandler: SkillHandler;
  private verifier: Verifier;
  private verificationConfig: VerificationConfig;
  private lastResponses = new Map<string, string>();
  private taskManager: TaskManager;
  private historyMutex = new ConversationMutex();
  private journal: JournalWriter | undefined;
  private taskPersistence: TaskPersistence | undefined;

  constructor(
    private config: HostConfig,
    private llmService: ExtendedLLMService,
    private mcpManager: McpClientManager,
    private skillRegistry: SkillRegistry,
    private historyStore: HistoryStore,
    private channelManager: ChannelManager,
    taskManager: TaskManager,
    reviewLlmService?: ExtendedLLMService,
    journal?: JournalWriter,
    taskPersistence?: TaskPersistence,
  ) {
    this.skillHandler = new SkillHandler(skillRegistry);
    this.verificationConfig = config.verification;
    this.journal = journal;
    this.taskPersistence = taskPersistence;
    this.taskManager = taskManager;

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
        const channelLines = statuses.map(
          (s) => `• ${s.id} (${s.type}): ${s.status}${s.error ? ` — ${s.error}` : ''}`,
        );

        const activeTasks = this.taskManager.getTaskStatus();
        let taskSection = '';
        if (activeTasks.length > 0) {
          const taskLines = activeTasks.map((t) => {
            const elapsed = Math.round((Date.now() - t.startedAt) / 1000);
            return `• [${t.status}] ${t.conversationId} — "${t.originalMessage.text.slice(0, 50)}" (${elapsed}s)`;
          });
          taskSection = `\n\n**Active Tasks (${activeTasks.length}):**\n${taskLines.join('\n')}`;
        } else {
          taskSection = '\n\n**Active Tasks:** None';
        }

        return {
          text: `**Channel Status:**\n${channelLines.join('\n')}${taskSection}`,
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

    // Layer 1: Slash command detection (fast, synchronous — no background needed)
    const dispatch = await this.skillHandler.dispatch(message);

    if (dispatch.handled) {
      if (dispatch.result) {
        // Builtin skill with direct result
        await channel.sendMessage(message.conversationId, {
          text: dispatch.result.text,
          replyToMessageId: message.platformMessageId,
        });
        return;
      }

      if (dispatch.instructions) {
        // SKILL.md-based skill — submit as background task
        const instructions = dispatch.instructions;
        this.taskManager.submit(message, async (msg) => {
          this.journal?.log('skill_dispatched', msg.id, msg.channelId, msg.conversationId, {
            skill: msg.text.split(' ')[0],
          });
          const result = await this.llmService.complete(
            instructions,
            msg.text,
          );
          await channel.sendMessage(msg.conversationId, {
            text: result.content,
            replyToMessageId: msg.platformMessageId,
          });
        });
        return;
      }
    }

    // Normal LLM conversation — submit as background task
    this.taskManager.submit(message, (msg) => this.runPipeline(msg));
  }

  private async runPipeline(message: NormalizedMessage): Promise<void> {
    const channel = this.channelManager.getChannel(message.channelId);
    if (!channel) return;

    const taskId = message.id;
    const mutexKey = `${message.channelId}:${message.conversationId}`;

    this.journal?.log('pipeline_started', taskId, message.channelId, message.conversationId);

    // Update task phase
    await this.taskPersistence?.updatePhase(taskId, 'history_written');

    // Append user message to history (mutex-protected)
    let release = await this.historyMutex.acquire(mutexKey);
    try {
      await this.historyStore.addMessage(
        message.channelId,
        message.conversationId,
        { role: 'user', content: message.text },
        {
          senderId: message.senderId,
          platformMessageId: message.platformMessageId,
        },
      );
      this.journal?.log('history_appended', taskId, message.channelId, message.conversationId, {
        role: 'user',
      });
    } finally {
      release();
    }

    // Read history snapshot (mutex-protected)
    let history: ChatMessage[];
    release = await this.historyMutex.acquire(mutexKey);
    try {
      history = await this.historyStore.getMessages(
        message.channelId,
        message.conversationId,
      );
    } finally {
      release();
    }

    // Build messages
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

    // LLM call with tool-use loop (no mutex needed — LLM is stateless)
    await this.taskPersistence?.updatePhase(taskId, 'llm_calling');
    this.journal?.log('llm_call_started', taskId, message.channelId, message.conversationId);

    const llmStart = Date.now();
    let response = await this.runToolLoop(messages, allTools, 10, taskId, message.channelId, message.conversationId);
    const llmDuration = Date.now() - llmStart;

    this.journal?.log('llm_call_completed', taskId, message.channelId, message.conversationId, {
      durationMs: llmDuration,
    });

    // Verification loop (no mutex needed)
    const channelConfig = Object.values(this.config.channels).find(
      (c) => c.type === channel.type,
    );
    const verificationConfig = {
      ...this.verificationConfig,
      ...(channelConfig?.verification ?? {}),
    };

    if (this.shouldVerify(message.text, response, verificationConfig)) {
      await this.taskPersistence?.updatePhase(taskId, 'verifying', { pendingResponse: response });
      this.journal?.log('verification_started', taskId, message.channelId, message.conversationId);

      response = await this.runVerificationLoop(
        message.text,
        response,
        message.channelId,
        message.conversationId,
        history,
        verificationConfig,
      );
    }

    // Save response to history (mutex-protected)
    await this.taskPersistence?.updatePhase(taskId, 'responding', { pendingResponse: response });

    release = await this.historyMutex.acquire(mutexKey);
    try {
      await this.historyStore.addMessage(
        message.channelId,
        message.conversationId,
        { role: 'assistant', content: response },
      );
      this.journal?.log('history_appended', taskId, message.channelId, message.conversationId, {
        role: 'assistant',
      });
    } finally {
      release();
    }

    // Track last response for /retry
    const key = `${message.channelId}:${message.conversationId}`;
    this.lastResponses.set(key, response);

    // Send response with reply-to
    await channel.sendMessage(message.conversationId, {
      text: response,
      replyToMessageId: message.platformMessageId,
    });

    this.journal?.log('response_sent', taskId, message.channelId, message.conversationId);
    this.journal?.log('task_completed', taskId, message.channelId, message.conversationId);
  }

  private async runToolLoop(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    maxIterations: number = 10,
    taskId?: string,
    channelId?: string,
    conversationId?: string,
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
            this.journal?.log('tool_call_started', taskId ?? '', channelId ?? '', conversationId ?? '', {
              tool: toolCall.name,
              type: 'skill',
            });
            const toolStart = Date.now();
            const skillResult = await this.llmService.complete(
              instructions,
              args,
            );
            toolResult = skillResult.content;
            this.journal?.log('tool_call_completed', taskId ?? '', channelId ?? '', conversationId ?? '', {
              tool: toolCall.name,
              type: 'skill',
              durationMs: Date.now() - toolStart,
            });
          } else {
            toolResult = `Skill ${skillName} not found`;
          }
        } else {
          // MCP tool invocation
          this.journal?.log('tool_call_started', taskId ?? '', channelId ?? '', conversationId ?? '', {
            tool: toolCall.name,
            type: 'mcp',
          });
          const toolStart = Date.now();
          try {
            toolResult = await this.mcpManager.invokeTool(
              toolCall.name,
              toolCall.arguments,
            );
            this.journal?.log('tool_call_completed', taskId ?? '', channelId ?? '', conversationId ?? '', {
              tool: toolCall.name,
              type: 'mcp',
              durationMs: Date.now() - toolStart,
            });
          } catch (err) {
            toolResult = `Tool error: ${String(err)}`;
            log.error('Tool invocation failed', {
              tool: toolCall.name,
              error: String(err),
            });
            this.journal?.log('tool_call_completed', taskId ?? '', channelId ?? '', conversationId ?? '', {
              tool: toolCall.name,
              type: 'mcp',
              durationMs: Date.now() - toolStart,
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

      this.journal?.log('verification_result', '', channelId, conversationId, {
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
