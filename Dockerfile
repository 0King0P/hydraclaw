FROM node:22-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/
COPY packages/store/package.json packages/store/
COPY packages/agent/package.json packages/agent/
COPY packages/gateway/package.json packages/gateway/
COPY packages/cli/package.json packages/cli/
COPY packages/security/package.json packages/security/

# Copy provider package.json files
COPY providers/anthropic/package.json providers/anthropic/
COPY providers/openai/package.json providers/openai/
COPY providers/google/package.json providers/google/
COPY providers/mistral/package.json providers/mistral/
COPY providers/groq/package.json providers/groq/
COPY providers/ollama/package.json providers/ollama/
COPY providers/together/package.json providers/together/
COPY providers/openrouter/package.json providers/openrouter/
COPY providers/deepseek/package.json providers/deepseek/
COPY providers/xai/package.json providers/xai/
COPY providers/perplexity/package.json providers/perplexity/
COPY providers/cohere/package.json providers/cohere/
COPY providers/lmstudio/package.json providers/lmstudio/
COPY providers/vllm/package.json providers/vllm/
COPY providers/_shared/package.json providers/_shared/

# Copy channel package.json files
COPY channels/telegram/package.json channels/telegram/
COPY channels/discord/package.json channels/discord/
COPY channels/whatsapp/package.json channels/whatsapp/
COPY channels/slack/package.json channels/slack/
COPY channels/signal/package.json channels/signal/
COPY channels/matrix/package.json channels/matrix/
COPY channels/email/package.json channels/email/
COPY channels/irc/package.json channels/irc/
COPY channels/webchat/package.json channels/webchat/
COPY channels/imessage/package.json channels/imessage/
COPY channels/reddit/package.json channels/reddit/
COPY channels/twitter/package.json channels/twitter/
COPY channels/mastodon/package.json channels/mastodon/
COPY channels/bluesky/package.json channels/bluesky/
COPY channels/xmpp/package.json channels/xmpp/
COPY channels/line/package.json channels/line/
COPY channels/teams/package.json channels/teams/
COPY channels/zalo/package.json channels/zalo/

# Copy tool package.json files
COPY tools/shell/package.json tools/shell/
COPY tools/filesystem/package.json tools/filesystem/
COPY tools/browser/package.json tools/browser/
COPY tools/http-client/package.json tools/http-client/
COPY tools/scheduler/package.json tools/scheduler/
COPY tools/webhook/package.json tools/webhook/
COPY tools/database/package.json tools/database/
COPY tools/code-runner/package.json tools/code-runner/
COPY tools/scraper/package.json tools/scraper/
COPY tools/git/package.json tools/git/
COPY tools/docker/package.json tools/docker/
COPY tools/image-gen/package.json tools/image-gen/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY . .

# Build all packages
RUN pnpm build

# Create data directory
RUN mkdir -p /app/data

# Expose ports
EXPOSE 3000 3001 9876

# Run the gateway
CMD ["node", "packages/cli/dist/index.js", "start"]
