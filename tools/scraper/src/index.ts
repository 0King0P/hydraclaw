import * as cheerio from 'cheerio';
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
    name: 'scrape_url',
    description: 'Fetch a webpage and extract content. Optionally provide a CSS selector to extract specific elements. Returns text content by default.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the webpage to scrape',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to extract specific elements (e.g. "h1", ".article-body", "#content")',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'scrape_links',
    description: 'Extract all links (anchor tags) from a webpage. Returns href, text, and title for each link.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the webpage to extract links from',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'scrape_text',
    description: 'Extract clean text content from a webpage, stripping all HTML tags, scripts, and styles. Good for reading article content.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the webpage to extract text from',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'scrape_structured',
    description: 'Extract structured data from a webpage using a map of named CSS selectors. Returns an object with the selector names as keys and extracted text as values.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the webpage to scrape',
        },
        selectors: {
          type: 'object',
          description: 'Object mapping field names to CSS selectors (e.g. { "title": "h1", "price": ".price", "description": ".desc" })',
        },
      },
      required: ['url', 'selectors'],
    },
  },
];

export class ScraperTool implements Tool {
  readonly id = 'scraper';
  readonly name = 'Scraper';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;
  private userAgent = 'HydraClaw-Scraper/1.0';

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'scraper' });

    const config = ctx.config as Record<string, unknown>;
    if (config.userAgent) this.userAgent = config.userAgent as string;

    this.logger.info('Scraper tool initialized');
  }

  async destroy(): Promise<void> {
    this.logger.info('Scraper tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case 'scrape_url':
          return await this.scrapeUrl(call);
        case 'scrape_links':
          return await this.scrapeLinks(call);
        case 'scrape_text':
          return await this.scrapeText(call);
        case 'scrape_structured':
          return await this.scrapeStructured(call);
        default:
          return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Scraper error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private async fetchPage(url: string): Promise<string> {
    this.logger.debug(`Fetching: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  private async scrapeUrl(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { url: string; selector?: string };
    const html = await this.fetchPage(args.url);
    const $ = cheerio.load(html);

    // Remove script and style elements
    $('script, style, noscript').remove();

    let content: string;
    if (args.selector) {
      const elements = $(args.selector);
      const results: string[] = [];
      elements.each((_, el) => {
        results.push($(el).text().trim());
      });
      content = JSON.stringify({
        url: args.url,
        selector: args.selector,
        matchCount: results.length,
        results,
      }, null, 2);
    } else {
      // Return page title and body text
      const title = $('title').text().trim();
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      const maxLen = 100000;
      content = JSON.stringify({
        url: args.url,
        title,
        text: bodyText.length > maxLen ? bodyText.substring(0, maxLen) + '...[truncated]' : bodyText,
        textLength: bodyText.length,
      }, null, 2);
    }

    return { toolCallId: call.id, content };
  }

  private async scrapeLinks(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { url: string };
    const html = await this.fetchPage(args.url);
    const $ = cheerio.load(html);

    const links: Array<{ href: string; text: string; title: string | undefined }> = [];

    $('a[href]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      if (href) {
        // Resolve relative URLs
        let absoluteHref = href;
        try {
          absoluteHref = new URL(href, args.url).toString();
        } catch {
          // Keep as-is if URL parsing fails
        }

        links.push({
          href: absoluteHref,
          text: $el.text().trim(),
          title: $el.attr('title'),
        });
      }
    });

    return {
      toolCallId: call.id,
      content: JSON.stringify({ url: args.url, links, total: links.length }, null, 2),
    };
  }

  private async scrapeText(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { url: string };
    const html = await this.fetchPage(args.url);
    const $ = cheerio.load(html);

    // Remove non-content elements
    $('script, style, noscript, nav, header, footer, iframe, svg').remove();

    const title = $('title').text().trim();

    // Try to get main content area first
    let textContent: string;
    const mainContent = $('main, article, [role="main"], .content, #content').first();
    if (mainContent.length > 0) {
      textContent = mainContent.text();
    } else {
      textContent = $('body').text();
    }

    // Clean up whitespace: collapse multiple whitespace/newlines
    textContent = textContent
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    const maxLen = 100000;
    if (textContent.length > maxLen) {
      textContent = textContent.substring(0, maxLen) + '\n...[truncated]';
    }

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        url: args.url,
        title,
        text: textContent,
        textLength: textContent.length,
      }, null, 2),
    };
  }

  private async scrapeStructured(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { url: string; selectors: Record<string, string> };
    const html = await this.fetchPage(args.url);
    const $ = cheerio.load(html);

    const data: Record<string, string | string[]> = {};

    for (const [field, selector] of Object.entries(args.selectors)) {
      const elements = $(selector);
      if (elements.length === 0) {
        data[field] = '';
      } else if (elements.length === 1) {
        data[field] = elements.text().trim();
      } else {
        const values: string[] = [];
        elements.each((_, el) => {
          values.push($(el).text().trim());
        });
        data[field] = values;
      }
    }

    return {
      toolCallId: call.id,
      content: JSON.stringify({ url: args.url, data }, null, 2),
    };
  }
}

export default ScraperTool;
