#!/usr/bin/env bash
#
# HydraClaw - One-Command Setup for Debian/Ubuntu
#
# Usage:
#   chmod +x setup.sh && ./setup.sh
#
# This script installs all system dependencies, Node.js 22, pnpm,
# project packages, builds the project, creates a default config,
# and starts the gateway server.
#
# Tested on: Debian 11/12, Ubuntu 22.04/24.04

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors for output
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }
step()    { echo -e "\n${BOLD}==> $*${NC}"; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
step "Checking system"

if [ "$(id -u)" -eq 0 ]; then
    warn "Running as root. Prefer running as a normal user with sudo access."
fi

# Detect Debian/Ubuntu
if [ -f /etc/os-release ]; then
    . /etc/os-release
    case "$ID" in
        debian|ubuntu|linuxmint|pop|elementary|zorin|kali|raspbian)
            info "Detected $PRETTY_NAME"
            ;;
        *)
            warn "This script is built for Debian/Ubuntu. Detected: $PRETTY_NAME"
            warn "Proceeding anyway -- some package commands may need adjustment."
            ;;
    esac
else
    warn "Could not detect OS. Proceeding assuming Debian/Ubuntu."
fi

# Resolve project root (directory where this script lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
info "Project directory: $SCRIPT_DIR"

# ---------------------------------------------------------------------------
# Step 1: Install system dependencies
# ---------------------------------------------------------------------------
step "Step 1/6 - Installing system dependencies"

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

# ---------------------------------------------------------------------------
# Step 2: Install Node.js 22
# ---------------------------------------------------------------------------
step "Step 2/6 - Setting up Node.js 22"

install_node() {
    info "Installing Node.js 22 via NodeSource..."
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | sudo gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
        | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
    sudo apt-get update -qq
    sudo apt-get install -y -qq nodejs
}

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
    install_node
    success "Node.js $(node --version) installed"
fi

# ---------------------------------------------------------------------------
# Step 3: Install pnpm
# ---------------------------------------------------------------------------
step "Step 3/6 - Setting up pnpm"

if command -v pnpm &>/dev/null; then
    success "pnpm $(pnpm --version) already installed"
else
    info "Enabling corepack and activating pnpm..."
    sudo corepack enable || corepack enable
    corepack prepare pnpm@latest --activate 2>/dev/null || true
    # Fallback if corepack doesn't work
    if ! command -v pnpm &>/dev/null; then
        info "Corepack failed, installing pnpm via npm..."
        sudo npm install -g pnpm
    fi
    success "pnpm $(pnpm --version) installed"
fi

# ---------------------------------------------------------------------------
# Step 4: Install project dependencies + native modules
# ---------------------------------------------------------------------------
step "Step 4/6 - Installing project dependencies"

info "Running pnpm install (this may take a minute)..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Native modules (better-sqlite3, cpu-features, ssh2) need their build
# scripts to run. If they were blocked, force a reinstall to compile them.
if [ ! -d node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3/prebuilds ] && \
   [ ! -d node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3/build ]; then
    info "Rebuilding native modules (better-sqlite3, ssh2)..."
    pnpm install --force 2>/dev/null || true
fi
success "Dependencies installed"

# ---------------------------------------------------------------------------
# Step 5: Build the project
# ---------------------------------------------------------------------------
step "Step 5/6 - Building HydraClaw"

# Clean stale incremental build caches that can cause tsc to skip emitting
# output files (TypeScript composite builds use tsconfig.tsbuildinfo to track
# what's already built -- if dist/ was removed but tsbuildinfo wasn't, tsc
# thinks everything is up to date and emits nothing).
info "Cleaning stale build artifacts..."
pnpm clean 2>/dev/null || true

info "Compiling TypeScript across all packages..."
pnpm build
success "Build complete"

# Verify
if [ ! -f packages/cli/dist/index.js ]; then
    fail "Build verification failed: packages/cli/dist/index.js not found"
fi

# ---------------------------------------------------------------------------
# Step 6: Create default configuration
# ---------------------------------------------------------------------------
step "Step 6/6 - Setting up configuration"

mkdir -p data

if [ ! -f config.yaml ]; then
    cp config.example.yaml config.yaml
    success "Created config.yaml from template"
    warn "Edit config.yaml to add your API keys before starting"
else
    success "config.yaml already exists (not overwriting)"
fi

if [ ! -f .env ]; then
    cat > .env << 'ENVEOF'
# HydraClaw Environment Variables
# Uncomment and fill in the providers you want to use

# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# GOOGLE_API_KEY=
# GROQ_API_KEY=
# MISTRAL_API_KEY=
# TOGETHER_API_KEY=
# OPENROUTER_API_KEY=
# DEEPSEEK_API_KEY=
# XAI_API_KEY=
# PERPLEXITY_API_KEY=
# COHERE_API_KEY=

# Messaging channels
# TELEGRAM_BOT_TOKEN=
# DISCORD_BOT_TOKEN=
# SLACK_BOT_TOKEN=
# SLACK_APP_TOKEN=
ENVEOF
    success "Created .env template"
else
    success ".env already exists (not overwriting)"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  HydraClaw installation complete!${NC}"
echo -e "${GREEN}${BOLD}============================================${NC}"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo ""
echo -e "  1. Add at least one API key:"
echo -e "     ${CYAN}nano .env${NC}              (or edit config.yaml directly)"
echo ""
echo -e "  2. Start the server:"
echo -e "     ${CYAN}node packages/cli/dist/index.js start${NC}"
echo ""
echo -e "  3. Or send a quick test message:"
echo -e "     ${CYAN}node packages/cli/dist/index.js chat \"Hello\"${NC}"
echo ""
echo -e "  Ports:  ${BOLD}3000${NC} (HTTP)  ${BOLD}3001${NC} (WebSocket)  ${BOLD}9876${NC} (Webhooks)"
echo -e "  Config: ${CYAN}config.yaml${NC}   Env: ${CYAN}.env${NC}   Data: ${CYAN}./data/${NC}"
echo ""
