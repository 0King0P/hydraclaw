import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from '@hydraclaw/core';

export class SQLiteStore {
  private db: Database.Database;
  private logger: Logger;

  constructor(dbPath: string, logger: Logger) {
    this.logger = logger;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        target TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        images TEXT,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_sender ON conversations(sender_id);
    `);
    this.logger.debug('SQLite tables initialized');
  }

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
