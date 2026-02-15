/**
 * Keyboard shortcut handling for the terminal UI.
 */

import type { Interface as ReadlineInterface } from 'node:readline';

export interface KeyBinding {
  /** Key sequence description, e.g. "ctrl+c" */
  key: string;
  /** Human-readable description of the action */
  description: string;
  /** Handler invoked when the key is pressed */
  handler: () => void;
}

/**
 * Manages keyboard shortcuts and history navigation for the terminal UI.
 */
export class KeyBindingManager {
  private bindings = new Map<string, KeyBinding>();
  private inputHistory: string[] = [];
  private historyIndex = -1;
  private rl: ReadlineInterface | null = null;
  private commands: string[] = [
    '/help',
    '/clear',
    '/status',
    '/model',
    '/provider',
    '/history',
    '/quit',
    '/export',
    '/memory',
  ];

  /**
   * Attach the key binding manager to a readline interface.
   */
  attach(rl: ReadlineInterface): void {
    this.rl = rl;

    process.stdin.on('keypress', (_str: string | undefined, key: KeyInfo | undefined) => {
      if (!key) return;
      this.handleKeyPress(key);
    });
  }

  /**
   * Detach from the readline interface and clean up listeners.
   */
  detach(): void {
    this.rl = null;
  }

  /**
   * Register a key binding.
   */
  register(binding: KeyBinding): void {
    this.bindings.set(binding.key, binding);
  }

  /**
   * Remove a key binding.
   */
  unregister(key: string): void {
    this.bindings.delete(key);
  }

  /**
   * Add a line to the input history.
   */
  addToHistory(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    // Avoid consecutive duplicates
    if (this.inputHistory.length > 0 && this.inputHistory[this.inputHistory.length - 1] === trimmed) {
      return;
    }
    this.inputHistory.push(trimmed);
    // Keep history bounded
    if (this.inputHistory.length > 500) {
      this.inputHistory.shift();
    }
    this.historyIndex = -1;
  }

  /**
   * Get the full input history.
   */
  getHistory(): string[] {
    return [...this.inputHistory];
  }

  /**
   * Set the list of available commands for tab completion.
   */
  setCommands(commands: string[]): void {
    this.commands = commands;
  }

  /**
   * Provide tab-completion results for the given partial input.
   */
  complete(partial: string): string[] {
    if (!partial.startsWith('/')) {
      return [];
    }
    return this.commands.filter((cmd) => cmd.startsWith(partial));
  }

  /**
   * Get all registered key bindings.
   */
  getBindings(): KeyBinding[] {
    return Array.from(this.bindings.values());
  }

  /**
   * Set up default key bindings for the TUI.
   */
  setupDefaults(callbacks: {
    onInterrupt: () => void;
    onClearScreen: () => void;
  }): void {
    this.register({
      key: 'ctrl+c',
      description: 'Interrupt / quit',
      handler: callbacks.onInterrupt,
    });

    this.register({
      key: 'ctrl+l',
      description: 'Clear screen',
      handler: callbacks.onClearScreen,
    });
  }

  private handleKeyPress(key: KeyInfo): void {
    // Named binding lookup
    const bindingKey = this.formatKeyName(key);
    const binding = this.bindings.get(bindingKey);
    if (binding) {
      binding.handler();
      return;
    }

    // History navigation
    if (key.name === 'up') {
      this.navigateHistory('up');
    } else if (key.name === 'down') {
      this.navigateHistory('down');
    } else if (key.name === 'tab') {
      this.handleTabCompletion();
    }
  }

  private navigateHistory(direction: 'up' | 'down'): void {
    if (this.inputHistory.length === 0 || !this.rl) return;

    if (direction === 'up') {
      if (this.historyIndex === -1) {
        this.historyIndex = this.inputHistory.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex--;
      }
    } else {
      if (this.historyIndex >= 0 && this.historyIndex < this.inputHistory.length - 1) {
        this.historyIndex++;
      } else {
        this.historyIndex = -1;
        // Clear the line when going past the most recent entry
        (this.rl as ReadlineInterface & { line?: string }).line = '';
        this.rl.write(null, { ctrl: true, name: 'u' });
        return;
      }
    }

    if (this.historyIndex >= 0 && this.historyIndex < this.inputHistory.length) {
      const entry = this.inputHistory[this.historyIndex];
      // Clear current line and write history entry
      this.rl.write(null, { ctrl: true, name: 'u' });
      this.rl.write(entry);
    }
  }

  private handleTabCompletion(): void {
    if (!this.rl) return;

    const currentLine = ((this.rl as ReadlineInterface & { line?: string }).line ?? '').trim();
    const matches = this.complete(currentLine);

    if (matches.length === 1) {
      this.rl.write(null, { ctrl: true, name: 'u' });
      this.rl.write(matches[0] + ' ');
    } else if (matches.length > 1) {
      console.log();
      console.log(matches.join('  '));
      this.rl.prompt(true);
    }
  }

  private formatKeyName(key: KeyInfo): string {
    const parts: string[] = [];
    if (key.ctrl) parts.push('ctrl');
    if (key.meta) parts.push('meta');
    if (key.shift) parts.push('shift');
    if (key.name) parts.push(key.name);
    return parts.join('+');
  }
}

interface KeyInfo {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}
