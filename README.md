# message-agent

A multi-channel message agent host with pluggable LLM backends, MCP tool integration, skill system, and message verification. Connects to Telegram, WhatsApp, WeChat, and iMessage, routing incoming messages through an AI agent pipeline.

## Features

- **Multi-channel support** — Telegram, WhatsApp, WeChat, iMessage
- **Pluggable LLM backends** — Claude Code, GitHub Copilot, OpenAI-compatible APIs
- **MCP tool integration** — connect external tools via Model Context Protocol
- **Skill system** — extensible skill loader with built-in and custom skills
- **Message verification** — LLM-based and rule-based response verification
- **Conversation history** — file-based history storage

## Prerequisites

- Node.js >= 18

## Installation

```bash
git clone https://github.com/ai-engineer-skills/message-agent.git
cd message-agent
npm install
```

This will also install [agent-toolkit](https://github.com/ai-engineer-skills/agent-toolkit) for shared logger and LLM provider infrastructure.

## Usage

```bash
npm start
```

## Project structure

```
src/
  index.ts                          # entry point, provider initialization
  config.ts                         # configuration loading
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
vendor/
  ai-engineer-skills/               # skill definitions (git submodule)
```

Shared infrastructure (logger, LLM providers, search interfaces) comes from the [agent-toolkit](https://github.com/ai-engineer-skills/agent-toolkit) package.

## Configuration

Configuration is loaded from a YAML file. See `config.ts` for the schema.

### LLM backends

| Backend | Package | Env vars |
|---|---|---|
| Claude Code | (built-in) | — |
| Direct API | `agent-toolkit` | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` |
| Copilot | `agent-toolkit` | `GITHUB_TOKEN` or `GH_TOKEN` |

### Channel setup

Each channel requires its own credentials. See the respective channel implementation files under `src/channels/` for details.

## Development

```bash
npm run build    # compile TypeScript
npm run dev      # watch mode
```

## Architecture

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
