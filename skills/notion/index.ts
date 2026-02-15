import type { Skill } from '@hydraclaw/skills';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

async function notionFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error('NOTION_API_KEY environment variable is not set');

  return fetch(`${NOTION_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

const notionSkill: Skill = {
  id: 'notion',
  name: 'Notion',
  description: 'Manage Notion pages, databases, and notes',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/notion', description: 'Notion operations' },
    { type: 'command', pattern: '/note', description: 'Create a note in Notion' },
    { type: 'keyword', pattern: 'notion,note,wiki,database,page', description: 'Notion-related keywords' },
  ],

  tools: [
    {
      name: 'notion_search',
      description: 'Search across Notion pages and databases',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          filter: { type: 'string', enum: ['page', 'database'], description: 'Filter by object type' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
      async handler(args) {
        const { query, filter, limit } = args as { query: string; filter?: string; limit?: number };

        const body: Record<string, unknown> = { query, page_size: limit ?? 10 };
        if (filter) {
          body.filter = { value: filter, property: 'object' };
        }

        const response = await notionFetch('/search', {
          method: 'POST',
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          return `Error searching Notion: ${response.status} ${await response.text()}`;
        }

        const data = await response.json() as {
          results: { id: string; object: string; url?: string; properties?: Record<string, { title?: { plain_text: string }[] }> }[];
        };

        if (data.results.length === 0) return `No results found for "${query}"`;

        return data.results.map((item, i) => {
          const title = item.properties?.title?.[0]?.plain_text
            ?? item.properties?.Name?.title?.[0]?.plain_text
            ?? 'Untitled';
          return `${i + 1}. [${item.object}] ${title} (${item.url ?? item.id})`;
        }).join('\n');
      },
    },
    {
      name: 'notion_create_page',
      description: 'Create a new page in Notion',
      parameters: {
        type: 'object',
        properties: {
          parentId: { type: 'string', description: 'Parent page or database ID' },
          parentType: { type: 'string', enum: ['page', 'database'], description: 'Parent type' },
          title: { type: 'string', description: 'Page title' },
          content: { type: 'string', description: 'Page content (plain text)' },
        },
        required: ['parentId', 'title'],
      },
      async handler(args) {
        const { parentId, parentType, title, content } = args as {
          parentId: string; parentType?: string; title: string; content?: string;
        };

        const parent = parentType === 'database'
          ? { database_id: parentId }
          : { page_id: parentId };

        const properties: Record<string, unknown> = {
          title: { title: [{ text: { content: title } }] },
        };

        const children: Record<string, unknown>[] = [];
        if (content) {
          // Split content into paragraphs
          const paragraphs = content.split('\n\n');
          for (const paragraph of paragraphs) {
            children.push({
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ text: { content: paragraph } }],
              },
            });
          }
        }

        const response = await notionFetch('/pages', {
          method: 'POST',
          body: JSON.stringify({ parent, properties, children }),
        });

        if (!response.ok) {
          return `Error creating page: ${response.status} ${await response.text()}`;
        }

        const page = await response.json() as { id: string; url: string };
        return `Page created: ${page.url}`;
      },
    },
    {
      name: 'notion_query_database',
      description: 'Query a Notion database with optional filters',
      parameters: {
        type: 'object',
        properties: {
          databaseId: { type: 'string', description: 'Database ID' },
          filter: { type: 'object', description: 'Notion filter object' },
          sorts: { type: 'array', items: { type: 'object' }, description: 'Sort configuration' },
          limit: { type: 'number', description: 'Max results' },
        },
        required: ['databaseId'],
      },
      async handler(args) {
        const { databaseId, filter, sorts, limit } = args as {
          databaseId: string; filter?: Record<string, unknown>;
          sorts?: Record<string, unknown>[]; limit?: number;
        };

        const body: Record<string, unknown> = { page_size: limit ?? 20 };
        if (filter) body.filter = filter;
        if (sorts) body.sorts = sorts;

        const response = await notionFetch(`/databases/${databaseId}/query`, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          return `Error querying database: ${response.status} ${await response.text()}`;
        }

        const data = await response.json() as {
          results: { id: string; url: string; properties: Record<string, unknown> }[];
        };

        if (data.results.length === 0) return 'No results found in database.';

        return data.results.map((row, i) => {
          const propSummary = Object.entries(row.properties)
            .slice(0, 4)
            .map(([key]) => key)
            .join(', ');
          return `${i + 1}. ${row.url} [${propSummary}]`;
        }).join('\n');
      },
    },
  ],

  systemPromptAddition: 'You can search Notion, create pages, and query databases using the Notion skill tools.',

  async init(config) {
    if (!process.env.NOTION_API_KEY && !config.apiKey) {
      console.warn('[notion-skill] No NOTION_API_KEY found. Notion operations will fail until one is provided.');
    }
  },
};

export default notionSkill;
