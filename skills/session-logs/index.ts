import type { Skill } from '@hydraclaw/skills';

interface LogEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  channel?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

// In-memory log store (in production, this would use @hydraclaw/store)
const logStore: LogEntry[] = [];
let logIdCounter = 0;

const sessionLogsSkill: Skill = {
  id: 'session-logs',
  name: 'Session Logs',
  description: 'View, search, and export conversation session logs',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/logs', description: 'View session logs' },
    { type: 'command', pattern: '/history', description: 'View conversation history' },
    { type: 'keyword', pattern: 'session log,conversation log,chat history', description: 'Log-related keywords' },
  ],

  tools: [
    {
      name: 'logs_record',
      description: 'Record a log entry for the current session',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session identifier' },
          role: { type: 'string', enum: ['user', 'assistant', 'system', 'tool'], description: 'Message role' },
          content: { type: 'string', description: 'Message content' },
          channel: { type: 'string', description: 'Channel the message originated from' },
          userId: { type: 'string', description: 'User identifier' },
          metadata: { type: 'object', description: 'Additional metadata' },
        },
        required: ['sessionId', 'role', 'content'],
      },
      async handler(args) {
        const { sessionId, role, content, channel, userId, metadata } = args as {
          sessionId: string; role: 'user' | 'assistant' | 'system' | 'tool';
          content: string; channel?: string; userId?: string; metadata?: Record<string, unknown>;
        };

        const entry: LogEntry = {
          id: `log_${++logIdCounter}`,
          sessionId,
          timestamp: new Date().toISOString(),
          role,
          content,
          channel,
          userId,
          metadata,
        };

        logStore.push(entry);
        return `Log entry recorded (${entry.id})`;
      },
    },
    {
      name: 'logs_view',
      description: 'View log entries for a session',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session identifier' },
          limit: { type: 'number', description: 'Max entries to return (default 20)' },
          offset: { type: 'number', description: 'Skip first N entries' },
          role: { type: 'string', enum: ['user', 'assistant', 'system', 'tool'], description: 'Filter by role' },
        },
        required: ['sessionId'],
      },
      async handler(args) {
        const { sessionId, limit, offset, role } = args as {
          sessionId: string; limit?: number; offset?: number; role?: string;
        };

        let entries = logStore.filter(e => e.sessionId === sessionId);
        if (role) {
          entries = entries.filter(e => e.role === role);
        }

        const total = entries.length;
        entries = entries.slice(offset ?? 0, (offset ?? 0) + (limit ?? 20));

        if (entries.length === 0) {
          return `No log entries found for session "${sessionId}"`;
        }

        const header = `Session "${sessionId}" - ${total} total entries (showing ${entries.length}):`;
        const lines = entries.map(e => {
          const channelStr = e.channel ? ` [${e.channel}]` : '';
          const contentPreview = e.content.length > 100 ? e.content.slice(0, 100) + '...' : e.content;
          return `  ${e.timestamp} [${e.role}]${channelStr}: ${contentPreview}`;
        });

        return [header, '', ...lines].join('\n');
      },
    },
    {
      name: 'logs_search',
      description: 'Search across all session logs',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (case-insensitive substring match)' },
          sessionId: { type: 'string', description: 'Limit to specific session' },
          channel: { type: 'string', description: 'Filter by channel' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['query'],
      },
      async handler(args) {
        const { query, sessionId, channel, limit } = args as {
          query: string; sessionId?: string; channel?: string; limit?: number;
        };

        const lowerQuery = query.toLowerCase();
        let results = logStore.filter(e => e.content.toLowerCase().includes(lowerQuery));

        if (sessionId) results = results.filter(e => e.sessionId === sessionId);
        if (channel) results = results.filter(e => e.channel === channel);

        results = results.slice(0, limit ?? 20);

        if (results.length === 0) return `No log entries matching "${query}"`;

        return results.map(e => {
          const contentPreview = e.content.length > 80 ? e.content.slice(0, 80) + '...' : e.content;
          return `  [${e.sessionId}] ${e.timestamp} [${e.role}]: ${contentPreview}`;
        }).join('\n');
      },
    },
    {
      name: 'logs_export',
      description: 'Export session logs as JSON',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session to export' },
          format: { type: 'string', enum: ['json', 'text'], description: 'Export format' },
        },
        required: ['sessionId'],
      },
      async handler(args) {
        const { sessionId, format } = args as { sessionId: string; format?: string };

        const entries = logStore.filter(e => e.sessionId === sessionId);
        if (entries.length === 0) return `No entries found for session "${sessionId}"`;

        if (format === 'text') {
          return entries.map(e =>
            `[${e.timestamp}] ${e.role.toUpperCase()}: ${e.content}`
          ).join('\n');
        }

        return JSON.stringify(entries, null, 2);
      },
    },
  ],

  systemPromptAddition: 'You can view, search, and export conversation session logs using the Session Logs skill tools.',

  async init() {
    // Log store is initialized in memory
  },

  async destroy() {
    logStore.length = 0;
    logIdCounter = 0;
  },
};

export default sessionLogsSkill;
