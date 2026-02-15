import type { Skill } from '@hydraclaw/skills';

interface Reminder {
  id: string;
  userId: string;
  message: string;
  triggerAt: Date;
  createdAt: Date;
  channel?: string;
  recurring?: {
    interval: 'daily' | 'weekly' | 'monthly';
    count?: number; // remaining occurrences, undefined = infinite
  };
  fired: boolean;
}

const reminders = new Map<string, Reminder>();
let reminderIdCounter = 0;
const activeTimers = new Map<string, NodeJS.Timeout>();

function scheduleReminder(reminder: Reminder, onFire: (r: Reminder) => void): void {
  const now = Date.now();
  const delay = reminder.triggerAt.getTime() - now;

  if (delay <= 0) {
    // Already past, fire immediately
    onFire(reminder);
    return;
  }

  const timer = setTimeout(() => {
    reminder.fired = true;
    onFire(reminder);

    // Handle recurring
    if (reminder.recurring) {
      if (reminder.recurring.count !== undefined) {
        reminder.recurring.count--;
        if (reminder.recurring.count <= 0) {
          activeTimers.delete(reminder.id);
          return;
        }
      }

      const next = new Date(reminder.triggerAt);
      switch (reminder.recurring.interval) {
        case 'daily': next.setDate(next.getDate() + 1); break;
        case 'weekly': next.setDate(next.getDate() + 7); break;
        case 'monthly': next.setMonth(next.getMonth() + 1); break;
      }

      reminder.triggerAt = next;
      reminder.fired = false;
      scheduleReminder(reminder, onFire);
    } else {
      activeTimers.delete(reminder.id);
    }
  }, Math.min(delay, 2147483647)); // Cap at max 32-bit int for setTimeout

  activeTimers.set(reminder.id, timer);
}

function parseTimeExpression(expression: string): Date | null {
  const now = new Date();

  // Relative: "in 5 minutes", "in 2 hours", "in 1 day"
  const relativeMatch = expression.match(/^in\s+(\d+)\s+(second|minute|hour|day|week|month)s?$/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]!, 10);
    const unit = relativeMatch[2]!.toLowerCase();
    const date = new Date(now);

    switch (unit) {
      case 'second': date.setSeconds(date.getSeconds() + amount); break;
      case 'minute': date.setMinutes(date.getMinutes() + amount); break;
      case 'hour': date.setHours(date.getHours() + amount); break;
      case 'day': date.setDate(date.getDate() + amount); break;
      case 'week': date.setDate(date.getDate() + amount * 7); break;
      case 'month': date.setMonth(date.getMonth() + amount); break;
    }

    return date;
  }

  // Absolute: "at 3:00 PM", "at 15:00"
  const timeMatch = expression.match(/^at\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]!, 10);
    const minutes = parseInt(timeMatch[2]!, 10);
    const ampm = timeMatch[3]?.toLowerCase();

    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);

    // If time has passed today, set for tomorrow
    if (date <= now) {
      date.setDate(date.getDate() + 1);
    }

    return date;
  }

  // ISO date string
  const isoDate = new Date(expression);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  return null;
}

const reminderSkill: Skill = {
  id: 'reminder',
  name: 'Reminder',
  description: 'Set, manage, and schedule reminders with support for recurring schedules',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/remind', description: 'Set a reminder' },
    { type: 'command', pattern: '/reminder', description: 'Manage reminders' },
    { type: 'keyword', pattern: 'remind me,reminder,set reminder,don\'t forget', description: 'Reminder keywords' },
    { type: 'regex', pattern: 'remind\\s+me\\s+(to|about|in|at)', description: 'Remind me patterns' },
  ],

  tools: [
    {
      name: 'reminder_set',
      description: 'Set a new reminder',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Reminder message' },
          when: { type: 'string', description: 'When to trigger (e.g., "in 5 minutes", "at 3:00 PM", ISO date)' },
          userId: { type: 'string', description: 'User to remind' },
          channel: { type: 'string', description: 'Channel to send reminder in' },
          recurring: {
            type: 'object',
            properties: {
              interval: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
              count: { type: 'number', description: 'Number of recurrences' },
            },
            description: 'Recurring schedule',
          },
        },
        required: ['message', 'when'],
      },
      async handler(args) {
        const { message, when, userId, channel, recurring } = args as {
          message: string; when: string; userId?: string; channel?: string;
          recurring?: { interval: 'daily' | 'weekly' | 'monthly'; count?: number };
        };

        const triggerAt = parseTimeExpression(when);
        if (!triggerAt) {
          return `Could not parse time expression: "${when}". Use formats like "in 5 minutes", "at 3:00 PM", or an ISO date string.`;
        }

        const id = `rem_${++reminderIdCounter}`;
        const reminder: Reminder = {
          id,
          userId: userId ?? 'default',
          message,
          triggerAt,
          createdAt: new Date(),
          channel,
          recurring,
          fired: false,
        };

        reminders.set(id, reminder);

        scheduleReminder(reminder, (r) => {
          console.log(`[REMINDER] ${r.message} (${r.id})`);
        });

        const recurringStr = recurring
          ? ` (recurring ${recurring.interval}${recurring.count ? `, ${recurring.count} times` : ''})`
          : '';

        return `Reminder set (${id}): "${message}" at ${triggerAt.toISOString()}${recurringStr}`;
      },
    },
    {
      name: 'reminder_list',
      description: 'List all reminders for a user',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User to list reminders for' },
          includeCompleted: { type: 'boolean', description: 'Include fired reminders' },
        },
      },
      async handler(args) {
        const { userId, includeCompleted } = args as { userId?: string; includeCompleted?: boolean };

        let entries = Array.from(reminders.values());
        if (userId) {
          entries = entries.filter(r => r.userId === userId);
        }
        if (!includeCompleted) {
          entries = entries.filter(r => !r.fired);
        }

        if (entries.length === 0) return 'No reminders found.';

        entries.sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime());

        return entries.map(r => {
          const status = r.fired ? '[FIRED]' : '[PENDING]';
          const recurStr = r.recurring ? ` (${r.recurring.interval})` : '';
          return `${status} ${r.id}: "${r.message}" at ${r.triggerAt.toISOString()}${recurStr}`;
        }).join('\n');
      },
    },
    {
      name: 'reminder_cancel',
      description: 'Cancel a reminder by ID',
      parameters: {
        type: 'object',
        properties: {
          reminderId: { type: 'string', description: 'Reminder ID to cancel' },
        },
        required: ['reminderId'],
      },
      async handler(args) {
        const { reminderId } = args as { reminderId: string };

        const reminder = reminders.get(reminderId);
        if (!reminder) return `Reminder "${reminderId}" not found`;

        const timer = activeTimers.get(reminderId);
        if (timer) {
          clearTimeout(timer);
          activeTimers.delete(reminderId);
        }

        reminders.delete(reminderId);
        return `Reminder "${reminderId}" cancelled: "${reminder.message}"`;
      },
    },
    {
      name: 'reminder_clear_all',
      description: 'Clear all reminders for a user',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User whose reminders to clear' },
        },
      },
      async handler(args) {
        const { userId } = args as { userId?: string };
        let count = 0;

        for (const [id, reminder] of reminders) {
          if (!userId || reminder.userId === userId) {
            const timer = activeTimers.get(id);
            if (timer) clearTimeout(timer);
            activeTimers.delete(id);
            reminders.delete(id);
            count++;
          }
        }

        return `Cleared ${count} reminder(s)${userId ? ` for user "${userId}"` : ''}`;
      },
    },
  ],

  systemPromptAddition: 'You can set, list, and manage reminders with support for recurring schedules using the Reminder skill tools.',

  async init() {
    // Timer system is initialized on first use
  },

  async destroy() {
    // Clear all active timers
    for (const timer of activeTimers.values()) {
      clearTimeout(timer);
    }
    activeTimers.clear();
    reminders.clear();
    reminderIdCounter = 0;
  },
};

export default reminderSkill;
