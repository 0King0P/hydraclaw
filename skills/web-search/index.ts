import type { Skill } from '@hydraclaw/skills';

const webSearchSkill: Skill = {
  id: 'web-search',
  name: 'Web Search',
  description: 'Search the web using multiple search providers',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/search', description: 'Search the web' },
    { type: 'command', pattern: '/google', description: 'Google search' },
    { type: 'keyword', pattern: 'search for,look up,find online,google', description: 'Search keywords' },
    { type: 'regex', pattern: '(search|look up|find)\\s+(for\\s+)?(.+?)\\s+(on the web|online)', description: 'Search request patterns' },
  ],

  tools: [
    {
      name: 'web_search',
      description: 'Search the web and return results',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          provider: { type: 'string', enum: ['google', 'brave', 'serper', 'tavily'], description: 'Search provider' },
          limit: { type: 'number', description: 'Number of results (default 10)' },
          dateRestrict: { type: 'string', description: 'Date restriction (e.g., "d1" for past day, "w1" for past week)' },
        },
        required: ['query'],
      },
      async handler(args) {
        const { query, provider, limit, dateRestrict } = args as {
          query: string; provider?: string; limit?: number; dateRestrict?: string;
        };

        const searchProvider = provider ?? detectProvider();

        switch (searchProvider) {
          case 'serper':
            return searchSerper(query, limit ?? 10, dateRestrict);
          case 'brave':
            return searchBrave(query, limit ?? 10);
          case 'tavily':
            return searchTavily(query, limit ?? 10);
          case 'google':
          default:
            return searchGoogle(query, limit ?? 10, dateRestrict);
        }
      },
    },
    {
      name: 'web_fetch',
      description: 'Fetch and extract text content from a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          maxLength: { type: 'number', description: 'Max content length in characters' },
        },
        required: ['url'],
      },
      async handler(args) {
        const { url, maxLength } = args as { url: string; maxLength?: number };

        const response = await fetch(url, {
          headers: { 'User-Agent': 'HydraClaw-WebSearch/1.0' },
        });

        if (!response.ok) {
          return `Error fetching URL: ${response.status} ${response.statusText}`;
        }

        const html = await response.text();

        // Extract text content from HTML
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[\s\S]*?<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ')
          .trim();

        const limit = maxLength ?? 5000;
        if (text.length > limit) {
          return text.slice(0, limit) + `\n\n[Truncated at ${limit} characters, total: ${text.length}]`;
        }

        return text;
      },
    },
  ],

  systemPromptAddition: 'You can search the web and fetch page content using the Web Search skill tools. Use /search to find information online.',

  async init() {
    const hasKey = detectProvider() !== 'none';
    if (!hasKey) {
      console.warn('[web-search-skill] No search API keys found. Set SERPER_API_KEY, BRAVE_API_KEY, TAVILY_API_KEY, or GOOGLE_API_KEY.');
    }
  },
};

function detectProvider(): string {
  if (process.env.SERPER_API_KEY) return 'serper';
  if (process.env.BRAVE_API_KEY) return 'brave';
  if (process.env.TAVILY_API_KEY) return 'tavily';
  if (process.env.GOOGLE_API_KEY) return 'google';
  return 'none';
}

async function searchGoogle(query: string, limit: number, dateRestrict?: string): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cx) return 'Error: GOOGLE_API_KEY and GOOGLE_CSE_ID are required';

  const params = new URLSearchParams({
    key: apiKey,
    cx,
    q: query,
    num: Math.min(limit, 10).toString(),
  });
  if (dateRestrict) params.set('dateRestrict', dateRestrict);

  const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
  if (!response.ok) return `Error: ${response.status} ${await response.text()}`;

  const data = await response.json() as {
    items: { title: string; link: string; snippet: string }[];
  };

  return (data.items ?? []).map((item, i) =>
    `${i + 1}. ${item.title}\n   ${item.link}\n   ${item.snippet}`
  ).join('\n\n');
}

async function searchSerper(query: string, limit: number, dateRestrict?: string): Promise<string> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return 'Error: SERPER_API_KEY is required';

  const body: Record<string, unknown> = { q: query, num: limit };
  if (dateRestrict) body.tbs = `qdr:${dateRestrict}`;

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) return `Error: ${response.status} ${await response.text()}`;

  const data = await response.json() as {
    organic: { title: string; link: string; snippet: string }[];
  };

  return (data.organic ?? []).map((item, i) =>
    `${i + 1}. ${item.title}\n   ${item.link}\n   ${item.snippet}`
  ).join('\n\n');
}

async function searchBrave(query: string, limit: number): Promise<string> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return 'Error: BRAVE_API_KEY is required';

  const params = new URLSearchParams({ q: query, count: limit.toString() });
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
  });

  if (!response.ok) return `Error: ${response.status} ${await response.text()}`;

  const data = await response.json() as {
    web: { results: { title: string; url: string; description: string }[] };
  };

  return (data.web?.results ?? []).map((item, i) =>
    `${i + 1}. ${item.title}\n   ${item.url}\n   ${item.description}`
  ).join('\n\n');
}

async function searchTavily(query: string, limit: number): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return 'Error: TAVILY_API_KEY is required';

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: limit }),
  });

  if (!response.ok) return `Error: ${response.status} ${await response.text()}`;

  const data = await response.json() as {
    results: { title: string; url: string; content: string }[];
  };

  return (data.results ?? []).map((item, i) =>
    `${i + 1}. ${item.title}\n   ${item.url}\n   ${item.content.slice(0, 200)}`
  ).join('\n\n');
}

export default webSearchSkill;
