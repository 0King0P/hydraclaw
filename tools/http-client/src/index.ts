import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
    name: 'http_request',
    description: 'Make an HTTP request to any URL. Supports all HTTP methods, custom headers, and request bodies. Returns status code, response headers, and body text.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to send the request to',
        },
        method: {
          type: 'string',
          description: 'HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS). Defaults to GET.',
        },
        headers: {
          type: 'object',
          description: 'Request headers as key-value pairs',
        },
        body: {
          type: 'string',
          description: 'Request body as a string. For JSON, stringify the object first.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'http_download',
    description: 'Download a file from a URL and save it to the local filesystem.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to download the file from',
        },
        savePath: {
          type: 'string',
          description: 'Local file path to save the downloaded file to',
        },
      },
      required: ['url', 'savePath'],
    },
  },
];

export class HttpClientTool implements Tool {
  readonly id = 'http';
  readonly name = 'HTTP Client';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'http' });
    this.logger.info('HTTP Client tool initialized');
  }

  async destroy(): Promise<void> {
    this.logger.info('HTTP Client tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case 'http_request':
          return await this.httpRequest(call);
        case 'http_download':
          return await this.httpDownload(call);
        default:
          return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `HTTP error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private async httpRequest(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };

    const method = (args.method ?? 'GET').toUpperCase();
    const url = args.url;

    this.logger.info(`HTTP ${method} ${url}`);

    const fetchOptions: RequestInit = {
      method,
      headers: args.headers,
    };

    if (args.body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = args.body;
    }

    const response = await fetch(url, fetchOptions);

    // Collect response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Read body as text
    let bodyText: string;
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
      // For binary content, return base64
      const buffer = await response.arrayBuffer();
      bodyText = `[Binary content, ${buffer.byteLength} bytes, base64: ${Buffer.from(buffer).toString('base64').substring(0, 200)}...]`;
    } else {
      bodyText = await response.text();

      // Truncate very large responses
      const maxLength = 100000;
      if (bodyText.length > maxLength) {
        bodyText = bodyText.substring(0, maxLength) + '\n...[truncated]';
      }
    }

    const result = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bodyText,
    };

    return {
      toolCallId: call.id,
      content: JSON.stringify(result, null, 2),
      isError: response.status >= 400,
    };
  }

  private async httpDownload(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { url: string; savePath: string };
    const savePath = resolve(args.savePath);

    this.logger.info(`Downloading: ${args.url} -> ${savePath}`);

    const response = await fetch(args.url);

    if (!response.ok) {
      return {
        toolCallId: call.id,
        content: `Download failed: HTTP ${response.status} ${response.statusText}`,
        isError: true,
      };
    }

    const buffer = await response.arrayBuffer();

    // Ensure parent directory exists
    await mkdir(dirname(savePath), { recursive: true });

    await writeFile(savePath, Buffer.from(buffer));

    const contentType = response.headers.get('content-type') ?? 'unknown';
    const result = {
      savedTo: savePath,
      size: buffer.byteLength,
      contentType,
      status: response.status,
    };

    return {
      toolCallId: call.id,
      content: JSON.stringify(result, null, 2),
    };
  }
}

export default HttpClientTool;
