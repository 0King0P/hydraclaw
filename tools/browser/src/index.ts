import { chromium, type Browser, type Page, type BrowserContext } from 'playwright-core';
import type {
  Tool,
  ToolDefinition,
  ToolCall,
  ToolResult,
  PluginContext,
  Logger,
} from '@hydraclaw/core';

const DEFINITIONS: ToolDefinition[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL. Launches the browser on first use.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page. Returns a base64-encoded PNG image.',
    parameters: {
      type: 'object',
      properties: {
        fullPage: {
          type: 'boolean',
          description: 'Whether to capture the full scrollable page. Defaults to false (viewport only).',
        },
      },
    },
  },
  {
    name: 'browser_click',
    description: 'Click on an element matching the given CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the element to click',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input element matching the given CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the input element',
        },
        text: {
          type: 'string',
          description: 'Text to type into the element',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser_get_text',
    description: 'Get the text content of the page or a specific element.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the element. If omitted, returns the entire page body text.',
        },
      },
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Execute arbitrary JavaScript code in the browser page context and return the result.',
    parameters: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'JavaScript code to execute in the page context',
        },
      },
      required: ['script'],
    },
  },
  {
    name: 'browser_wait',
    description: 'Wait for an element matching the CSS selector to appear on the page.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to wait for',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds. Defaults to 30000 (30 seconds).',
        },
      },
      required: ['selector'],
    },
  },
];

export class BrowserTool implements Tool {
  readonly id = 'browser';
  readonly name = 'Browser';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'browser' });
    this.logger.info('Browser tool initialized (browser will launch on first use)');
  }

  async destroy(): Promise<void> {
    await this.closeBrowser();
    this.logger.info('Browser tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case 'browser_navigate':
          return await this.browserNavigate(call);
        case 'browser_screenshot':
          return await this.browserScreenshot(call);
        case 'browser_click':
          return await this.browserClick(call);
        case 'browser_type':
          return await this.browserType(call);
        case 'browser_get_text':
          return await this.browserGetText(call);
        case 'browser_evaluate':
          return await this.browserEvaluate(call);
        case 'browser_wait':
          return await this.browserWait(call);
        default:
          return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Browser error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private async ensureBrowser(): Promise<Page> {
    if (!this.browser || !this.browser.isConnected()) {
      this.logger.info('Launching Chromium browser...');
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      this.page = await this.context.newPage();
      this.logger.info('Browser launched successfully');
    }
    if (!this.page || this.page.isClosed()) {
      this.page = await this.context!.newPage();
    }
    return this.page;
  }

  private async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Browser may already be closed
      }
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  private async browserNavigate(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { url: string };
    const page = await this.ensureBrowser();

    this.logger.info(`Navigating to: ${args.url}`);
    const response = await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const status = response?.status() ?? 0;
    const title = await page.title();
    const url = page.url();

    return {
      toolCallId: call.id,
      content: JSON.stringify({ url, title, status }, null, 2),
    };
  }

  private async browserScreenshot(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { fullPage?: boolean };
    const page = await this.ensureBrowser();

    this.logger.debug('Taking screenshot');
    const buffer = await page.screenshot({
      fullPage: args.fullPage ?? false,
      type: 'png',
    });

    const base64 = buffer.toString('base64');
    return {
      toolCallId: call.id,
      content: JSON.stringify({
        type: 'image',
        format: 'png',
        encoding: 'base64',
        data: base64,
        size: buffer.length,
      }),
    };
  }

  private async browserClick(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { selector: string };
    const page = await this.ensureBrowser();

    this.logger.debug(`Clicking: ${args.selector}`);
    await page.click(args.selector, { timeout: 10000 });

    return {
      toolCallId: call.id,
      content: `Clicked element: ${args.selector}`,
    };
  }

  private async browserType(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { selector: string; text: string };
    const page = await this.ensureBrowser();

    this.logger.debug(`Typing into: ${args.selector}`);
    await page.fill(args.selector, args.text, { timeout: 10000 });

    return {
      toolCallId: call.id,
      content: `Typed "${args.text}" into ${args.selector}`,
    };
  }

  private async browserGetText(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { selector?: string };
    const page = await this.ensureBrowser();

    let text: string;
    if (args.selector) {
      this.logger.debug(`Getting text from: ${args.selector}`);
      text = await page.textContent(args.selector, { timeout: 10000 }) ?? '';
    } else {
      this.logger.debug('Getting full page text');
      text = await page.textContent('body') ?? '';
    }

    // Trim excessive whitespace
    text = text.replace(/\s+/g, ' ').trim();

    // Truncate very long text
    const maxLength = 50000;
    const truncated = text.length > maxLength;
    if (truncated) {
      text = text.substring(0, maxLength);
    }

    return {
      toolCallId: call.id,
      content: JSON.stringify({ text, length: text.length, truncated }, null, 2),
    };
  }

  private async browserEvaluate(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { script: string };
    const page = await this.ensureBrowser();

    this.logger.debug('Evaluating JavaScript');
    const result = await page.evaluate(args.script);

    let content: string;
    if (result === undefined || result === null) {
      content = String(result);
    } else if (typeof result === 'object') {
      content = JSON.stringify(result, null, 2);
    } else {
      content = String(result);
    }

    return { toolCallId: call.id, content };
  }

  private async browserWait(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { selector: string; timeout?: number };
    const page = await this.ensureBrowser();
    const timeout = args.timeout ?? 30000;

    this.logger.debug(`Waiting for selector: ${args.selector} (timeout: ${timeout}ms)`);
    await page.waitForSelector(args.selector, { timeout });

    return {
      toolCallId: call.id,
      content: `Element found: ${args.selector}`,
    };
  }
}

export default BrowserTool;
