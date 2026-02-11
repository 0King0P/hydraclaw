#!/usr/bin/env bash
#
# HydraClaw Setup
#
# Usage:
#   chmod +x setup.sh && ./setup.sh          # install + interactive config wizard
#   ./setup.sh --config                       # re-run config wizard only
#   ./setup.sh --ollama                       # non-interactive Ollama setup
#
# Tested on: Debian 11/12, Ubuntu 22.04/24.04

set -euo pipefail

# ── Parse flags ───────────────────────────────────────────────────────
MODE="full"
for arg in "$@"; do
    case "$arg" in
        --config)  MODE="config-only" ;;
        --ollama)  MODE="ollama-auto" ;;
        --help|-h)
            echo "Usage: ./setup.sh [options]"
            echo ""
            echo "Options:"
            echo "  (no flags)   Full install + interactive configuration wizard"
            echo "  --config     Re-run configuration wizard only (skip install)"
            echo "  --ollama     Non-interactive setup with Ollama (no API key needed)"
            echo "  --help       Show this help"
            exit 0
            ;;
    esac
done

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }
step()    { echo -e "\n${BOLD}==> $*${NC}"; }

# ── Helpers ───────────────────────────────────────────────────────────

# Set or update a variable in .env
set_env_var() {
    local key="$1" value="$2"
    if [ -f .env ]; then
        if grep -q "^${key}=" .env 2>/dev/null; then
            sed -i "s|^${key}=.*|${key}=${value}|" .env
        elif grep -q "^# *${key}=" .env 2>/dev/null; then
            sed -i "s|^# *${key}=.*|${key}=${value}|" .env
        else
            echo "${key}=${value}" >> .env
        fi
    else
        echo "${key}=${value}" >> .env
    fi
}

# Ensure .env has a base template
ensure_env_template() {
    if [ ! -f .env ]; then
        cat > .env << 'ENVEOF'
# HydraClaw Environment Variables
# Managed by setup wizard. Re-run: ./setup.sh --config

ENVEOF
    fi
}

# Generate config.yaml using Python3 for safe YAML manipulation
generate_config() {
    local provider="$1" model="$2" channels="$3" disabled_tools="$4"

    python3 << PYEOF
import re

def uncomment_block(lines, key):
    result = []
    in_block = False
    for line in lines:
        stripped = line.rstrip('\\n')
        if re.match(rf'^  # {re.escape(key)}:', stripped):
            in_block = True
        elif in_block:
            if stripped == '' or (not stripped.startswith('  #') and stripped.strip()):
                in_block = False
        if in_block:
            line = re.sub(r'^  # ', '  ', line)
        result.append(line)
    return result

with open('config.example.yaml') as f:
    lines = f.readlines()

provider = "${provider}"
model = "${model}"
channels = [c for c in "${channels}".split(',') if c]
disabled = [t for t in "${disabled_tools}".split(',') if t]

# Set provider and model
if provider:
    lines = [l.replace('defaultProvider: "anthropic"', f'defaultProvider: "{provider}"') for l in lines]
if model:
    lines = [l.replace('defaultModel: "claude-sonnet-4-5-20250929"', f'defaultModel: "{model}"') for l in lines]

# If using Ollama, clear failover providers (they won't have keys)
if provider == 'ollama':
    new_lines = []
    skip_failover = False
    for line in lines:
        if 'failoverProviders:' in line:
            new_lines.append('  failoverProviders: []\\n')
            skip_failover = True
            continue
        if skip_failover:
            if line.strip().startswith('- '):
                continue
            skip_failover = False
        new_lines.append(line)
    lines = new_lines

# Uncomment selected provider
if provider:
    lines = uncomment_block(lines, provider)

# Uncomment selected channels
for ch in channels:
    lines = uncomment_block(lines, ch)

# Disable selected tools
if disabled:
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        result.append(line)
        for tool in disabled:
            if line.strip() == f'{tool}:':
                if i + 1 < len(lines) and 'enabled: true' in lines[i + 1]:
                    i += 1
                    result.append(lines[i].replace('enabled: true', 'enabled: false'))
                break
        i += 1
    lines = result

with open('config.yaml', 'w') as f:
    f.writelines(lines)
PYEOF
}

# Install Ollama and pull a model
install_ollama() {
    local model="${1:-qwen2.5:3b}"

    if command -v ollama &>/dev/null; then
        success "Ollama already installed"
    else
        info "Installing Ollama..."
        curl -fsSL https://ollama.com/install.sh | sh
        success "Ollama installed"
    fi

    if ! curl -sf http://localhost:11434/api/tags &>/dev/null; then
        info "Starting Ollama server..."
        ollama serve &>/dev/null &
        sleep 3
    fi
    success "Ollama server running"

    if ollama list 2>/dev/null | grep -q "$model"; then
        success "Model $model already downloaded"
    else
        info "Pulling model $model (this may take a minute)..."
        ollama pull "$model"
        success "Model $model ready"
    fi
}

# ── Project root ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ===========================================================================
# INSTALL STEPS (skipped with --config)
# ===========================================================================
if [ "$MODE" != "config-only" ]; then

    step "Checking system"

    if [ "$(id -u)" -eq 0 ]; then
        warn "Running as root. Prefer running as a normal user with sudo access."
    fi

    if [ -f /etc/os-release ]; then
        . /etc/os-release
        case "$ID" in
            debian|ubuntu|linuxmint|pop|elementary|zorin|kali|raspbian)
                info "Detected $PRETTY_NAME" ;;
            *)
                warn "This script is built for Debian/Ubuntu. Detected: $PRETTY_NAME"
                warn "Proceeding anyway -- some package commands may need adjustment." ;;
        esac
    else
        warn "Could not detect OS. Proceeding assuming Debian/Ubuntu."
    fi

    info "Project directory: $SCRIPT_DIR"

    # ── Step 1: System dependencies ───────────────────────────────────
    step "Step 1/5 - Installing system dependencies"

    PACKAGES=(curl git python3 build-essential ca-certificates gnupg)
    MISSING=()
    for pkg in "${PACKAGES[@]}"; do
        if ! dpkg -s "$pkg" &>/dev/null; then
            MISSING+=("$pkg")
        fi
    done

    if [ ${#MISSING[@]} -gt 0 ]; then
        info "Installing: ${MISSING[*]}"
        sudo apt-get update -qq
        sudo apt-get install -y -qq "${MISSING[@]}"
        success "System dependencies installed"
    else
        success "System dependencies already installed"
    fi

    # ── Step 2: Node.js 22 ────────────────────────────────────────────
    step "Step 2/5 - Setting up Node.js 22"

    NEED_NODE=false
    if command -v node &>/dev/null; then
        NODE_MAJOR="$(node --version | sed 's/v\([0-9]*\).*/\1/')"
        if [ "$NODE_MAJOR" -ge 22 ]; then
            success "Node.js $(node --version) already installed"
        else
            warn "Node.js $(node --version) found but v22+ is required"
            NEED_NODE=true
        fi
    else
        NEED_NODE=true
    fi

    if [ "$NEED_NODE" = true ]; then
        info "Installing Node.js 22 via NodeSource..."
        sudo mkdir -p /etc/apt/keyrings
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
            | sudo gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
        echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
            | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
        sudo apt-get update -qq
        sudo apt-get install -y -qq nodejs
        success "Node.js $(node --version) installed"
    fi

    # ── Step 3: pnpm ──────────────────────────────────────────────────
    step "Step 3/5 - Setting up pnpm"

    if command -v pnpm &>/dev/null; then
        success "pnpm $(pnpm --version) already installed"
    else
        info "Enabling corepack and activating pnpm..."
        sudo corepack enable || corepack enable
        corepack prepare pnpm@latest --activate 2>/dev/null || true
        if ! command -v pnpm &>/dev/null; then
            info "Corepack failed, installing pnpm via npm..."
            sudo npm install -g pnpm
        fi
        success "pnpm $(pnpm --version) installed"
    fi

    # ── Step 4: Project dependencies ──────────────────────────────────
    step "Step 4/5 - Installing project dependencies"

    info "Running pnpm install (this may take a minute)..."
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install

    if [ ! -d node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3/prebuilds ] && \
       [ ! -d node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3/build ]; then
        info "Rebuilding native modules (better-sqlite3, ssh2)..."
        pnpm install --force 2>/dev/null || true
    fi
    success "Dependencies installed"

    # ── Step 5: Build ─────────────────────────────────────────────────
    step "Step 5/5 - Building HydraClaw"

    info "Cleaning stale build artifacts..."
    pnpm clean 2>/dev/null || true
    # Remove stale tsbuildinfo files that may reference paths from another machine
    find . -name 'tsconfig.tsbuildinfo' -not -path '*/node_modules/*' -delete 2>/dev/null || true

    info "Compiling TypeScript across all packages..."
    pnpm build
    success "Build complete"

    if [ ! -f packages/cli/dist/index.js ]; then
        fail "Build verification failed: packages/cli/dist/index.js not found"
    fi

fi  # end install steps

# Quick sanity check for --config mode
if [ "$MODE" = "config-only" ] && [ ! -f packages/cli/dist/index.js ]; then
    fail "HydraClaw is not built yet. Run ./setup.sh first (without --config)."
fi

mkdir -p data

# ===========================================================================
# NON-INTERACTIVE OLLAMA MODE (--ollama)
# ===========================================================================
if [ "$MODE" = "ollama-auto" ]; then
    step "Auto-configuring Ollama"
    install_ollama "qwen2.5:3b"
    ensure_env_template
    generate_config "ollama" "qwen2.5:3b" "" ""
    success "config.yaml configured for Ollama"

    echo ""
    echo -e "${GREEN}${BOLD}============================================${NC}"
    echo -e "${GREEN}${BOLD}  HydraClaw is ready!${NC}"
    echo -e "${GREEN}${BOLD}============================================${NC}"
    echo ""
    echo -e "  ${BOLD}Quick test:${NC}  ${CYAN}node packages/cli/dist/index.js chat \"Hello\"${NC}"
    echo -e "  ${BOLD}Start:${NC}       ${CYAN}node packages/cli/dist/index.js start${NC}"
    echo -e "  ${BOLD}Re-config:${NC}   ${CYAN}./setup.sh --config${NC}"
    echo ""
    exit 0
fi

# ===========================================================================
# INTERACTIVE CONFIGURATION WIZARD
# ===========================================================================
echo ""
echo -e "${BOLD}${CYAN}========================================${NC}"
echo -e "${BOLD}${CYAN}   HydraClaw Configuration Wizard${NC}"
echo -e "${BOLD}${CYAN}========================================${NC}"
echo ""
echo -e "  ${DIM}Walk through each section to set up HydraClaw.${NC}"
echo -e "  ${DIM}Press Enter to skip any section.${NC}"
echo -e "  ${DIM}Re-run anytime:${NC} ${CYAN}./setup.sh --config${NC}"

# ── Wizard state ──────────────────────────────────────────────────────
W_PROVIDER=""
W_MODEL=""
W_CHANNELS=""
W_DISABLED_TOOLS=""

# ── Section 1: AI Provider ────────────────────────────────────────────
step "AI Provider"
echo ""
echo -e "  ${BOLD}Local (no API key):${NC}"
echo -e "    ${BOLD}1${NC})  Ollama            ${DIM}free, runs on your machine${NC}"
echo -e "    ${BOLD}2${NC})  LM Studio         ${DIM}local GUI + server${NC}"
echo -e "    ${BOLD}3${NC})  vLLM              ${DIM}production inference server${NC}"
echo ""
echo -e "  ${BOLD}Cloud (API key required):${NC}"
echo -e "    ${BOLD}4${NC})  Anthropic          ${DIM}Claude${NC}"
echo -e "    ${BOLD}5${NC})  OpenAI             ${DIM}GPT-4o${NC}"
echo -e "    ${BOLD}6${NC})  Google             ${DIM}Gemini${NC}"
echo -e "    ${BOLD}7${NC})  Groq               ${DIM}fast inference${NC}"
echo -e "    ${BOLD}8${NC})  DeepSeek"
echo -e "    ${BOLD}9${NC})  Mistral"
echo -e "    ${BOLD}10${NC}) OpenRouter         ${DIM}multi-model gateway${NC}"
echo -e "    ${BOLD}11${NC}) Together           ${DIM}open-source models${NC}"
echo -e "    ${BOLD}12${NC}) xAI                ${DIM}Grok${NC}"
echo -e "    ${BOLD}13${NC}) Perplexity         ${DIM}search-augmented${NC}"
echo -e "    ${BOLD}14${NC}) Cohere             ${DIM}Command R${NC}"
echo ""

read -rp "  Select provider [1-14, Enter to skip]: " PROVIDER_CHOICE

ensure_env_template

case "$PROVIDER_CHOICE" in
    1)
        W_PROVIDER="ollama"
        read -rp "  Model name [qwen2.5:3b]: " MODEL_INPUT
        W_MODEL="${MODEL_INPUT:-qwen2.5:3b}"
        install_ollama "$W_MODEL"
        success "Ollama configured with $W_MODEL"
        ;;
    2)
        W_PROVIDER="lmstudio"
        read -rp "  LM Studio API URL [http://localhost:1234/v1]: " URL_INPUT
        W_MODEL="local-model"
        success "LM Studio configured"
        ;;
    3)
        W_PROVIDER="vllm"
        read -rp "  vLLM API URL [http://localhost:8000/v1]: " URL_INPUT
        read -rp "  Model name: " W_MODEL
        W_MODEL="${W_MODEL:-local-model}"
        success "vLLM configured"
        ;;
    4)
        W_PROVIDER="anthropic"
        W_MODEL="claude-sonnet-4-5-20250929"
        echo -e "  ${DIM}Get your key at console.anthropic.com${NC}"
        read -rsp "  Anthropic API key: " key; echo
        [ -n "$key" ] && set_env_var "ANTHROPIC_API_KEY" "$key"
        success "Anthropic configured"
        ;;
    5)
        W_PROVIDER="openai"
        W_MODEL="gpt-4o"
        echo -e "  ${DIM}Get your key at platform.openai.com${NC}"
        read -rsp "  OpenAI API key: " key; echo
        [ -n "$key" ] && set_env_var "OPENAI_API_KEY" "$key"
        success "OpenAI configured"
        ;;
    6)
        W_PROVIDER="google"
        W_MODEL="gemini-2.0-flash"
        echo -e "  ${DIM}Get your key at aistudio.google.com${NC}"
        read -rsp "  Google API key: " key; echo
        [ -n "$key" ] && set_env_var "GOOGLE_API_KEY" "$key"
        success "Google configured"
        ;;
    7)
        W_PROVIDER="groq"
        W_MODEL="llama-3.3-70b-versatile"
        echo -e "  ${DIM}Get your key at console.groq.com${NC}"
        read -rsp "  Groq API key: " key; echo
        [ -n "$key" ] && set_env_var "GROQ_API_KEY" "$key"
        success "Groq configured"
        ;;
    8)
        W_PROVIDER="deepseek"
        W_MODEL="deepseek-chat"
        echo -e "  ${DIM}Get your key at platform.deepseek.com${NC}"
        read -rsp "  DeepSeek API key: " key; echo
        [ -n "$key" ] && set_env_var "DEEPSEEK_API_KEY" "$key"
        success "DeepSeek configured"
        ;;
    9)
        W_PROVIDER="mistral"
        W_MODEL="mistral-large-latest"
        echo -e "  ${DIM}Get your key at console.mistral.ai${NC}"
        read -rsp "  Mistral API key: " key; echo
        [ -n "$key" ] && set_env_var "MISTRAL_API_KEY" "$key"
        success "Mistral configured"
        ;;
    10)
        W_PROVIDER="openrouter"
        W_MODEL="anthropic/claude-sonnet-4-5-20250929"
        echo -e "  ${DIM}Get your key at openrouter.ai${NC}"
        read -rsp "  OpenRouter API key: " key; echo
        [ -n "$key" ] && set_env_var "OPENROUTER_API_KEY" "$key"
        success "OpenRouter configured"
        ;;
    11)
        W_PROVIDER="together"
        W_MODEL="meta-llama/Llama-3.3-70B-Instruct-Turbo"
        echo -e "  ${DIM}Get your key at api.together.ai${NC}"
        read -rsp "  Together API key: " key; echo
        [ -n "$key" ] && set_env_var "TOGETHER_API_KEY" "$key"
        success "Together configured"
        ;;
    12)
        W_PROVIDER="xai"
        W_MODEL="grok-2"
        echo -e "  ${DIM}Get your key at console.x.ai${NC}"
        read -rsp "  xAI API key: " key; echo
        [ -n "$key" ] && set_env_var "XAI_API_KEY" "$key"
        success "xAI configured"
        ;;
    13)
        W_PROVIDER="perplexity"
        W_MODEL="sonar-pro"
        echo -e "  ${DIM}Get your key at perplexity.ai${NC}"
        read -rsp "  Perplexity API key: " key; echo
        [ -n "$key" ] && set_env_var "PERPLEXITY_API_KEY" "$key"
        success "Perplexity configured"
        ;;
    14)
        W_PROVIDER="cohere"
        W_MODEL="command-r-plus"
        echo -e "  ${DIM}Get your key at dashboard.cohere.com${NC}"
        read -rsp "  Cohere API key: " key; echo
        [ -n "$key" ] && set_env_var "COHERE_API_KEY" "$key"
        success "Cohere configured"
        ;;
    "")
        info "Skipped -- you can set this up later with ./setup.sh --config"
        W_PROVIDER="anthropic"
        W_MODEL="claude-sonnet-4-5-20250929"
        ;;
    *)
        warn "Invalid choice, skipping provider setup"
        W_PROVIDER="anthropic"
        W_MODEL="claude-sonnet-4-5-20250929"
        ;;
esac

# ── Section 2: Messaging Channels ────────────────────────────────────
step "Messaging Channels"
echo ""
echo -e "  ${DIM}Connect HydraClaw to messaging platforms (optional).${NC}"
echo ""
echo -e "    ${BOLD}1${NC})  Telegram          ${BOLD}7${NC})  IRC             ${BOLD}13${NC}) Line"
echo -e "    ${BOLD}2${NC})  Discord           ${BOLD}8${NC})  Email           ${BOLD}14${NC}) Teams"
echo -e "    ${BOLD}3${NC})  Slack             ${BOLD}9${NC})  Reddit          ${BOLD}15${NC}) Webchat"
echo -e "    ${BOLD}4${NC})  WhatsApp          ${BOLD}10${NC}) Twitter/X       ${BOLD}16${NC}) Zalo"
echo -e "    ${BOLD}5${NC})  Signal            ${BOLD}11${NC}) Mastodon        ${BOLD}17${NC}) iMessage"
echo -e "    ${BOLD}6${NC})  Matrix            ${BOLD}12${NC}) Bluesky         ${BOLD}18${NC}) XMPP"
echo ""
read -rp "  Select channels [e.g. 1,2,3 or Enter to skip]: " CHANNEL_INPUT

# Map numbers to channel names
declare -A CHANNEL_MAP=(
    [1]="telegram"   [2]="discord"    [3]="slack"      [4]="whatsapp"
    [5]="signal"     [6]="matrix"     [7]="irc"        [8]="email"
    [9]="reddit"     [10]="twitter"   [11]="mastodon"  [12]="bluesky"
    [13]="line"      [14]="teams"     [15]="webchat"   [16]="zalo"
    [17]="imessage"  [18]="xmpp"
)

SELECTED_CHANNELS=()
if [ -n "$CHANNEL_INPUT" ]; then
    IFS=',' read -ra CHANNEL_NUMS <<< "$CHANNEL_INPUT"
    for num in "${CHANNEL_NUMS[@]}"; do
        num="$(echo "$num" | tr -d ' ')"
        if [ -n "${CHANNEL_MAP[$num]:-}" ]; then
            SELECTED_CHANNELS+=("${CHANNEL_MAP[$num]}")
        fi
    done
fi

# Collect credentials for each selected channel
for channel in "${SELECTED_CHANNELS[@]}"; do
    echo ""
    case "$channel" in
        telegram)
            echo -e "  ${BOLD}Telegram Setup${NC}"
            echo -e "  ${DIM}Open Telegram, search @BotFather, send /newbot to create a bot${NC}"
            read -rp "  Bot token: " token
            [ -n "$token" ] && set_env_var "TELEGRAM_BOT_TOKEN" "$token"
            success "Telegram configured"
            ;;
        discord)
            echo -e "  ${BOLD}Discord Setup${NC}"
            echo -e "  ${DIM}Create a bot at discord.com/developers/applications${NC}"
            read -rsp "  Bot token: " token; echo
            [ -n "$token" ] && set_env_var "DISCORD_BOT_TOKEN" "$token"
            success "Discord configured"
            ;;
        slack)
            echo -e "  ${BOLD}Slack Setup${NC}"
            echo -e "  ${DIM}Create an app at api.slack.com/apps${NC}"
            read -rsp "  Bot token (xoxb-...): " token; echo
            [ -n "$token" ] && set_env_var "SLACK_BOT_TOKEN" "$token"
            read -rsp "  App token (xapp-...): " app_token; echo
            [ -n "$app_token" ] && set_env_var "SLACK_APP_TOKEN" "$app_token"
            success "Slack configured"
            ;;
        whatsapp)
            echo -e "  ${BOLD}WhatsApp Setup${NC}"
            echo -e "  ${DIM}Uses web.whatsapp.com pairing. A QR code will appear on first start.${NC}"
            success "WhatsApp enabled (scan QR on first run)"
            ;;
        signal)
            echo -e "  ${BOLD}Signal Setup${NC}"
            echo -e "  ${DIM}Requires signal-cli to be installed and linked${NC}"
            read -rp "  Phone number (+1234567890): " phone
            success "Signal configured"
            ;;
        matrix)
            echo -e "  ${BOLD}Matrix Setup${NC}"
            read -rp "  Homeserver URL [https://matrix.org]: " hs_url
            read -rp "  Bot user ID (@bot:matrix.org): " user_id
            read -rsp "  Access token: " token; echo
            [ -n "$token" ] && set_env_var "MATRIX_ACCESS_TOKEN" "$token"
            success "Matrix configured"
            ;;
        irc)
            echo -e "  ${BOLD}IRC Setup${NC}"
            read -rp "  Server [irc.libera.chat]: " irc_host
            read -rp "  Nickname [hydraclaw]: " irc_nick
            read -rp "  Channel [#hydraclaw]: " irc_chan
            success "IRC configured"
            ;;
        email)
            echo -e "  ${BOLD}Email Setup${NC}"
            echo -e "  ${DIM}Default: Gmail IMAP/SMTP. Edit config.yaml for other providers.${NC}"
            read -rp "  Email address: " email_user
            read -rsp "  Password or app password: " email_pass; echo
            [ -n "$email_user" ] && set_env_var "EMAIL_USER" "$email_user"
            [ -n "$email_pass" ] && set_env_var "EMAIL_PASSWORD" "$email_pass"
            success "Email configured (Gmail defaults)"
            ;;
        reddit)
            echo -e "  ${BOLD}Reddit Setup${NC}"
            echo -e "  ${DIM}Create an app at reddit.com/prefs/apps${NC}"
            read -rp "  Client ID: " client_id
            read -rsp "  Client secret: " client_secret; echo
            read -rp "  Username: " reddit_user
            read -rsp "  Password: " reddit_pass; echo
            read -rp "  Subreddit to monitor: " subreddit
            [ -n "$client_id" ] && set_env_var "REDDIT_CLIENT_ID" "$client_id"
            [ -n "$client_secret" ] && set_env_var "REDDIT_CLIENT_SECRET" "$client_secret"
            [ -n "$reddit_user" ] && set_env_var "REDDIT_USERNAME" "$reddit_user"
            [ -n "$reddit_pass" ] && set_env_var "REDDIT_PASSWORD" "$reddit_pass"
            success "Reddit configured"
            ;;
        twitter)
            echo -e "  ${BOLD}Twitter/X Setup${NC}"
            echo -e "  ${DIM}Create an app at developer.twitter.com${NC}"
            read -rsp "  App key: " app_key; echo
            read -rsp "  App secret: " app_secret; echo
            read -rsp "  Access token: " access_token; echo
            read -rsp "  Access secret: " access_secret; echo
            [ -n "$app_key" ] && set_env_var "TWITTER_APP_KEY" "$app_key"
            [ -n "$app_secret" ] && set_env_var "TWITTER_APP_SECRET" "$app_secret"
            [ -n "$access_token" ] && set_env_var "TWITTER_ACCESS_TOKEN" "$access_token"
            [ -n "$access_secret" ] && set_env_var "TWITTER_ACCESS_SECRET" "$access_secret"
            success "Twitter/X configured"
            ;;
        mastodon)
            echo -e "  ${BOLD}Mastodon Setup${NC}"
            read -rp "  Instance URL [https://mastodon.social]: " masto_url
            read -rsp "  Access token: " token; echo
            [ -n "$token" ] && set_env_var "MASTODON_ACCESS_TOKEN" "$token"
            success "Mastodon configured"
            ;;
        bluesky)
            echo -e "  ${BOLD}Bluesky Setup${NC}"
            read -rp "  Handle (yourname.bsky.social): " bs_handle
            read -rsp "  App password: " bs_pass; echo
            [ -n "$bs_pass" ] && set_env_var "BLUESKY_PASSWORD" "$bs_pass"
            success "Bluesky configured"
            ;;
        xmpp)
            echo -e "  ${BOLD}XMPP Setup${NC}"
            read -rp "  Server (ws://server:5280/xmpp-websocket): " xmpp_service
            read -rp "  Username: " xmpp_user
            read -rsp "  Password: " xmpp_pass; echo
            [ -n "$xmpp_pass" ] && set_env_var "XMPP_PASSWORD" "$xmpp_pass"
            success "XMPP configured"
            ;;
        line)
            echo -e "  ${BOLD}LINE Setup${NC}"
            echo -e "  ${DIM}Create a channel at developers.line.biz${NC}"
            read -rsp "  Channel access token: " token; echo
            read -rsp "  Channel secret: " secret; echo
            [ -n "$token" ] && set_env_var "LINE_CHANNEL_TOKEN" "$token"
            [ -n "$secret" ] && set_env_var "LINE_CHANNEL_SECRET" "$secret"
            success "LINE configured"
            ;;
        teams)
            echo -e "  ${BOLD}Microsoft Teams Setup${NC}"
            echo -e "  ${DIM}Register a bot at dev.botframework.com${NC}"
            read -rp "  App ID: " app_id
            read -rsp "  App password: " app_pass; echo
            [ -n "$app_id" ] && set_env_var "TEAMS_APP_ID" "$app_id"
            [ -n "$app_pass" ] && set_env_var "TEAMS_APP_PASSWORD" "$app_pass"
            success "Teams configured"
            ;;
        webchat)
            echo -e "  ${BOLD}Webchat${NC}"
            success "Webchat enabled (available at gateway port)"
            ;;
        zalo)
            echo -e "  ${BOLD}Zalo Setup${NC}"
            read -rp "  OA ID: " zalo_oa
            read -rsp "  Secret key: " zalo_secret; echo
            read -rsp "  Access token: " zalo_token; echo
            [ -n "$zalo_oa" ] && set_env_var "ZALO_OA_ID" "$zalo_oa"
            [ -n "$zalo_secret" ] && set_env_var "ZALO_SECRET_KEY" "$zalo_secret"
            [ -n "$zalo_token" ] && set_env_var "ZALO_ACCESS_TOKEN" "$zalo_token"
            success "Zalo configured"
            ;;
        imessage)
            echo -e "  ${BOLD}iMessage Setup${NC}"
            echo -e "  ${DIM}Requires macOS with Messages.app configured${NC}"
            success "iMessage enabled"
            ;;
    esac
done

W_CHANNELS="$(IFS=,; echo "${SELECTED_CHANNELS[*]}")"

if [ ${#SELECTED_CHANNELS[@]} -eq 0 ]; then
    info "No channels selected -- you can add them later with ./setup.sh --config"
fi

# ── Section 3: Agent Tools ────────────────────────────────────────────
step "Agent Tools"
echo ""
echo -e "  ${DIM}All 12 tools are enabled by default.${NC}"
echo ""
echo -e "    ${BOLD}1${NC})  shell           ${BOLD}5${NC})  scheduler       ${BOLD}9${NC})  scraper"
echo -e "    ${BOLD}2${NC})  filesystem      ${BOLD}6${NC})  webhook         ${BOLD}10${NC}) git"
echo -e "    ${BOLD}3${NC})  browser         ${BOLD}7${NC})  database        ${BOLD}11${NC}) docker"
echo -e "    ${BOLD}4${NC})  http-client     ${BOLD}8${NC})  code-runner     ${BOLD}12${NC}) image-gen"
echo ""
read -rp "  Disable any? [e.g. 11,12 or Enter to keep all]: " TOOL_INPUT

declare -A TOOL_MAP=(
    [1]="shell"       [2]="filesystem"  [3]="browser"     [4]="http-client"
    [5]="scheduler"   [6]="webhook"     [7]="database"    [8]="code-runner"
    [9]="scraper"     [10]="git"        [11]="docker"     [12]="image-gen"
)

DISABLED_TOOLS=()
if [ -n "$TOOL_INPUT" ]; then
    IFS=',' read -ra TOOL_NUMS <<< "$TOOL_INPUT"
    for num in "${TOOL_NUMS[@]}"; do
        num="$(echo "$num" | tr -d ' ')"
        if [ -n "${TOOL_MAP[$num]:-}" ]; then
            DISABLED_TOOLS+=("${TOOL_MAP[$num]}")
            info "Disabled: ${TOOL_MAP[$num]}"
        fi
    done
fi

if [ ${#DISABLED_TOOLS[@]} -eq 0 ]; then
    success "All 12 tools enabled"
fi

W_DISABLED_TOOLS="$(IFS=,; echo "${DISABLED_TOOLS[*]}")"

# ── Generate config.yaml ─────────────────────────────────────────────
step "Saving configuration"

if [ -f config.yaml ]; then
    cp config.yaml config.yaml.bak
    info "Backed up existing config.yaml to config.yaml.bak"
fi

generate_config "$W_PROVIDER" "$W_MODEL" "$W_CHANNELS" "$W_DISABLED_TOOLS"
success "config.yaml written"
success ".env updated"

# ── Done ──────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  HydraClaw is ready!${NC}"
echo -e "${GREEN}${BOLD}============================================${NC}"
echo ""

# Summary of what was configured
echo -e "  ${BOLD}Provider:${NC}  $W_PROVIDER ($W_MODEL)"

if [ ${#SELECTED_CHANNELS[@]} -gt 0 ]; then
    echo -e "  ${BOLD}Channels:${NC}  ${SELECTED_CHANNELS[*]}"
fi

if [ ${#DISABLED_TOOLS[@]} -gt 0 ]; then
    echo -e "  ${BOLD}Disabled:${NC}  ${DISABLED_TOOLS[*]}"
else
    echo -e "  ${BOLD}Tools:${NC}     all 12 enabled"
fi

echo ""
echo -e "  ${BOLD}Quick test:${NC}"
echo -e "     ${CYAN}node packages/cli/dist/index.js chat \"Hello\"${NC}"
echo ""
echo -e "  ${BOLD}Start server:${NC}"
echo -e "     ${CYAN}node packages/cli/dist/index.js start${NC}"
echo ""
echo -e "  ${BOLD}Re-configure:${NC}"
echo -e "     ${CYAN}./setup.sh --config${NC}"
echo ""
echo -e "  ${BOLD}Files:${NC}  ${CYAN}config.yaml${NC}  ${CYAN}.env${NC}  ${CYAN}data/${NC}"
echo ""
