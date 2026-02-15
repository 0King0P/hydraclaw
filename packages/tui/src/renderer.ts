/**
 * Terminal content renderer with ANSI color support and markdown formatting.
 */

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  strikethrough: '\x1b[9m',

  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',

  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
} as const;

export type Color =
  | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'
  | 'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow'
  | 'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite';

/**
 * Wrap text with an ANSI color code.
 */
export function colorize(text: string, color: Color): string {
  const code = ANSI[color];
  if (!code) {
    return text;
  }
  return `${code}${text}${ANSI.reset}`;
}

/**
 * Render basic markdown to terminal-formatted text.
 *
 * Supports bold (**), italic (*), inline code (`), code blocks (```),
 * unordered lists (- / *), ordered lists (1.), headings (#), and
 * horizontal rules (---).
 */
export function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBuffer: string[] = [];

  for (const line of lines) {
    // Code block toggle
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trimStart().slice(3).trim();
        codeBuffer = [];
        continue;
      } else {
        output.push(renderCodeBlock(codeBuffer.join('\n'), codeBlockLang));
        inCodeBlock = false;
        codeBlockLang = '';
        codeBuffer = [];
        continue;
      }
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      output.push(colorize('─'.repeat(60), 'brightBlack'));
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = headingMatch[2];
      if (level === 1) {
        output.push(`${ANSI.bold}${ANSI.brightWhite}${heading}${ANSI.reset}`);
        output.push(colorize('═'.repeat(heading.length), 'brightBlack'));
      } else if (level === 2) {
        output.push(`${ANSI.bold}${ANSI.cyan}${heading}${ANSI.reset}`);
        output.push(colorize('─'.repeat(heading.length), 'brightBlack'));
      } else {
        output.push(`${ANSI.bold}${ANSI.blue}${heading}${ANSI.reset}`);
      }
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (ulMatch) {
      const indent = ulMatch[1];
      const item = formatInline(ulMatch[2]);
      output.push(`${indent}  ${colorize('●', 'cyan')} ${item}`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (olMatch) {
      const indent = olMatch[1];
      const num = olMatch[2];
      const item = formatInline(olMatch[3]);
      output.push(`${indent}  ${colorize(num + '.', 'cyan')} ${item}`);
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch) {
      output.push(`  ${colorize('│', 'brightBlack')} ${colorize(bqMatch[1], 'brightBlack')}`);
      continue;
    }

    // Regular text with inline formatting
    output.push(formatInline(line));
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBuffer.length > 0) {
    output.push(renderCodeBlock(codeBuffer.join('\n'), codeBlockLang));
  }

  return output.join('\n');
}

/**
 * Apply inline formatting: bold, italic, inline code, strikethrough.
 */
function formatInline(text: string): string {
  // Inline code (must be processed first to avoid conflicts)
  text = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    return `${ANSI.bgBlack}${ANSI.brightYellow}${code}${ANSI.reset}`;
  });

  // Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, (_m, bold: string) => {
    return `${ANSI.bold}${bold}${ANSI.reset}`;
  });

  // Italic
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_m, italic: string) => {
    return `${ANSI.italic}${italic}${ANSI.reset}`;
  });

  // Strikethrough
  text = text.replace(/~~([^~]+)~~/g, (_m, struck: string) => {
    return `${ANSI.strikethrough}${struck}${ANSI.reset}`;
  });

  // Links [text](url)
  text = text.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    return `${ANSI.underline}${ANSI.blue}${label}${ANSI.reset} ${ANSI.dim}(${url})${ANSI.reset}`;
  });

  return text;
}

/**
 * Render a fenced code block with a language label and box-drawing border.
 */
export function renderCodeBlock(code: string, language?: string): string {
  const lines = code.split('\n');
  const maxWidth = Math.max(...lines.map((l) => l.length), 40);
  const header = language
    ? ` ${colorize(language, 'brightBlack')} `
    : '';

  const top = `${colorize('┌' + header + '─'.repeat(Math.max(0, maxWidth - (language?.length ?? 0) - 1)) + '┐', 'brightBlack')}`;
  const bottom = `${colorize('└' + '─'.repeat(maxWidth + 1) + '┘', 'brightBlack')}`;

  const body = lines.map((line) => {
    const padded = line.padEnd(maxWidth);
    return `${colorize('│', 'brightBlack')} ${ANSI.brightWhite}${padded}${ANSI.reset}`;
  });

  return [top, ...body, bottom].join('\n');
}

/**
 * Render an ASCII table from headers and rows.
 */
export function renderTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => {
    const maxData = rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), 0);
    return Math.max(h.length, maxData);
  });

  const separator = '┼' + colWidths.map((w) => '─'.repeat(w + 2)).join('┼') + '┼';
  const topBorder = '┌' + colWidths.map((w) => '─'.repeat(w + 2)).join('┬') + '┐';
  const bottomBorder = '└' + colWidths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘';

  const formatRow = (cells: string[], bold = false): string => {
    const formatted = cells.map((cell, i) => {
      const padded = (cell ?? '').padEnd(colWidths[i]);
      return bold ? `${ANSI.bold}${padded}${ANSI.reset}` : padded;
    });
    return '│ ' + formatted.join(' │ ') + ' │';
  };

  const output: string[] = [
    colorize(topBorder, 'brightBlack'),
    formatRow(headers, true),
    colorize(separator, 'brightBlack'),
    ...rows.map((row) => formatRow(row)),
    colorize(bottomBorder, 'brightBlack'),
  ];

  return output.join('\n');
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Create and return a loading spinner that writes to stdout.
 * Returns a stop function that clears the spinner line.
 */
export function renderSpinner(text: string): { stop: (finalText?: string) => void } {
  let frame = 0;
  const interval = setInterval(() => {
    const spinner = colorize(SPINNER_FRAMES[frame % SPINNER_FRAMES.length], 'cyan');
    process.stdout.write(`\r${spinner} ${text}`);
    frame++;
  }, 80);

  return {
    stop(finalText?: string) {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(text.length + 4) + '\r');
      if (finalText) {
        process.stdout.write(finalText + '\n');
      }
    },
  };
}

/**
 * Render a progress bar to stdout.
 */
export function renderProgress(current: number, total: number, label?: string): string {
  const width = 30;
  const fraction = Math.min(current / total, 1);
  const filled = Math.round(width * fraction);
  const empty = width - filled;
  const percentage = Math.round(fraction * 100);

  const bar =
    colorize('█'.repeat(filled), 'green') +
    colorize('░'.repeat(empty), 'brightBlack');

  const pct = colorize(`${percentage}%`, 'brightWhite');
  const labelStr = label ? `${label} ` : '';

  return `${labelStr}${bar} ${pct} (${current}/${total})`;
}
