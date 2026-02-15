import type { InboundMessage } from '@hydraclaw/core';

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

export type CommandHandler = (
  command: ParsedCommand,
  message: InboundMessage,
) => Promise<string | void>;

/**
 * CommandGate - Detect and route command-style messages.
 *
 * Commands are messages that start with a recognized prefix (e.g., "/" or "!").
 * The gate can parse commands, dispatch them to registered handlers,
 * and provides built-in commands for common operations.
 */
export class CommandGate {
  private prefixes: string[];
  private commands: Map<string, CommandHandler> = new Map();

  constructor(prefixes: string[] = ['/', '!']) {
    this.prefixes = prefixes;
    this.registerBuiltinCommands();
  }

  /**
   * Check if a message is a command (starts with a recognized prefix).
   */
  isCommand(message: InboundMessage): boolean {
    const trimmed = message.content.trim();
    return this.prefixes.some((prefix) => trimmed.startsWith(prefix));
  }

  /**
   * Parse a command message into its name and arguments.
   * Returns null if the message is not a command.
   */
  parseCommand(message: InboundMessage): ParsedCommand | null {
    const trimmed = message.content.trim();

    const prefix = this.prefixes.find((p) => trimmed.startsWith(p));
    if (!prefix) {
      return null;
    }

    const withoutPrefix = trimmed.slice(prefix.length);
    const parts = withoutPrefix.split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
      return null;
    }

    return {
      name: parts[0].toLowerCase(),
      args: parts.slice(1),
      raw: withoutPrefix,
    };
  }

  /**
   * Register a command handler. Overwrites any existing handler for the same name.
   */
  registerCommand(name: string, handler: CommandHandler): void {
    this.commands.set(name.toLowerCase(), handler);
  }

  /**
   * Unregister a command handler.
   */
  unregisterCommand(name: string): boolean {
    return this.commands.delete(name.toLowerCase());
  }

  /**
   * Execute a command from a message.
   * Returns the command response string, or null if the message is not a command
   * or no handler is registered.
   */
  async execute(message: InboundMessage): Promise<string | null> {
    const parsed = this.parseCommand(message);
    if (!parsed) {
      return null;
    }

    const handler = this.commands.get(parsed.name);
    if (!handler) {
      return `Unknown command: ${parsed.name}. Type /help for available commands.`;
    }

    try {
      const result = await handler(parsed, message);
      return result ?? null;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return `Command error: ${errMsg}`;
    }
  }

  /**
   * Get a list of all registered command names.
   */
  getCommands(): string[] {
    return [...this.commands.keys()];
  }

  /**
   * Check if a command is registered.
   */
  hasCommand(name: string): boolean {
    return this.commands.has(name.toLowerCase());
  }

  private registerBuiltinCommands(): void {
    this.registerCommand('help', async () => {
      const cmds = this.getCommands().sort();
      return `Available commands:\n${cmds.map((c) => `  /${c}`).join('\n')}`;
    });

    this.registerCommand('status', async () => {
      return `Status: Online\nRegistered commands: ${this.commands.size}\nTimestamp: ${new Date().toISOString()}`;
    });

    this.registerCommand('model', async (_cmd, _msg) => {
      return 'Current model information is not available. Configure via agent settings.';
    });

    this.registerCommand('clear', async () => {
      return 'Conversation cleared.';
    });

    this.registerCommand('history', async () => {
      return 'Message history is managed by the session store.';
    });
  }
}
