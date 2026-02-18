import { createLogger, setLogLevel } from 'agent-toolkit/logger';
import { CopilotLLMProvider } from 'agent-toolkit/services/llm-backends/copilot';
import { DirectAPILLMProvider } from 'agent-toolkit/services/llm-backends/direct-api';
import { loadConfig } from './config.js';
import { ExtendedLLMService } from './llm/llm-service.js';
import { ExtendedLLMProvider, ChatMessage, ChatCompletionResult, ToolDefinition } from './llm/llm-provider.js';
import { ClaudeCodeLLMProvider } from './llm/backends/claude-code.js';
import { McpClientManager } from './mcp/mcp-client-manager.js';
import { SkillRegistry } from './skills/skill-registry.js';
import { loadAllSkills } from './skills/skill-loader.js';
import { registerBuiltinSkills } from './skills/builtin/index.js';
import { FileHistoryStore } from './history/file-history-store.js';
import { ChannelManager } from './channels/channel-manager.js';
import { TelegramChannel } from './channels/telegram/telegram-channel.js';
import { WhatsAppChannel } from './channels/whatsapp/whatsapp-channel.js';
import { WeChatChannel } from './channels/wechat/wechat-channel.js';
import { IMessageChannel } from './channels/imessage/imessage-channel.js';
import { AgentService } from './agent/agent-service.js';
import { LLMCompletionResult } from 'agent-toolkit/services/llm-provider';

const log = createLogger('main');

/**
 * Wraps a base LLMProvider (from submodule, which only has complete())
 * to satisfy ExtendedLLMProvider (which also requires chat()).
 */
function wrapBaseProvider(
  base: { name: string; initialize(): Promise<void>; dispose(): Promise<void>; complete(s: string, u: string): Promise<LLMCompletionResult> },
): ExtendedLLMProvider {
  return {
    name: base.name,
    initialize: () => base.initialize(),
    dispose: () => base.dispose(),
    complete: (s: string, u: string) => base.complete(s, u),
    async chat(
      messages: ChatMessage[],
      options?: { tools?: ToolDefinition[]; maxTokens?: number },
    ): Promise<ChatCompletionResult> {
      // Flatten messages into a single complete() call
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      const userParts = messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          if (m.role === 'tool') return `[Tool Result]\n${m.content}`;
          return `[${m.role}]\n${m.content}`;
        })
        .join('\n\n');

      // Append tool definitions if available
      let systemWithTools = system;
      if (options?.tools && options.tools.length > 0) {
        const toolDescs = options.tools
          .map((t) => `- ${t.name}: ${t.description}`)
          .join('\n');
        systemWithTools += `\n\nAvailable tools (call by responding with JSON {"tool_call": {"name": "...", "arguments": {...}}}):\n${toolDescs}`;
      }

      const result = await base.complete(systemWithTools, userParts);

      // Try to parse tool calls from response
      const toolCalls = parseToolCalls(result.content);
      if (toolCalls.length > 0) {
        return {
          content: result.content,
          model: result.model,
          usage: result.usage,
          toolCalls,
        };
      }

      return { content: result.content, model: result.model, usage: result.usage };
    },
  };
}

function parseToolCalls(content: string): { id: string; name: string; arguments: Record<string, unknown> }[] {
  try {
    const match = content.match(/\{"tool_call"\s*:\s*\{[\s\S]*?\}\s*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as { tool_call: { name: string; arguments: Record<string, unknown> } };
    return [{
      id: `call_${Date.now()}`,
      name: parsed.tool_call.name,
      arguments: parsed.tool_call.arguments ?? {},
    }];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const logLevel = (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error';
  setLogLevel(logLevel);

  const configPath = process.env.CONFIG_PATH ?? 'config.yaml';
  log.info('Loading config', { path: configPath });

  const config = loadConfig(configPath);
  log.info('Config loaded', { persona: config.persona.name });

  // Initialize LLM provider
  let provider: ExtendedLLMProvider;
  switch (config.llm.provider) {
    case 'claude-code':
      provider = new ClaudeCodeLLMProvider({ model: config.llm.model });
      break;
    case 'copilot':
      provider = wrapBaseProvider(
        new CopilotLLMProvider({
          githubToken: config.llm.githubToken,
          model: config.llm.model,
        }),
      );
      break;
    case 'direct-api':
    default:
      provider = wrapBaseProvider(
        new DirectAPILLMProvider({
          apiKey: config.llm.apiKey,
          baseUrl: config.llm.baseUrl,
          model: config.llm.model,
          maxTokens: config.llm.maxTokens,
        }),
      );
      break;
  }

  const llmService = new ExtendedLLMService(provider);
  await llmService.initialize();

  // Optional review LLM (for verification with different provider)
  let reviewLlmService: ExtendedLLMService | undefined;
  if (
    config.verification.llmReview.enabled &&
    config.verification.llmReview.provider
  ) {
    let reviewProvider: ExtendedLLMProvider;
    switch (config.verification.llmReview.provider) {
      case 'claude-code':
        reviewProvider = new ClaudeCodeLLMProvider({
          model: config.verification.llmReview.model,
        });
        break;
      case 'copilot':
        reviewProvider = wrapBaseProvider(new CopilotLLMProvider({
          model: config.verification.llmReview.model,
        }));
        break;
      default:
        reviewProvider = wrapBaseProvider(new DirectAPILLMProvider({
          model: config.verification.llmReview.model,
        }));
        break;
    }
    reviewLlmService = new ExtendedLLMService(reviewProvider);
    await reviewLlmService.initialize();
  }

  // MCP client
  const mcpManager = new McpClientManager();
  if (config.mcp?.servers) {
    await mcpManager.connectAll(config.mcp.servers);
  }

  // Skills
  const skillRegistry = new SkillRegistry();
  registerBuiltinSkills(skillRegistry);
  loadAllSkills(skillRegistry, config.skills?.directories);
  log.info('Skills loaded', { count: skillRegistry.getAll().length });

  // History
  const historyStore = new FileHistoryStore(
    config.history?.dataDir,
    config.history?.maxMessages,
  );

  // Channels
  const channelManager = new ChannelManager();
  for (const [id, channelConfig] of Object.entries(config.channels)) {
    if (!channelConfig.enabled) continue;

    switch (channelConfig.type) {
      case 'telegram':
        if (!channelConfig.token) {
          log.error('Telegram channel requires token', { id });
          continue;
        }
        channelManager.register(new TelegramChannel(id, channelConfig.token));
        break;
      case 'whatsapp':
        channelManager.register(
          new WhatsAppChannel(id, channelConfig.sessionDataPath),
        );
        break;
      case 'wechat':
        channelManager.register(
          new WeChatChannel(id, channelConfig.puppetProvider),
        );
        break;
      case 'imessage':
        channelManager.register(new IMessageChannel(id));
        break;
      default:
        log.warn('Unknown channel type', { id, type: channelConfig.type });
    }
  }

  // Agent
  const agentService = new AgentService(
    config,
    llmService,
    mcpManager,
    skillRegistry,
    historyStore,
    channelManager,
    reviewLlmService,
  );

  // Wire message handler and connect channels
  channelManager.setHandler((msg) => agentService.handleMessage(msg));
  await channelManager.connectAll();

  log.info('Message Agent Host started', { persona: config.persona.name });

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    await channelManager.disconnectAll();
    await mcpManager.disconnectAll();
    await llmService.dispose();
    if (reviewLlmService) await reviewLlmService.dispose();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('Fatal error', { error: String(err) });
  process.exit(1);
});
