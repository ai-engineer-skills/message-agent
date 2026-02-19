# message-agent

A multi-channel message agent host with pluggable LLM backends, MCP tool integration, skill system, message verification, and a built-in web chat UI & system dashboard.

## Features

- **Multi-channel support** — Telegram, WhatsApp, WeChat, iMessage, Web UI
- **Built-in Web UI** — chat interface and system dashboard at `http://localhost:3000`
- **One-line setup** — interactive CLI configures everything
- **Pluggable LLM backends** — Claude Code, GitHub Copilot, OpenAI-compatible APIs
- **MCP tool integration** — connect external tools via Model Context Protocol
- **Skill system** — extensible skill loader with built-in and custom skills
- **Message verification** — LLM-based and rule-based response verification
- **Conversation history** — file-based history storage with segment rotation

## Prerequisites

- Node.js >= 18

## Quick Start (Install from GitHub)

```bash
npm install -g github:ai-engineer-skills/message-agent && message-agent setup
```

This installs the package globally from GitHub, auto-builds TypeScript, and launches the interactive setup wizard. After setup, start the agent:

```bash
message-agent
```

### Alternative: local install

```bash
mkdir my-agent && cd my-agent && npm init -y && npm install github:ai-engineer-skills/message-agent && npx message-agent setup
```

Then start with `npx message-agent`.

## Local Development

```bash
git clone https://github.com/ai-engineer-skills/message-agent.git
cd message-agent
npm install
npm run setup
npm start
```

This will also install [agent-toolkit](https://github.com/ai-engineer-skills/agent-toolkit) for shared logger and LLM provider infrastructure.

## What the Setup Does

The interactive `npm run setup` command walks you through:

1. **Persona** — agent name and system prompt
2. **LLM provider** — `direct-api` (OpenAI-compatible), `copilot` (GitHub Copilot), or `claude-code`
3. **Channels** — Telegram, WhatsApp, WeChat, iMessage (y/n for each)
4. **Web UI** — built-in chat and dashboard (enabled by default on port 3000)

It generates `config.yaml` and optionally builds the project.

## Web UI

Once running, open **http://localhost:3000** for:

- **Chat** — send messages and receive streaming responses via SSE
- **Dashboard** — channel statuses, active tasks, memory/uptime, and a live activity journal feed

Configure in `config.yaml`:

```yaml
web:
  enabled: true
  port: 3000
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | Interactive configuration wizard |
| `npm start` | Start the agent |
| `npm run build` | Compile TypeScript |
| `npm run dev` | Watch mode |
| `npm run start:watchdog` | Start with watchdog supervisor |

## Configuration

Configuration is loaded from `config.yaml`. Environment variables are supported via `${VAR_NAME}` syntax:

```yaml
persona:
  name: Assistant
  systemPrompt: You are a helpful assistant.

llm:
  provider: direct-api
  apiKey: ${OPENAI_API_KEY}
  model: gpt-4o

channels:
  telegram:
    type: telegram
    enabled: true
    token: ${TELEGRAM_BOT_TOKEN}

web:
  enabled: true
  port: 3000
```

### LLM backends

| Backend | Package | Env vars |
|---|---|---|
| Claude Code | (built-in) | — |
| Direct API | `agent-toolkit` | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` |
| Copilot | `agent-toolkit` | `GITHUB_TOKEN` or `GH_TOKEN` |

### Channel setup

| Channel   | Config Key       | Requires           |
|-----------|------------------|---------------------|
| Telegram  | `telegram`       | Bot token           |
| WhatsApp  | `whatsapp`       | Session data path   |
| WeChat    | `wechat`         | Puppet provider     |
| iMessage  | `imessage`       | macOS               |
| Web UI    | `web`            | Nothing (auto)      |

## API Endpoints

### Chat API (port 3000)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | Send message `{text, conversationId?}` |
| `GET` | `/api/chat/stream?conversationId=` | SSE stream for responses |
| `GET` | `/api/history?conversationId=` | Conversation history |
| `GET` | `/api/conversations` | List conversations |

### Dashboard API (port 3000)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | System overview (channels, memory, uptime, tasks) |
| `GET` | `/api/tasks` | Active + persisted tasks |
| `GET` | `/api/journal?channelId=&conversationId=` | Journal entries |

### Health API (port 3001)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Heartbeat / health check |

## Project structure

```
src/
  index.ts                          # entry point, provider initialization
  config.ts                         # configuration loading
  setup.ts                          # interactive setup wizard
  agent/
    agent-service.ts                # core agent message handling
    verification/
      llm-verifier.ts               # LLM-based response verification
      rule-verifier.ts              # rule-based response verification
  channels/
    channel.ts                      # channel interface
    channel-manager.ts              # multi-channel orchestration
    telegram/                       # Telegram (Telegraf)
    whatsapp/                       # WhatsApp (whatsapp-web.js)
    wechat/                         # WeChat (Wechaty)
    imessage/                       # iMessage
    web/
      web-channel.ts                # Web UI channel
  web/
    web-server.ts                   # HTTP server for web UI + API
    web-html.ts                     # SPA frontend (HTML/CSS/JS)
    sse-manager.ts                  # Server-Sent Events manager
    routes/
      chat-routes.ts                # Chat API routes
      dashboard-routes.ts           # Dashboard API routes
  llm/
    llm-provider.ts                 # LLM provider interface (extends agent-toolkit)
    llm-service.ts                  # LLM service wrapper
    backends/
      claude-code.ts                # Claude Code backend
  mcp/
    mcp-client-manager.ts           # MCP client lifecycle management
  skills/
    skill-handler.ts                # skill execution
    skill-loader.ts                 # skill discovery and loading
    skill-registry.ts               # skill registration
    builtin/                        # built-in skills
  history/
    history-store.ts                # history store interface
    file-history-store.ts           # file-based history implementation
  concurrency/
    task-manager.ts                 # task lifecycle & typing indicators
  storage/
    task-persistence.ts             # task state serialization
    journal-writer.ts               # event logging
  health/                           # heartbeat, channel monitor, recovery
vendor/
  ai-engineer-skills/               # skill definitions (git submodule)
```

Shared infrastructure (logger, LLM providers, search interfaces) comes from the [agent-toolkit](https://github.com/ai-engineer-skills/agent-toolkit) package.

## Architecture

```
Browser → POST /api/chat → WebChannel → AgentService → LLM
                                                      ↓
Browser ← SSE stream ← SSEManager ← WebChannel ← Response
```

```
                    ┌─────────────────┐
                    │  agent-toolkit   │
                    │  (shared infra)  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │                             │
     ┌────────┴────────┐          ┌─────────┴────────┐
     │ research-agent   │          │  message-agent    │
     │ (MCP server)     │          │  (message host)   │
     └─────────────────┘          └──────────────────┘
```

Both `research-agent` and `message-agent` depend on `agent-toolkit` for logging, LLM provider interfaces, and LLM backends.

## License

MIT
