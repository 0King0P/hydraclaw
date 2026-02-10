# HydraClaw

Multi-headed AI assistant platform. 14 AI providers, 18 messaging channels, 12 automation tools, built-in security scanning.

## Quick Start

The fastest way to get running:

```bash
# Install dependencies & build
pnpm install
pnpm build

# Interactive guided setup (creates config.yaml for you)
node packages/cli/dist/index.js init

# Start
node packages/cli/dist/index.js start
```

## Setup with Local Ollama (Recommended for Getting Started)

No API keys needed. Run AI models entirely on your machine:

```bash
# 1. Install Ollama (if not already installed)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Start Ollama and pull a model
ollama serve &
ollama pull llama3.2

# 3. Install and build HydraClaw
git clone <repo-url> && cd hydraclaw
pnpm install
pnpm build

# 4. Auto-configure for Ollama (detects models, writes config.yaml)
node packages/cli/dist/index.js setup ollama

# 5. Start
node packages/cli/dist/index.js start
```

The `setup ollama` command will:
- Check if Ollama is running
- Discover all your installed models
- Ask which model to use as default
- Generate or update `config.yaml` automatically

## Install on Debian / Ubuntu

```bash
# Install Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs

# Install pnpm
corepack enable
corepack prepare pnpm@latest --activate

# Clone and build
git clone <repo-url> && cd hydraclaw
pnpm install
pnpm build

# Run guided setup
node packages/cli/dist/index.js init

# Or set up Ollama directly
node packages/cli/dist/index.js setup ollama
```

## Install on Other Linux Distros

```bash
# Arch / Manjaro
sudo pacman -S nodejs-lts-jod pnpm

# Fedora / RHEL
sudo dnf install nodejs
corepack enable && corepack prepare pnpm@latest --activate

# Then clone, install, build, and run setup as above
```

## Docker

### With Ollama on the Host

If Ollama is already running on your machine:

```bash
# 1. Copy config and env files
cp config.example.yaml config.yaml
cp .env.example .env

# 2. Edit config.yaml - set Ollama URL to reach the host:
#    providers:
#      ollama:
#        baseUrl: "http://host.docker.internal:11434/v1"

# 3. Run
docker compose up -d
```

The `docker-compose.yml` includes `extra_hosts: host.docker.internal:host-gateway` so the container can reach Ollama on your host machine.

### With Containerized Ollama

Uncomment the `ollama` service in `docker-compose.yml`, then:

```bash
docker compose up -d

# Pull a model into the containerized Ollama
docker exec hydraclaw-ollama ollama pull llama3.2

# Update config.yaml to point to the Ollama container:
#   providers:
#     ollama:
#       baseUrl: "http://ollama:11434/v1"
```

### Docker Build Only

```bash
docker build -t hydraclaw .
docker run -p 3000:3000 -p 3001:3001 -v ./config.yaml:/app/config.yaml:ro hydraclaw
```

## Configuration

### Guided Setup (Recommended)

```bash
node packages/cli/dist/index.js init        # Full interactive setup
node packages/cli/dist/index.js setup ollama # Ollama-specific setup
```

### Manual Setup

```bash
cp config.example.yaml config.yaml
cp .env.example .env
# Edit both files with your settings
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your API keys. For local providers (Ollama, LM Studio, vLLM), no keys are needed.

## CLI Commands

```
hydraclaw start              # Start the gateway server
hydraclaw chat <message>     # One-shot message (use -p/-m to pick provider/model)
hydraclaw init               # Interactive guided setup
hydraclaw setup ollama       # Auto-detect and configure local Ollama
hydraclaw doctor             # Check system health and diagnose issues
hydraclaw config             # Show current configuration
hydraclaw status             # Show system status with live connectivity checks
hydraclaw send <message>     # Send message through a channel
hydraclaw scan               # Security vulnerability scan
```

### Chat Examples

```bash
# Use default provider
hydraclaw chat "Hello, how are you?"

# Use a specific Ollama model
hydraclaw chat -p ollama -m mistral "Explain quantum computing"

# Use a specific cloud provider
hydraclaw chat -p anthropic -m claude-sonnet-4-5-20250929 "Write a haiku"
```

## Features

**AI Providers (14):** Anthropic, OpenAI, Google, Mistral, Cohere, Groq, Together, OpenRouter, DeepSeek, xAI, Perplexity, Ollama, LM Studio, vLLM

**Channels (18):** Telegram, Discord, WhatsApp, Slack, Signal, iMessage, Matrix, Email, IRC, XMPP, Reddit, Twitter, Mastodon, Bluesky, LINE, Teams, WebChat, Zalo

**Tools (12):** Shell, Filesystem, Browser, HTTP Client, Scheduler, Webhook, Database, Code Runner, Scraper, Git, Docker, Image Generation

**Security:** Prompt injection detection, tool call policy engine, vulnerability scanner, audit logging

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

providers/    # 14 AI provider plugins
channels/     # 18 messaging channel plugins
tools/        # 12 automation tool plugins
ui/           # Web chat UI
```

## Requirements

- Node.js >= 22
- pnpm >= 10

## License

MIT
