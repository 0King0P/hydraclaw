# HydraClaw Installation Guide

A step-by-step guide for installing, configuring, and running HydraClaw on your system.

---

## Quick Setup (Debian/Ubuntu) -- One Command

On a Debian or Ubuntu system, run the setup script from the project root. It handles **everything** -- system packages, Node.js 22, pnpm, dependencies, building, and config:

```bash
git clone https://github.com/your-org/hydraclaw.git
cd hydraclaw
chmod +x setup.sh && ./setup.sh
```

That's it. When it finishes, add an API key to `.env` and start the server:

```bash
nano .env                                      # add at least one API key
node packages/cli/dist/index.js start          # start HydraClaw
```

> **What the script does (6 steps, fully automated):**
> 1. Installs system dependencies (`curl`, `git`, `python3`, `build-essential`)
> 2. Installs Node.js 22 via NodeSource (skips if already present)
> 3. Installs pnpm via corepack (skips if already present)
> 4. Runs `pnpm install` for all workspace packages
> 5. Builds every package (`pnpm build`)
> 6. Creates `config.yaml` and `.env` from templates

If you prefer a manual installation or are on a different OS, continue reading below.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone the Repository](#2-clone-the-repository)
3. [Install Dependencies](#3-install-dependencies)
4. [Configuration](#4-configuration)
   - [Create the Config File](#41-create-the-config-file)
   - [Configure AI Providers](#42-configure-ai-providers)
   - [Configure Messaging Channels](#43-configure-messaging-channels)
   - [Configure Tools](#44-configure-tools)
   - [Configure Storage](#45-configure-storage)
   - [Configure Security](#46-configure-security)
5. [Build the Project](#5-build-the-project)
6. [Run HydraClaw](#6-run-hydraclaw)
7. [Docker Installation](#7-docker-installation)
8. [Verify the Installation](#8-verify-the-installation)
9. [Development Setup](#9-development-setup)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

Before installing HydraClaw, ensure you have the following installed on your system.

### Required

| Software | Minimum Version | How to Check |
|----------|----------------|--------------|
| **Node.js** | >= 22.0.0 | `node --version` |
| **pnpm** | >= 10 | `pnpm --version` |
| **Git** | Any recent version | `git --version` |

### Installing Node.js

Download and install Node.js 22+ from [nodejs.org](https://nodejs.org/) or use a version manager:

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22
nvm use 22

# Verify
node --version   # Should output v22.x.x or higher
```

### Installing pnpm

Once Node.js is installed, enable pnpm via corepack:

```bash
corepack enable
corepack prepare pnpm@latest --activate

# Verify
pnpm --version   # Should output 10.x.x or higher
```

Alternatively, install pnpm directly:

```bash
npm install -g pnpm
```

### Optional (for specific tools)

| Software | Required For |
|----------|-------------|
| **Python 3** | Code Runner tool |
| **Docker** | Docker tool, containerized deployment |
| **curl** | HTTP Client tool |

---

## 2. Clone the Repository

```bash
git clone https://github.com/your-org/hydraclaw.git
cd hydraclaw
```

---

## 3. Install Dependencies

HydraClaw uses a pnpm workspace monorepo. Install all dependencies from the project root:

```bash
pnpm install
```

This installs dependencies for all packages, providers, channels, and tools defined in `pnpm-workspace.yaml`:

- `packages/*` -- Core packages (core, store, agent, gateway, cli, security)
- `providers/*` -- 14 AI provider plugins
- `channels/*` -- 18 messaging channel plugins
- `tools/*` -- 12 automation tool plugins
- `ui` -- Web chat interface

---

## 4. Configuration

### 4.1 Create the Config File

Copy the example configuration file:

```bash
cp config.example.yaml config.yaml
```

The `config.yaml` file is the primary configuration source. It is read at startup and should **not** be committed to version control (it contains API keys).

### 4.2 Configure AI Providers

HydraClaw supports 14 AI providers. You need at least one configured to use the agent. Edit the `providers` section in `config.yaml`.

**Option A: Set API keys in `config.yaml` directly**

```yaml
providers:
  anthropic:
    apiKey: "sk-ant-..."

  openai:
    apiKey: "sk-..."
```

**Option B: Use environment variables**

The config file supports variable interpolation with `${VAR_NAME}` syntax. You can keep the default references and set the variables in your shell or a `.env` file:

```bash
# Create a .env file in the project root
cat > .env << 'EOF'
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
EOF
```

**Supported cloud providers and their environment variables:**

| Provider | Environment Variable | Where to Get a Key |
|----------|---------------------|-------------------|
| Anthropic | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/) |
| Google | `GOOGLE_API_KEY` | [aistudio.google.dev](https://aistudio.google.dev/) |
| Mistral | `MISTRAL_API_KEY` | [console.mistral.ai](https://console.mistral.ai/) |
| Cohere | `COHERE_API_KEY` | [dashboard.cohere.com](https://dashboard.cohere.com/) |
| Groq | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com/) |
| Together | `TOGETHER_API_KEY` | [api.together.xyz](https://api.together.xyz/) |
| OpenRouter | `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai/) |
| DeepSeek | `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com/) |
| xAI | `XAI_API_KEY` | [x.ai](https://x.ai/) |
| Perplexity | `PERPLEXITY_API_KEY` | [perplexity.ai](https://perplexity.ai/) |

**Supported local/self-hosted providers (no API key needed):**

| Provider | Config Key | Default URL |
|----------|-----------|-------------|
| Ollama | `ollama.baseUrl` | `http://localhost:11434/v1` |
| LM Studio | `lmstudio.baseUrl` | `http://localhost:1234/v1` |
| vLLM | `vllm.baseUrl` | `http://localhost:8000/v1` |

To enable a local provider, uncomment its section in `config.yaml`:

```yaml
providers:
  ollama:
    baseUrl: "http://localhost:11434/v1"
```

**Agent defaults:**

The `agent` section controls which provider and model to use by default, and configures failover:

```yaml
agent:
  defaultProvider: "anthropic"
  defaultModel: "claude-sonnet-4-5-20250929"
  maxTokens: 8192
  temperature: 0.7
  maxHistory: 100
  failoverProviders:
    - "openai"
    - "google"
    - "groq"
```

If the default provider is unavailable, HydraClaw automatically tries the failover providers in order.

### 4.3 Configure Messaging Channels

Channels are optional. Uncomment and configure only the channels you intend to use. Each channel requires its own credentials.

**Example -- enabling Telegram:**

```yaml
channels:
  telegram:
    token: "${TELEGRAM_BOT_TOKEN}"
```

Then set the environment variable:

```bash
export TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
```

**Example -- enabling Discord:**

```yaml
channels:
  discord:
    token: "${DISCORD_BOT_TOKEN}"
```

**Example -- enabling WebChat (no external credentials needed):**

```yaml
channels:
  webchat:
    enabled: true
```

See `config.example.yaml` for the full list of all 18 channel configurations and their required fields.

### 4.4 Configure Tools

All 12 tools are enabled by default. You can disable individual tools by setting `enabled: false`:

```yaml
tools:
  shell:
    enabled: true
  filesystem:
    enabled: true
  browser:
    enabled: true
  http-client:
    enabled: true
  scheduler:
    enabled: true
  webhook:
    enabled: true
    port: 9876
  database:
    enabled: true
    path: "./data/tools.db"
  code-runner:
    enabled: true
  scraper:
    enabled: true
  git:
    enabled: true
  docker:
    enabled: true
  image-gen:
    enabled: true
    apiKey: "${OPENAI_API_KEY}"   # Uses DALL-E via OpenAI
```

The `image-gen` tool requires an OpenAI API key for DALL-E image generation.

### 4.5 Configure Storage

HydraClaw uses SQLite for persistence. The database is created automatically on first run:

```yaml
store:
  path: "./data/hydraclaw.db"
  vectorStore: false
```

- `path` -- Location of the SQLite database file. The `data/` directory will be created if it doesn't exist.
- `vectorStore` -- Optional vector storage support (disabled by default).

### 4.6 Configure Security

Security features are opt-in. To enable them, add a `security` section to your `config.yaml`:

```yaml
security:
  enabled: true
  promptInjection:
    enabled: true
    action: block           # "block" or "warn"
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

You can run a security scan at any time after installation to check for configuration vulnerabilities:

```bash
node packages/cli/dist/index.js scan
```

---

## 5. Build the Project

Build all packages from the project root:

```bash
pnpm build
```

This runs `tsc` (TypeScript compilation) across every package in the monorepo. The compiled output is placed in `dist/` directories within each package.

To verify the build succeeded, check that the CLI entry point exists:

```bash
ls packages/cli/dist/index.js
```

---

## 6. Run HydraClaw

### Start the Gateway Server

The gateway server exposes the HTTP API and WebSocket endpoints:

```bash
node packages/cli/dist/index.js start
```

By default, this starts:

| Service | Port | Description |
|---------|------|-------------|
| HTTP API | 3000 | REST API for agent interaction |
| WebSocket | 3001 | Real-time streaming connections |
| Webhooks | 9876 | Incoming webhook receiver (if enabled) |

### Send a One-Shot Message

Test the agent without starting the server:

```bash
node packages/cli/dist/index.js chat "Hello, HydraClaw"
```

### Other CLI Commands

```bash
node packages/cli/dist/index.js config    # Display current configuration
node packages/cli/dist/index.js status    # Show system status
node packages/cli/dist/index.js send <message>   # Send via a configured channel
node packages/cli/dist/index.js scan      # Run security vulnerability scan
node packages/cli/dist/index.js scan --json   # Machine-readable scan output
```

---

## 7. Docker Installation

Docker provides the simplest way to run HydraClaw without managing Node.js or pnpm locally.

### Step 1: Prepare Configuration Files

Ensure you have the following files in the project root:

```bash
cp config.example.yaml config.yaml    # Edit with your settings
touch .env                            # Add your API keys here
```

### Step 2: Build and Start with Docker Compose

```bash
docker-compose up -d
```

This builds the Docker image and starts the container with:

- Ports `3000`, `3001`, and `9876` exposed
- `./data` mounted for persistent database storage
- `config.yaml` and `.env` mounted read-only into the container
- Automatic restart on failure (`unless-stopped`)

### Step 3: View Logs

```bash
docker-compose logs -f hydraclaw
```

### Step 4: Stop the Container

```bash
docker-compose down
```

### Rebuilding After Changes

If you modify the source code, rebuild the Docker image:

```bash
docker-compose up -d --build
```

---

## 8. Verify the Installation

After starting HydraClaw (either natively or via Docker), verify that everything is running correctly.

### Check the HTTP API

```bash
curl http://localhost:3000
```

You should receive a response from the gateway server.

### Check WebSocket Connectivity

Open the web UI (if WebChat channel is enabled) by navigating to `http://localhost:3000` in your browser.

### Test the Agent

Send a test message via the CLI:

```bash
node packages/cli/dist/index.js chat "What providers are available?"
```

### Run the Security Scanner

```bash
node packages/cli/dist/index.js scan
```

This checks your `config.yaml` for common misconfigurations and vulnerabilities.

### Run the Test Suite

```bash
pnpm test
```

---

## 9. Development Setup

For active development, use watch mode which automatically recompiles on file changes:

```bash
pnpm dev
```

This runs `tsc --watch` in parallel across all packages.

### Linting

```bash
pnpm lint
```

### Clean Build Artifacts

To remove all `dist/` directories and start fresh:

```bash
pnpm clean
pnpm build
```

### Project Structure

```
hydraclaw/
├── packages/
│   ├── core/        # DI container, message bus, config, plugin system, types
│   ├── store/       # SQLite persistence, session store, vector store
│   ├── agent/       # Agent orchestration, conversation manager, streaming
│   ├── gateway/     # HTTP + WebSocket server
│   ├── cli/         # Commander.js CLI entry point
│   └── security/    # Prompt injection detection, tool policies, scanner, audit
├── providers/       # 14 AI provider plugins
├── channels/        # 18 messaging channel plugins
├── tools/           # 12 automation tool plugins
├── ui/              # Web chat UI (static HTML/CSS/JS)
├── config.example.yaml
├── config.yaml      # Your local config (not committed)
├── docker-compose.yml
├── Dockerfile
├── pnpm-workspace.yaml
├── tsconfig.json
└── package.json
```

---

## 10. Troubleshooting

### `node: command not found`

Node.js is not installed or not in your PATH. Install Node.js 22+ following the instructions in [Prerequisites](#1-prerequisites).

### `pnpm: command not found`

Enable corepack and activate pnpm:

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

### Build fails with TypeScript errors

Ensure you are using Node.js 22+. Older versions may not support the ES2023 target. Clean and rebuild:

```bash
pnpm clean
pnpm install
pnpm build
```

### `ERR_MODULE_NOT_FOUND` at runtime

The project has not been built. Run `pnpm build` before starting.

### Port already in use

Another process is using port 3000, 3001, or 9876. Either stop the conflicting process or change the ports in `config.yaml`:

```yaml
gateway:
  port: 3100       # Change HTTP port
  wsPort: 3101     # Change WebSocket port

tools:
  webhook:
    port: 9877     # Change webhook port
```

### SQLite build errors during `pnpm install`

The `better-sqlite3` package requires native compilation. Ensure you have build tools installed:

```bash
# Debian/Ubuntu
sudo apt-get install build-essential python3

# macOS
xcode-select --install

# Fedora/RHEL
sudo dnf groupinstall "Development Tools"
```

### Docker: `config.yaml` not found

Ensure `config.yaml` exists in the project root before running `docker-compose up`. The file is mounted into the container as a read-only volume.

### Provider returns authentication errors

Double-check that your API key is correct and active. Test it directly:

```bash
# Example: test Anthropic key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-5-20250929","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
```

### Environment variables not loading

If you are using a `.env` file, ensure it is in the project root directory. For Docker, verify it is listed in `docker-compose.yml` under `env_file`.
