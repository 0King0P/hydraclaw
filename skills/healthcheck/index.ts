import type { Skill } from '@hydraclaw/skills';

interface HealthResult {
  url: string;
  status: number | null;
  latencyMs: number;
  healthy: boolean;
  error?: string;
  checkedAt: string;
}

const healthHistory = new Map<string, HealthResult[]>();
const MAX_HISTORY = 100;

async function checkUrl(url: string, timeoutMs: number): Promise<HealthResult> {
  const start = performance.now();
  const checkedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'HydraClaw-Healthcheck/1.0' },
    });

    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - start);

    const result: HealthResult = {
      url,
      status: response.status,
      latencyMs,
      healthy: response.status >= 200 && response.status < 400,
      checkedAt,
    };

    storeResult(url, result);
    return result;
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const result: HealthResult = {
      url,
      status: null,
      latencyMs,
      healthy: false,
      error: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
    storeResult(url, result);
    return result;
  }
}

function storeResult(url: string, result: HealthResult): void {
  const history = healthHistory.get(url) ?? [];
  history.push(result);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  healthHistory.set(url, history);
}

function formatResult(result: HealthResult): string {
  const statusStr = result.status !== null ? `${result.status}` : 'N/A';
  const healthStr = result.healthy ? 'HEALTHY' : 'UNHEALTHY';
  const errorStr = result.error ? ` (${result.error})` : '';
  return `[${healthStr}] ${result.url} - Status: ${statusStr}, Latency: ${result.latencyMs}ms${errorStr}`;
}

const healthcheckSkill: Skill = {
  id: 'healthcheck',
  name: 'Healthcheck',
  description: 'Monitor URLs and services for availability and response times',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/healthcheck', description: 'Run a health check' },
    { type: 'command', pattern: '/ping', description: 'Ping a URL' },
    { type: 'keyword', pattern: 'healthcheck,uptime,downtime,monitoring,status check', description: 'Healthcheck keywords' },
  ],

  tools: [
    {
      name: 'healthcheck_url',
      description: 'Check if a URL is reachable and measure response time',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to check' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default 10000)' },
        },
        required: ['url'],
      },
      async handler(args) {
        const { url, timeout } = args as { url: string; timeout?: number };
        const result = await checkUrl(url, timeout ?? 10000);
        return formatResult(result);
      },
    },
    {
      name: 'healthcheck_batch',
      description: 'Check multiple URLs in parallel',
      parameters: {
        type: 'object',
        properties: {
          urls: { type: 'array', items: { type: 'string' }, description: 'URLs to check' },
          timeout: { type: 'number', description: 'Timeout per URL in milliseconds' },
        },
        required: ['urls'],
      },
      async handler(args) {
        const { urls, timeout } = args as { urls: string[]; timeout?: number };
        const timeoutMs = timeout ?? 10000;

        const results = await Promise.all(urls.map(url => checkUrl(url, timeoutMs)));

        const healthy = results.filter(r => r.healthy).length;
        const lines = [
          `Batch healthcheck: ${healthy}/${results.length} healthy`,
          '',
          ...results.map(formatResult),
        ];

        return lines.join('\n');
      },
    },
    {
      name: 'healthcheck_history',
      description: 'View health check history for a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to view history for' },
          limit: { type: 'number', description: 'Number of recent entries (default 10)' },
        },
        required: ['url'],
      },
      async handler(args) {
        const { url, limit } = args as { url: string; limit?: number };
        const history = healthHistory.get(url);
        if (!history || history.length === 0) {
          return `No health check history found for ${url}`;
        }

        const entries = history.slice(-(limit ?? 10));
        const avgLatency = Math.round(entries.reduce((sum, r) => sum + r.latencyMs, 0) / entries.length);
        const uptime = (entries.filter(r => r.healthy).length / entries.length * 100).toFixed(1);

        return [
          `Health history for ${url} (last ${entries.length} checks):`,
          `  Average latency: ${avgLatency}ms`,
          `  Uptime: ${uptime}%`,
          '',
          ...entries.map(r => `  ${r.checkedAt}: ${r.healthy ? 'UP' : 'DOWN'} (${r.latencyMs}ms)`),
        ].join('\n');
      },
    },
  ],

  systemPromptAddition: 'You can check URL health, run batch checks, and view monitoring history using the Healthcheck skill tools.',

  async init() {
    // No external dependencies required
  },

  async destroy() {
    healthHistory.clear();
  },
};

export default healthcheckSkill;
