import type { Skill } from '@hydraclaw/skills';

const DISCORD_API = 'https://discord.com/api/v10';

async function discordFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN environment variable is not set');

  return fetch(`${DISCORD_API}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bot ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

const discordSkill: Skill = {
  id: 'discord',
  name: 'Discord',
  description: 'Extended Discord operations: manage servers, channels, roles, and messages',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/discord', description: 'Discord operations' },
    { type: 'keyword', pattern: 'discord,server,guild,role', description: 'Discord keywords' },
  ],

  tools: [
    {
      name: 'discord_send_message',
      description: 'Send a message to a Discord channel',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string', description: 'Channel ID' },
          content: { type: 'string', description: 'Message content' },
          embed: { type: 'object', description: 'Embed object' },
          replyTo: { type: 'string', description: 'Message ID to reply to' },
        },
        required: ['channelId', 'content'],
      },
      async handler(args) {
        const { channelId, content, embed, replyTo } = args as {
          channelId: string; content: string; embed?: Record<string, unknown>; replyTo?: string;
        };

        const body: Record<string, unknown> = { content };
        if (embed) body.embeds = [embed];
        if (replyTo) body.message_reference = { message_id: replyTo };

        const response = await discordFetch(`/channels/${channelId}/messages`, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          return `Error sending message: ${response.status} ${await response.text()}`;
        }

        const msg = await response.json() as { id: string };
        return `Message sent (ID: ${msg.id})`;
      },
    },
    {
      name: 'discord_list_guilds',
      description: 'List guilds (servers) the bot is a member of',
      parameters: { type: 'object', properties: {} },
      async handler() {
        const response = await discordFetch('/users/@me/guilds');
        if (!response.ok) return `Error: ${response.status} ${await response.text()}`;

        const guilds = await response.json() as { id: string; name: string; owner: boolean }[];
        return guilds.map(g =>
          `- ${g.name} (${g.id})${g.owner ? ' [Owner]' : ''}`
        ).join('\n');
      },
    },
    {
      name: 'discord_list_channels',
      description: 'List channels in a Discord guild',
      parameters: {
        type: 'object',
        properties: {
          guildId: { type: 'string', description: 'Guild (server) ID' },
          type: { type: 'number', description: 'Channel type filter (0=text, 2=voice, 4=category)' },
        },
        required: ['guildId'],
      },
      async handler(args) {
        const { guildId, type: channelType } = args as { guildId: string; type?: number };

        const response = await discordFetch(`/guilds/${guildId}/channels`);
        if (!response.ok) return `Error: ${response.status} ${await response.text()}`;

        let channels = await response.json() as { id: string; name: string; type: number; position: number }[];
        if (channelType !== undefined) {
          channels = channels.filter(c => c.type === channelType);
        }

        const typeNames: Record<number, string> = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 13: 'stage', 15: 'forum' };
        channels.sort((a, b) => a.position - b.position);

        return channels.map(c =>
          `- #${c.name} (${c.id}) [${typeNames[c.type] ?? `type:${c.type}`}]`
        ).join('\n');
      },
    },
    {
      name: 'discord_manage_role',
      description: 'Add or remove a role from a guild member',
      parameters: {
        type: 'object',
        properties: {
          guildId: { type: 'string', description: 'Guild ID' },
          userId: { type: 'string', description: 'User ID' },
          roleId: { type: 'string', description: 'Role ID' },
          action: { type: 'string', enum: ['add', 'remove'], description: 'Add or remove the role' },
        },
        required: ['guildId', 'userId', 'roleId', 'action'],
      },
      async handler(args) {
        const { guildId, userId, roleId, action } = args as {
          guildId: string; userId: string; roleId: string; action: string;
        };

        const method = action === 'add' ? 'PUT' : 'DELETE';
        const response = await discordFetch(
          `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
          { method }
        );

        if (response.status === 204) {
          return `Role ${action === 'add' ? 'added to' : 'removed from'} user ${userId}`;
        }
        return `Error: ${response.status} ${await response.text()}`;
      },
    },
  ],

  systemPromptAddition: 'You can manage Discord servers, send messages, list channels, and manage roles using the Discord skill tools.',

  async init(config) {
    if (!process.env.DISCORD_BOT_TOKEN && !config.token) {
      console.warn('[discord-skill] No DISCORD_BOT_TOKEN found. Discord operations will fail until one is provided.');
    }
  },
};

export default discordSkill;
