# HydraClaw

Your own personal AI assistant. Any OS. Any Platform. The hydra way.

Multi-headed AI assistant platform with 14 AI providers, 18 messaging channels, 12 automation tools, 15 skills, 10 extensions, and a full plugin SDK.

## Quick Start

```bash
# Install globally
npm install -g hydraclaw@latest

# Run the onboarding wizard
hydraclaw onboard --install-daemon

# Or manual setup
pnpm install
pnpm build
hydraclaw start
```

## Features

### AI Providers (14)
Anthropic, OpenAI, Google, Mistral, Cohere, Groq, Together, **OpenRouter** (200+ models), DeepSeek, xAI, Perplexity, Ollama, LM Studio, vLLM

> **OpenRouter** is the recommended provider - a single API key gives you access to 200+ models from all major providers with automatic routing, cost optimization, and fallback.

### Channels (18)
Telegram, Discord, WhatsApp, Slack, Signal, iMessage, Matrix, Email, IRC, XMPP, Reddit, Twitter, Mastodon, Bluesky, LINE, Teams, WebChat, Zalo

### Tools (12)
Shell, Filesystem, Browser, HTTP Client, Scheduler, Webhook, Database, Code Runner, Scraper, Git, Docker, Image Generation

### Skills (15)
GitHub, Weather, Summarize, Coding Agent, Spotify, Notion, Slack, Discord, Healthcheck, Session Logs, Image Gen, Web Search, Calculator, Translator, Reminder

### Extensions (10)
Memory Core, Device Pair, Diagnostics, Copilot Proxy, Voice Call, Thread Ownership, Talk Voice, Phone Control, LLM Task, Nostr

### Core Systems
- **Gateway** - HTTP + WebSocket server with auth, rate limiting, broadcast, service discovery, OpenAI-compatible API
- **Agent** - Multi-provider orchestration with streaming, tool loops, provider failover
- **Memory** - Vector embeddings with hybrid search (semantic + keyword), auto-memorization
- **Routing** - Message routing engine with allowlists, command gating, custom routes
- **Hooks** - Lifecycle event hooks (before/after) for message processing, tool execution
- **Cron** - Scheduled task execution with cron expressions
- **TUI** - Interactive terminal chat interface
- **TTS/STT** - Text-to-speech and speech-to-text (OpenAI, Edge TTS)
- **Media** - Image, audio, video, document, and link understanding pipeline
- **Pairing** - Device pairing and multi-node networking with RPC
- **Daemon** - Background process management with auto-restart and health monitoring
- **Security** - Prompt injection detection, tool policies, vulnerability scanner, audit logging
- **Plugin SDK** - Builder pattern APIs for creating providers, channels, tools, and skills

## Configuration

### Option 1: Onboarding Wizard (Recommended)

```bash
hydraclaw onboard
```

The wizard walks you through setting up providers, channels, tools, and security.

### Option 2: Config File

```bash
cp config.example.yaml config.yaml
# Edit config.yaml with your API keys
```

### Option 3: Environment Variables

```bash
export OPENROUTER_API_KEY=sk-or-...
export ANTHROPIC_API_KEY=sk-ant-...
export TELEGRAM_BOT_TOKEN=...
```

## CLI Commands

```
hydraclaw onboard               # Run onboarding wizard
hydraclaw start                 # Start the gateway server
hydraclaw tui                   # Interactive terminal chat
hydraclaw chat <message>        # One-shot message to the agent
hydraclaw config                # Show current configuration
hydraclaw status                # Show system status

hydraclaw daemon start          # Start background daemon
hydraclaw daemon stop           # Stop daemon
hydraclaw daemon restart        # Restart daemon
hydraclaw daemon status         # Daemon status & uptime

hydraclaw models list           # List all available models
hydraclaw models info <model>   # Model details and pricing
hydraclaw models test <model>   # Test a model

hydraclaw channels list         # List channels with status
hydraclaw channels enable <ch>  # Enable a channel
hydraclaw channels test <ch>    # Send test message

hydraclaw skills list           # List installed skills
hydraclaw skills install <src>  # Install a skill
hydraclaw skills info <id>      # Skill details

hydraclaw nodes list            # List connected nodes
hydraclaw nodes pair <addr>     # Pair with another node

hydraclaw memory search <q>     # Search memories
hydraclaw memory stats          # Memory statistics
hydraclaw memory export <file>  # Export memories

hydraclaw send <message>        # Send through a channel
hydraclaw scan                  # Security vulnerability scan
```

## OpenRouter Integration

HydraClaw has first-class OpenRouter support. With a single OpenRouter API key, you get access to 200+ models:

```yaml
providers:
  openrouter:
    apiKey: "${OPENROUTER_API_KEY}"
    routePreference: "price"     # price, speed, or latency
    dynamicModels: true          # Auto-fetch available models
    fallbackModels:              # Fallback chain
      - "anthropic/claude-sonnet-4-5-20250929"
      - "openai/gpt-4o"
      - "google/gemini-2.0-flash"
```

Features:
- Dynamic model catalog fetched from OpenRouter API
- Route optimization (cheapest, fastest, lowest latency)
- Automatic fallback chains across providers
- Cost tracking and usage statistics
- Proper rate limit and credit exhaustion handling
- Full streaming support
- Tool/function calling support

## Architecture

```
packages/
  core/          # DI container, message bus, config, plugin system, types
  store/         # SQLite persistence, session store, vector store
  agent/         # Agent orchestration, conversation manager, streaming
  gateway/       # HTTP + WebSocket server, auth, rate limit, broadcast
  cli/           # Commander.js CLI with 20+ commands
  security/      # Prompt injection detection, tool policies, scanner, audit
  wizard/        # Onboarding wizard
  daemon/        # Background process management
  routing/       # Message routing engine
  hooks/         # Lifecycle hooks system
  memory/        # Vector embeddings, hybrid search, memory management
  media/         # Media understanding pipeline
  tui/           # Terminal user interface
  tts/           # Text-to-speech / speech-to-text
  pairing/       # Device pairing, node hosting, RPC
  cron/          # Scheduled task execution
  skills/        # Skills system framework
  extensions/    # Extensions system framework
  auto-reply/    # Auto-reply engine and polls
  plugin-sdk/    # Plugin development SDK

providers/       # 14 AI provider plugins
channels/        # 18 messaging channel plugins
tools/           # 12 automation tool plugins
skills/          # 15 built-in skills
extensions/      # 10 built-in extensions
ui/              # Web chat UI
```

## Plugin Development

Use the Plugin SDK to create custom providers, channels, tools, and skills:

```typescript
import { ToolBuilder, SkillBuilder } from '@hydraclaw/plugin-sdk';

// Create a custom tool
const myTool = new ToolBuilder()
  .withId('my-tool')
  .withName('My Custom Tool')
  .addDefinition({
    name: 'my_action',
    description: 'Does something useful',
    parameters: { type: 'object', properties: { input: { type: 'string' } } }
  })
  .onExecute(async (call) => {
    return { toolCallId: call.id, content: `Result: ${call.arguments.input}` };
  })
  .build();

// Create a custom skill
const mySkill = new SkillBuilder()
  .withId('my-skill')
  .withName('My Skill')
  .withDescription('Does cool things')
  .addTrigger({ type: 'command', pattern: '/cool' })
  .addTool({
    name: 'cool_action',
    description: 'A cool action',
    parameters: {},
    handler: async () => 'Cool result!'
  })
  .build();
```

## Docker

```bash
docker-compose up
```

## Requirements

- Node.js >= 22
- pnpm >= 10

## License

MIT
