import type { ChatMessage } from '@hydraclaw/core';
import type { SQLiteStore } from './sqlite.js';

export class SessionStore {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  getOrCreateConversation(channelId: string, senderId: string, target: string): string {
    const db = this.store.getDb();
    const existing = db.prepare(
      'SELECT id FROM conversations WHERE channel_id = ? AND sender_id = ? AND target = ?'
    ).get(channelId, senderId, target) as { id: string } | undefined;

    if (existing) {
      db.prepare('UPDATE conversations SET updated_at = unixepoch() WHERE id = ?').run(existing.id);
      return existing.id;
    }

    const id = `${channelId}:${senderId}:${target}:${Date.now()}`;
    db.prepare(
      'INSERT INTO conversations (id, channel_id, sender_id, target) VALUES (?, ?, ?, ?)'
    ).run(id, channelId, senderId, target);
    return id;
  }

  addMessage(conversationId: string, message: ChatMessage): void {
    const db = this.store.getDb();
    db.prepare(
      'INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id, images, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      conversationId,
      message.role,
      message.content,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolCallId ?? null,
      message.images ? JSON.stringify(message.images) : null,
      message.timestamp ?? Math.floor(Date.now() / 1000),
    );
  }

  getHistory(conversationId: string, limit: number = 100): ChatMessage[] {
    const db = this.store.getDb();
    const rows = db.prepare(
      'SELECT role, content, tool_calls, tool_call_id, images, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT ?'
    ).all(conversationId, limit) as Array<{
      role: string;
      content: string;
      tool_calls: string | null;
      tool_call_id: string | null;
      images: string | null;
      timestamp: number;
    }>;

    return rows.map(row => ({
      role: row.role as ChatMessage['role'],
      content: row.content,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      toolCallId: row.tool_call_id ?? undefined,
      images: row.images ? JSON.parse(row.images) : undefined,
      timestamp: row.timestamp,
    }));
  }

  clearHistory(conversationId: string): void {
    const db = this.store.getDb();
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  }

  deleteConversation(conversationId: string): void {
    const db = this.store.getDb();
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  }

  // Key-value session storage
  setSession(key: string, value: string, ttlSeconds?: number): void {
    const db = this.store.getDb();
    const expiresAt = ttlSeconds ? Math.floor(Date.now() / 1000) + ttlSeconds : null;
    db.prepare(
      'INSERT OR REPLACE INTO sessions (key, value, expires_at) VALUES (?, ?, ?)'
    ).run(key, value, expiresAt);
  }

  getSession(key: string): string | undefined {
    const db = this.store.getDb();
    const row = db.prepare(
      'SELECT value, expires_at FROM sessions WHERE key = ?'
    ).get(key) as { value: string; expires_at: number | null } | undefined;

    if (!row) return undefined;
    if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) {
      db.prepare('DELETE FROM sessions WHERE key = ?').run(key);
      return undefined;
    }
    return row.value;
  }

  deleteSession(key: string): void {
    this.store.getDb().prepare('DELETE FROM sessions WHERE key = ?').run(key);
  }
}
