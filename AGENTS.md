# AGENTS.md - Guidelines for AI Agents Working on HydraClaw

## Project Overview

HydraClaw is a multi-headed AI assistant platform. It's a monorepo built with TypeScript, Node.js 22+, and pnpm workspaces.

## Architecture

- **packages/** - Core platform packages (20 packages)
- **providers/** - AI provider plugins (14 providers)
- **channels/** - Messaging channel plugins (18 channels)
- **tools/** - Automation tool plugins (12 tools)
- **skills/** - Extensible skill modules (15 skills)
- **extensions/** - Platform extensions (10 extensions)
- **ui/** - Web chat UI

## Key Conventions

- ES modules only (`"type": "module"`)
- Import paths must use `.js` extension (e.g., `import { foo } from './bar.js'`)
- TypeScript strict mode enabled
- All packages use `@hydraclaw/` npm scope
- Plugin interfaces: `AIProvider`, `Channel`, `Tool`, `Skill`, `Extension`
- Use `Container` for dependency injection
- Use `MessageBus` for event-driven communication
- Use `pino` for logging

## Testing

- Vitest for unit tests
- Test files colocated with source: `*.test.ts`
- Run tests: `pnpm test`

## Building

```bash
pnpm install
pnpm build          # Build all packages
pnpm dev            # Watch mode
```

## Important Notes

- The gateway WebSocket runs on port 3001 by default
- The HTTP API runs on port 3000 by default
- OpenRouter is the recommended default provider
- Config supports YAML files and environment variables
- Security features are opt-in
