/**
 * Full terminal chat interface for HydraClaw.
 */

import * as readline from 'node:readline';
import type { ChatMessage, AIProvider, Channel, Tool } from '@hydraclaw/core';
import { showWelcome } from './banner.js';
import { renderMarkdown, renderTable, colorize, renderSpinner, type Color } from './renderer.js';
import { KeyBindingManager } from './keybindings.js';

export interface TerminalUIOptions {
  /** Prompt string displayed before user input. Defaults to "hydra> " */
  prompt?: string;
  /** Callback invoked when the user submits a non-command message */
  onMessage?: (content: string) => Promise<string | void>;
  /** Callback invoked when the user submits a command */
  onCommand?: (command: string, args: string) => Promise<void>;
}

interface CommandEntry {
  name: string;
  description: string;
  usage: string;
}

const BUILT_IN_COMMANDS: CommandEntry[] = [
  { name: '/help', description: 'Show available commands', usage: '/help' },
  { name: '/clear', description: 'Clear the terminal screen', usage: '/clear' },
  { name: '/status', description: 'Display system status', usage: '/status' },
  { name: '/model', description: 'Show or switch the active model', usage: '/model [name]' },
  { name: '/provider', description: 'Show or switch the active provider', usage: '/provider [name]' },
  { name: '/history', description: 'Show conversation history', usage: '/history [count]' },
  { name: '/quit', description: 'Exit HydraClaw', usage: '/quit' },
  { name: '/export', description: 'Export conversation to file', usage: '/export [path]' },
  { name: '/memory', description: 'Show memory / context usage', usage: '/memory' },
];

/**
 * Interactive terminal chat UI powered by readline.
 */
export class TerminalUI {
  private rl: readline.Interface | null = null;
  private keyBindings: KeyBindingManager;
  private promptStr: string;
  private running = false;
  private streamBuffer = '';
  private onMessage: (content: string) => Promise<string | void>;
  private onCommand: (command: string, args: string) => Promise<void>;

  constructor(options: TerminalUIOptions = {}) {
    this.promptStr = options.prompt ?? `${colorize('hydra', 'brightCyan')}${colorize('> ', 'brightBlack')}`;
    this.onMessage = options.onMessage ?? (async () => {});
    this.onCommand = options.onCommand ?? (async () => {});
    this.keyBindings = new KeyBindingManager();
  }

  /**
   * Initialize the terminal UI, display the banner, and begin the input loop.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    showWelcome();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.promptStr,
      terminal: true,
      completer: (line: string) => {
        const completions = this.keyBindings.complete(line);
        return [completions.length > 0 ? completions : [], line];
      },
    });

    this.keyBindings.attach(this.rl);
    this.keyBindings.setupDefaults({
      onInterrupt: () => this.stop(),
      onClearScreen: () => {
        console.clear();
        this.rl?.prompt();
      },
    });

    this.rl.on('line', (line: string) => {
      void this.handleInput(line);
    });

    this.rl.on('close', () => {
      this.running = false;
    });

    this.rl.prompt();
  }

  /**
   * Shut down the terminal UI and clean up resources.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.keyBindings.detach();
    console.log();
    console.log(colorize('Goodbye!', 'brightCyan'));
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Display formatted content with markdown rendering.
   */
  render(content: string): void {
    console.log();
    console.log(renderMarkdown(content));
    console.log();
    this.rl?.prompt();
  }

  /**
   * Incrementally render a streaming response chunk.
   * Call with an empty string or without arguments to finalize the stream.
   */
  renderStream(chunk?: string): void {
    if (chunk === undefined || chunk === '') {
      // Finalize the stream
      if (this.streamBuffer.length > 0) {
        // Move to a new line after streaming, then render the full response
        process.stdout.write('\n');
        this.streamBuffer = '';
      }
      console.log();
      this.rl?.prompt();
      return;
    }

    // On first chunk, add a blank line before the response
    if (this.streamBuffer.length === 0) {
      console.log();
      process.stdout.write(colorize('  ', 'brightBlack'));
    }

    this.streamBuffer += chunk;
    process.stdout.write(chunk);
  }

  /**
   * Display system status including providers, channels, and tools.
   */
  showStatus(
    providers: Array<Pick<AIProvider, 'id' | 'name'> & { modelCount?: number }>,
    channels: Array<Pick<Channel, 'id' | 'name'>>,
    tools: Array<Pick<Tool, 'id' | 'name'>>,
  ): void {
    console.log();
    console.log(colorize('  System Status', 'brightWhite'));
    console.log(colorize('  ─'.padEnd(50, '─'), 'brightBlack'));
    console.log();

    // Providers
    console.log(colorize('  Providers:', 'cyan'));
    if (providers.length === 0) {
      console.log(colorize('    (none registered)', 'brightBlack'));
    } else {
      for (const p of providers) {
        const models = p.modelCount !== undefined ? colorize(` (${p.modelCount} models)`, 'brightBlack') : '';
        console.log(`    ${colorize('●', 'green')} ${p.name}${models}`);
      }
    }
    console.log();

    // Channels
    console.log(colorize('  Channels:', 'cyan'));
    if (channels.length === 0) {
      console.log(colorize('    (none connected)', 'brightBlack'));
    } else {
      for (const c of channels) {
        console.log(`    ${colorize('●', 'green')} ${c.name}`);
      }
    }
    console.log();

    // Tools
    console.log(colorize('  Tools:', 'cyan'));
    if (tools.length === 0) {
      console.log(colorize('    (none loaded)', 'brightBlack'));
    } else {
      for (const t of tools) {
        console.log(`    ${colorize('●', 'green')} ${t.name}`);
      }
    }
    console.log();
    this.rl?.prompt();
  }

  /**
   * Display conversation history in a readable format.
   */
  showHistory(messages: ChatMessage[]): void {
    console.log();
    if (messages.length === 0) {
      console.log(colorize('  No messages in history.', 'brightBlack'));
      console.log();
      this.rl?.prompt();
      return;
    }

    console.log(colorize(`  Conversation History (${messages.length} messages)`, 'brightWhite'));
    console.log(colorize('  ─'.padEnd(50, '─'), 'brightBlack'));
    console.log();

    for (const msg of messages) {
      const roleColor: Color = msg.role === 'user' ? 'brightGreen' : msg.role === 'assistant' ? 'brightCyan' : 'brightYellow';
      const roleLabel = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
      const timestamp = msg.timestamp
        ? colorize(` [${new Date(msg.timestamp).toLocaleTimeString()}]`, 'brightBlack')
        : '';

      console.log(`  ${colorize(roleLabel, roleColor)}${timestamp}`);

      // Indent message content
      const contentLines = msg.content.split('\n');
      for (const line of contentLines) {
        console.log(`    ${line}`);
      }
      console.log();
    }

    this.rl?.prompt();
  }

  /**
   * Process user input. Dispatches commands to handleCommand and
   * regular messages to the onMessage callback.
   */
  async handleInput(line: string): Promise<void> {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      this.rl?.prompt();
      return;
    }

    this.keyBindings.addToHistory(trimmed);

    if (trimmed.startsWith('/')) {
      const spaceIndex = trimmed.indexOf(' ');
      const cmd = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
      const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim();
      await this.handleCommand(cmd, args);
      return;
    }

    // Regular message
    const spinner = renderSpinner('Thinking...');
    try {
      const response = await this.onMessage(trimmed);
      spinner.stop();
      if (typeof response === 'string' && response.length > 0) {
        this.render(response);
      } else {
        this.rl?.prompt();
      }
    } catch (err) {
      spinner.stop();
      const message = err instanceof Error ? err.message : String(err);
      console.log(colorize(`  Error: ${message}`, 'red'));
      console.log();
      this.rl?.prompt();
    }
  }

  /**
   * Process a slash command.
   */
  async handleCommand(cmd: string, args: string): Promise<void> {
    switch (cmd) {
      case '/help':
        this.showHelp();
        break;

      case '/clear':
        console.clear();
        this.rl?.prompt();
        break;

      case '/quit':
      case '/exit':
        this.stop();
        break;

      case '/status':
      case '/model':
      case '/provider':
      case '/history':
      case '/export':
      case '/memory':
        try {
          await this.onCommand(cmd, args);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(colorize(`  Error: ${message}`, 'red'));
          console.log();
          this.rl?.prompt();
        }
        break;

      default:
        console.log(colorize(`  Unknown command: ${cmd}. Type /help for available commands.`, 'yellow'));
        console.log();
        this.rl?.prompt();
        break;
    }
  }

  private showHelp(): void {
    console.log();
    console.log(colorize('  Available Commands', 'brightWhite'));
    console.log(colorize('  ─'.padEnd(50, '─'), 'brightBlack'));
    console.log();

    const headers = ['Command', 'Description', 'Usage'];
    const rows = BUILT_IN_COMMANDS.map((cmd) => [cmd.name, cmd.description, cmd.usage]);
    console.log(renderTable(headers, rows));
    console.log();

    console.log(colorize('  Keyboard Shortcuts:', 'brightWhite'));
    console.log(`    ${colorize('Ctrl+C', 'cyan')}   Interrupt / quit`);
    console.log(`    ${colorize('Ctrl+L', 'cyan')}   Clear screen`);
    console.log(`    ${colorize('Up/Down', 'cyan')}  Navigate input history`);
    console.log(`    ${colorize('Tab', 'cyan')}      Auto-complete commands`);
    console.log();

    this.rl?.prompt();
  }
}
