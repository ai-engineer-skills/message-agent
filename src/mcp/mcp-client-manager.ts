import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createLogger } from 'agent-toolkit/logger';
import { McpServerConfig } from '../types/config.js';
import { ToolDefinition } from '../llm/llm-provider.js';

const log = createLogger('mcp');

interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  tools: ToolDefinition[];
}

export class McpClientManager {
  private connections = new Map<string, McpConnection>();

  async connectAll(
    servers: Record<string, McpServerConfig>,
  ): Promise<void> {
    for (const [name, config] of Object.entries(servers)) {
      try {
        await this.connectServer(name, config);
      } catch (err) {
        log.error('Failed to connect MCP server', {
          server: name,
          error: String(err),
        });
      }
    }
  }

  private async connectServer(
    name: string,
    config: McpServerConfig,
  ): Promise<void> {
    log.info('Connecting MCP server', { server: name, command: config.command });

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env
        ? { ...process.env as Record<string, string>, ...config.env }
        : undefined,
    });

    const client = new Client(
      { name: 'message-agent-host', version: '1.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);

    const toolsResult = await client.listTools();
    const tools: ToolDefinition[] = toolsResult.tools.map((t) => ({
      name: `${name}__${t.name}`,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    this.connections.set(name, { client, transport, tools });
    log.info('MCP server connected', {
      server: name,
      toolCount: tools.length,
    });
  }

  getAllTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const conn of this.connections.values()) {
      tools.push(...conn.tools);
    }
    return tools;
  }

  async invokeTool(
    namespacedName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const sepIdx = namespacedName.indexOf('__');
    if (sepIdx === -1) {
      throw new Error(`Invalid namespaced tool name: ${namespacedName}`);
    }
    const serverName = namespacedName.slice(0, sepIdx);
    const toolName = namespacedName.slice(sepIdx + 2);

    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    log.debug('Invoking MCP tool', { server: serverName, tool: toolName });
    const result = await conn.client.callTool({ name: toolName, arguments: args });

    if ('content' in result && Array.isArray(result.content)) {
      return result.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
    }

    return JSON.stringify(result);
  }

  async disconnectAll(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.transport.close();
        log.info('MCP server disconnected', { server: name });
      } catch (err) {
        log.error('Error disconnecting MCP server', {
          server: name,
          error: String(err),
        });
      }
    }
    this.connections.clear();
  }
}
