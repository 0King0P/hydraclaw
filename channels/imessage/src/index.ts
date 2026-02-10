import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import type {
  Channel,
  ChannelCapabilities,
  InboundMessage,
  OutboundMessage,
  PluginContext,
  Logger,
  MessageBus,
} from '@hydraclaw/core';
import { Events } from '@hydraclaw/core';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

interface ChatDbRow {
  rowid: number;
  guid: string;
  text: string;
  handle_id: string;
  service: string;
  date: number;
  is_from_me: number;
  cache_roomnames: string | null;
  display_name: string | null;
}

export class IMessageChannel implements Channel {
  readonly id = 'imessage';
  readonly name = 'iMessage';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: false,
    video: false,
    files: false,
    reactions: false,
    threads: false,
    editing: false,
    groups: false,
    streaming: false,
  };

  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastRowId = 0;
  private dbPath!: string;
  private isRunning = false;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'imessage' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    // Check if running on macOS
    if (process.platform !== 'darwin') {
      throw new Error('iMessage channel is only supported on macOS');
    }

    // Determine chat.db path
    this.dbPath = (this.config.dbPath as string) ??
      path.join(process.env.HOME ?? '/Users', 'Library', 'Messages', 'chat.db');

    // Verify the database exists
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(
        `Messages database not found at ${this.dbPath}. ` +
        'Ensure Full Disk Access is granted to the terminal/application.',
      );
    }

    this.logger.info('iMessage channel initialized');
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.logger.info('Starting iMessage channel...');

    // Get the current latest ROWID so we only process new messages
    try {
      const result = await this.queryDb('SELECT MAX(ROWID) as max_rowid FROM message;');
      if (result.length > 0 && result[0].max_rowid) {
        this.lastRowId = result[0].max_rowid;
      }
    } catch (err) {
      this.logger.warn(`Could not get initial ROWID: ${err}`);
    }

    // Start polling for new messages
    const pollMs = (this.config.pollInterval as number) ?? 2000;
    this.pollInterval = setInterval(() => {
      this.pollNewMessages().catch((err) => {
        this.logger.error(`Error polling iMessage: ${err}`);
      });
    }, pollMs);

    this.logger.info(`iMessage channel started (polling every ${pollMs}ms)`);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.logger.info('iMessage channel stopped');
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error('iMessage sending is only supported on macOS');
    }

    // Send text via AppleScript
    if (message.content) {
      const script = `
        tell application "Messages"
          set targetService to 1st account whose service type = iMessage
          set targetBuddy to participant "${this.escapeAppleScript(target)}" of targetService
          send "${this.escapeAppleScript(message.content)}" to targetBuddy
        end tell
      `;

      try {
        await execFileAsync('osascript', ['-e', script]);
        this.logger.debug(`iMessage sent to ${target}`);
      } catch (err) {
        this.logger.error(`Failed to send iMessage: ${err}`);
        throw err;
      }
    }

    // Send images via AppleScript
    if (message.images && message.images.length > 0) {
      for (const image of message.images) {
        const tmpPath = path.join('/tmp', `imsg-img-${randomUUID()}.${image.mimeType.split('/')[1] ?? 'png'}`);
        fs.writeFileSync(tmpPath, image.data);

        const script = `
          tell application "Messages"
            set targetService to 1st account whose service type = iMessage
            set targetBuddy to participant "${this.escapeAppleScript(target)}" of targetService
            send POSIX file "${tmpPath}" to targetBuddy
          end tell
        `;

        try {
          await execFileAsync('osascript', ['-e', script]);
        } catch (err) {
          this.logger.error(`Failed to send iMessage image: ${err}`);
        } finally {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            // ignore cleanup errors
          }
        }
      }
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private async pollNewMessages(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const query = `
        SELECT
          m.ROWID as rowid,
          m.guid,
          m.text,
          h.id as handle_id,
          m.service,
          m.date as date,
          m.is_from_me,
          c.room_name as cache_roomnames,
          c.display_name
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.ROWID > ${this.lastRowId}
          AND m.is_from_me = 0
        ORDER BY m.ROWID ASC
        LIMIT 50;
      `;

      const rows = await this.queryDb(query);

      for (const row of rows) {
        try {
          this.lastRowId = Math.max(this.lastRowId, row.rowid);

          if (!row.text) continue;

          const isGroup = !!row.cache_roomnames;
          const senderId = row.handle_id ?? 'unknown';

          // Convert Apple's Core Data timestamp (seconds since 2001-01-01) to Unix timestamp
          const appleEpochOffset = 978307200;
          const timestamp = row.date
            ? (Math.floor(row.date / 1_000_000_000) + appleEpochOffset) * 1000
            : Date.now();

          const inbound: InboundMessage = {
            id: randomUUID(),
            channelId: 'imessage',
            channelMessageId: row.guid,
            senderId,
            senderName: senderId,
            target: isGroup ? row.cache_roomnames! : senderId,
            content: row.text,
            isGroup,
            groupId: isGroup ? row.cache_roomnames! : undefined,
            groupName: isGroup ? (row.display_name ?? row.cache_roomnames ?? undefined) : undefined,
            timestamp,
            raw: row,
          };

          await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
        } catch (err) {
          this.logger.error(`Error processing iMessage row: ${err}`);
        }
      }
    } catch (err) {
      this.logger.error(`Error querying iMessage database: ${err}`);
    }
  }

  private async queryDb(sql: string): Promise<any[]> {
    try {
      const { stdout } = await execAsync(
        `sqlite3 -json "${this.dbPath}" "${sql.replace(/"/g, '\\"')}"`,
      );
      const trimmed = stdout.trim();
      if (!trimmed) return [];
      return JSON.parse(trimmed);
    } catch (err: any) {
      if (err.stdout?.trim()) {
        try {
          return JSON.parse(err.stdout.trim());
        } catch {
          // not valid JSON
        }
      }
      throw err;
    }
  }

  private escapeAppleScript(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}

export default IMessageChannel;
