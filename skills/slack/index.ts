import type { Skill } from '@hydraclaw/skills';

async function slackApi(method: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN environment variable is not set');

  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json() as Record<string, unknown>;
  if (!data.ok) {
    throw new Error(`Slack API error (${method}): ${data.error as string}`);
  }
  return data;
}

const slackSkill: Skill = {
  id: 'slack',
  name: 'Slack',
  description: 'Extended Slack operations: manage channels, users, reactions, threads, and files',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/slack', description: 'Slack operations' },
    { type: 'keyword', pattern: 'slack,channel,thread,dm', description: 'Slack keywords' },
  ],

  tools: [
    {
      name: 'slack_send_message',
      description: 'Send a message to a Slack channel or user',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel ID or name' },
          text: { type: 'string', description: 'Message text' },
          threadTs: { type: 'string', description: 'Thread timestamp for replies' },
          blocks: { type: 'array', description: 'Block Kit blocks' },
        },
        required: ['channel', 'text'],
      },
      async handler(args) {
        const { channel, text, threadTs, blocks } = args as {
          channel: string; text: string; threadTs?: string; blocks?: unknown[];
        };

        const payload: Record<string, unknown> = { channel, text };
        if (threadTs) payload.thread_ts = threadTs;
        if (blocks) payload.blocks = blocks;

        const result = await slackApi('chat.postMessage', payload);
        return `Message sent to ${channel} (ts: ${result.ts as string})`;
      },
    },
    {
      name: 'slack_list_channels',
      description: 'List Slack channels the bot has access to',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max channels to return' },
          types: { type: 'string', description: 'Channel types (public_channel,private_channel)' },
        },
      },
      async handler(args) {
        const { limit, types } = args as { limit?: number; types?: string };

        const result = await slackApi('conversations.list', {
          limit: limit ?? 50,
          types: types ?? 'public_channel,private_channel',
        });

        const channels = result.channels as { id: string; name: string; num_members: number; purpose: { value: string } }[];
        return channels.map(c =>
          `#${c.name} (${c.id}) - ${c.num_members} members - ${c.purpose?.value || 'No purpose set'}`
        ).join('\n');
      },
    },
    {
      name: 'slack_add_reaction',
      description: 'Add an emoji reaction to a message',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel ID' },
          timestamp: { type: 'string', description: 'Message timestamp' },
          emoji: { type: 'string', description: 'Emoji name (without colons)' },
        },
        required: ['channel', 'timestamp', 'emoji'],
      },
      async handler(args) {
        const { channel, timestamp, emoji } = args as { channel: string; timestamp: string; emoji: string };
        await slackApi('reactions.add', { channel, timestamp, name: emoji });
        return `Reaction :${emoji}: added`;
      },
    },
    {
      name: 'slack_search_messages',
      description: 'Search for messages across Slack',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Number of results' },
          sort: { type: 'string', enum: ['score', 'timestamp'], description: 'Sort order' },
        },
        required: ['query'],
      },
      async handler(args) {
        const { query, count, sort } = args as { query: string; count?: number; sort?: string };

        const token = process.env.SLACK_USER_TOKEN ?? process.env.SLACK_BOT_TOKEN;
        if (!token) return 'Error: Slack token not configured';

        const response = await fetch(`https://slack.com/api/search.messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, count: count ?? 10, sort: sort ?? 'score' }),
        });

        const data = await response.json() as {
          ok: boolean;
          messages: { matches: { text: string; channel: { name: string }; ts: string; username: string }[] };
        };

        if (!data.ok) return 'Error searching messages';

        return data.messages.matches.map((m, i) =>
          `${i + 1}. [#${m.channel.name}] @${m.username}: ${m.text.slice(0, 100)}`
        ).join('\n');
      },
    },
  ],

  systemPromptAddition: 'You can send Slack messages, list channels, add reactions, and search messages using the Slack skill tools.',

  async init(config) {
    if (!process.env.SLACK_BOT_TOKEN && !config.token) {
      console.warn('[slack-skill] No SLACK_BOT_TOKEN found. Slack operations will fail until one is provided.');
    }
  },
};

export default slackSkill;
