/**
 * ASCII art banner and version display for HydraClaw.
 */

import { colorize, type Color } from './renderer.js';

const HYDRA_ART = `
    __  __          __           ________
   / / / /_  ______/ /________ _/ ____/ /___ _      __
  / /_/ / / / / __  / ___/ __ \`/ /   / / __ \`/ | /| / /
 / __  / /_/ / /_/ / /  / /_/ / /___/ / /_/ /| |/ |/ /
/_/ /_/\\__, /\\__,_/_/   \\__,_/\\____/_/\\__,_/ |__/|__/
      /____/
`;

const GRADIENT_COLORS: Color[] = [
  'brightCyan',
  'cyan',
  'brightBlue',
  'blue',
  'brightMagenta',
  'magenta',
];

/**
 * Display the HydraClaw ASCII art banner with gradient coloring.
 */
export function showBanner(): void {
  const lines = HYDRA_ART.split('\n').filter((line) => line.length > 0);
  for (let i = 0; i < lines.length; i++) {
    const color = GRADIENT_COLORS[i % GRADIENT_COLORS.length];
    console.log(colorize(lines[i], color));
  }
}

/**
 * Display version information.
 */
export function showVersion(): void {
  const version = '1.0.0';
  console.log(
    colorize('  HydraClaw', 'brightCyan') +
    colorize(` v${version}`, 'brightBlack') +
    colorize(' — Multi-Head AI Chat Agent', 'brightBlack'),
  );
  console.log();
}

/**
 * Display the full welcome screen with banner, version, and quick help.
 */
export function showWelcome(): void {
  showBanner();
  showVersion();

  console.log(colorize('  Quick Start:', 'brightWhite'));
  console.log(colorize('    Type a message to chat with the AI', 'brightBlack'));
  console.log(colorize('    /help       ', 'cyan') + colorize('Show available commands', 'brightBlack'));
  console.log(colorize('    /status     ', 'cyan') + colorize('Show system status', 'brightBlack'));
  console.log(colorize('    /model      ', 'cyan') + colorize('Switch AI model', 'brightBlack'));
  console.log(colorize('    /quit       ', 'cyan') + colorize('Exit HydraClaw', 'brightBlack'));
  console.log();
  console.log(colorize('  ─'.padEnd(60, '─'), 'brightBlack'));
  console.log();
}
