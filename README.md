# HydraClaw

Multi-headed AI assistant platform. 15 AI providers, 18 messaging channels, 12 automation tools, built-in security scanning.

## Quick Start

```bash
pnpm install
pnpm -r build
node packages/cli/dist/index.js start
```

## Features

**AI Providers (15):** Anthropic, OpenAI, Google, Mistral, Cohere, Groq, Together, OpenRouter, DeepSeek, xAI, Perplexity, Ollama, LM Studio, vLLM

**Channels (18):** Telegram, Discord, WhatsApp, Slack, Signal, iMessage, Matrix, Email, IRC, XMPP, Reddit, Twitter, Mastodon, Bluesky, LINE, Teams, WebChat, Zalo

**Tools (12):** Shell, Filesystem, Browser, HTTP Client, Scheduler, Webhook, Database, Code Runner, Scraper, Git, Docker, Image Generation

**Security:** Prompt injection detection, tool call policy engine, vulnerability scanner, audit logging

## Configuration

Copy the example config and add your API keys:

```bash
cp config.example.yaml config.yaml
cp .env.example .env
```

Or set environment variables directly:

```bash
export ANTHROPIC_API_KEY=sk-...
export OPENAI_API_KEY=sk-...
```

## CLI Commands

```
hydraclaw start              # Start the gateway server
hydraclaw chat <message>     # One-shot message to the agent
hydraclaw config             # Show current configuration
hydraclaw status             # Show system status
hydraclaw send <message>     # Send message through a channel
hydraclaw scan               # Security vulnerability scan
hydraclaw scan --json        # Machine-readable scan output
```

## Security

Security is opt-in. Add to your `config.yaml`:

```yaml
security:
  enabled: true
  promptInjection:
    enabled: true
    action: block
  toolPolicies:
    shell:
      blockedCommands: ['rm -rf /', 'dd if=', 'mkfs']
    filesystem:
      blockedPaths: ['/etc/shadow', '/etc/passwd']
      allowedPaths: ['/tmp', './data']
    browser:
      blockedUrls: ['file://', 'chrome://']
  audit:
    enabled: true
    logFile: './data/security-audit.log'
```

Run `hydraclaw scan` to check your configuration for vulnerabilities.

## Architecture

```
packages/
  core/       # DI container, message bus, config, plugin system, types
  store/      # SQLite persistence, session store, vector store
  agent/      # Agent orchestration, conversation manager, streaming
  gateway/    # HTTP + WebSocket server
  cli/        # Commander.js CLI
  security/   # Prompt injection detection, tool policies, scanner, audit

providers/    # 15 AI provider plugins
channels/     # 18 messaging channel plugins
tools/        # 12 automation tool plugins
ui/           # Web chat UI
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
