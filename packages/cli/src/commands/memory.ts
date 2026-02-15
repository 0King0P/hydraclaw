import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'node:path';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import {
  loadConfig,
  createLogger,
  Container,
  MessageBus,
} from '@hydraclaw/core';
import type { Logger } from '@hydraclaw/core';
import { SQLiteStore, SessionStore } from '@hydraclaw/store';

/**
 * Create the `hydraclaw memory` command group.
 *
 * Subcommands:
 *   hydraclaw memory search <query>   - Search memories
 *   hydraclaw memory stats            - Memory statistics
 *   hydraclaw memory clear            - Clear all memories
 *   hydraclaw memory export <file>    - Export memories to JSON
 *   hydraclaw memory import <file>    - Import memories from JSON
 */
export function createMemoryCommand(): Command {
  const command = new Command('memory');
  command.description('Manage the HydraClaw memory / knowledge base');

  // ─── search ─────────────────────────────────────────────────────────
  command
    .command('search <query>')
    .description('Search stored memories')
    .option('-c, --config <path>', 'Path to config file')
    .option('-n, --limit <n>', 'Max results to return', '10')
    .option('--type <type>', 'Filter by type (conversation, document, note, fact, preference)')
    .option('--channel <channelId>', 'Filter by channel ID')
    .option('--json', 'Output as JSON')
    .action(async (query: string, opts: {
      config?: string;
      limit: string;
      type?: string;
      channel?: string;
      json?: boolean;
    }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });

      const dbPath = resolve(process.cwd(), config.store.path);
      if (!existsSync(dbPath)) {
        console.error(chalk.red(`Database not found at: ${dbPath}`));
        console.error(chalk.dim('Make sure HydraClaw has been started at least once.'));
        process.exit(1);
      }

      const sqliteStore = new SQLiteStore(dbPath, logger);

      try {
        const { MemoryManager } = await import('@hydraclaw/agent');

        const memoryManager = new MemoryManager(sqliteStore as unknown as Parameters<typeof MemoryManager.prototype.search>[0] extends never ? never : any);

        const limit = parseInt(opts.limit, 10) || 10;

        console.log(chalk.cyan(`Searching memories for: "${query}"\n`));

        // Use a keyword-based search through the store
        const results = await searchMemoriesFromStore(sqliteStore, query, limit, {
          type: opts.type,
          channelId: opts.channel,
        });

        if (results.length === 0) {
          console.log(chalk.yellow('  No matching memories found.'));
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          console.log(chalk.bold(`  ${i + 1}. [${result.type ?? 'unknown'}]`));
          console.log(`     ${truncate(result.content, 120)}`);
          if (result.channelId) console.log(chalk.dim(`     Channel: ${result.channelId}`));
          if (result.createdAt) console.log(chalk.dim(`     Date: ${new Date(result.createdAt).toLocaleString()}`));
          console.log();
        }

        console.log(chalk.dim(`  ${results.length} result(s)`));
      } catch (err) {
        // If the memory module is not available, do a simple store search
        console.log(chalk.dim('  Memory module not available, performing basic store search...\n'));

        const results = await searchMemoriesFromStore(sqliteStore, query, parseInt(opts.limit, 10) || 10, {
          type: opts.type,
          channelId: opts.channel,
        });

        if (results.length === 0) {
          console.log(chalk.yellow('  No matching memories found.'));
        } else {
          if (opts.json) {
            console.log(JSON.stringify(results, null, 2));
          } else {
            for (let i = 0; i < results.length; i++) {
              const result = results[i];
              console.log(chalk.bold(`  ${i + 1}. [${result.type ?? 'unknown'}]`));
              console.log(`     ${truncate(result.content, 120)}`);
              console.log();
            }
            console.log(chalk.dim(`  ${results.length} result(s)`));
          }
        }
      } finally {
        sqliteStore.close();
      }
    });

  // ─── stats ──────────────────────────────────────────────────────────
  command
    .command('stats')
    .description('Show memory statistics')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (opts: { config?: string }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });

      const dbPath = resolve(process.cwd(), config.store.path);
      if (!existsSync(dbPath)) {
        console.error(chalk.red(`Database not found at: ${dbPath}`));
        process.exit(1);
      }

      const sqliteStore = new SQLiteStore(dbPath, logger);

      try {
        const stats = await getMemoryStats(sqliteStore);

        console.log(chalk.bold.cyan('\nMemory Statistics\n'));
        console.log(`  Total entries:    ${stats.totalEntries}`);
        console.log(`  Database size:    ${formatBytes(stats.dbSizeBytes)}`);
        console.log(`  Database path:    ${dbPath}`);

        if (stats.typeBreakdown && Object.keys(stats.typeBreakdown).length > 0) {
          console.log(chalk.bold('\n  By Type:'));
          for (const [type, count] of Object.entries(stats.typeBreakdown)) {
            console.log(`    ${type.padEnd(16)} ${count}`);
          }
        }

        if (stats.channelBreakdown && Object.keys(stats.channelBreakdown).length > 0) {
          console.log(chalk.bold('\n  By Channel:'));
          for (const [channel, count] of Object.entries(stats.channelBreakdown)) {
            console.log(`    ${channel.padEnd(16)} ${count}`);
          }
        }

        if (stats.oldest) {
          console.log(`\n  Oldest entry:     ${new Date(stats.oldest).toLocaleString()}`);
        }
        if (stats.newest) {
          console.log(`  Newest entry:     ${new Date(stats.newest).toLocaleString()}`);
        }
      } finally {
        sqliteStore.close();
      }
    });

  // ─── clear ──────────────────────────────────────────────────────────
  command
    .command('clear')
    .description('Clear all stored memories')
    .option('-c, --config <path>', 'Path to config file')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (opts: { config?: string; yes?: boolean }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });

      const dbPath = resolve(process.cwd(), config.store.path);
      if (!existsSync(dbPath)) {
        console.log(chalk.yellow('No database found. Nothing to clear.'));
        return;
      }

      if (!opts.yes) {
        // Simple confirmation via stdin
        const confirmed = await confirmAction(
          'This will permanently delete all stored memories. Are you sure? (yes/no): ',
        );
        if (!confirmed) {
          console.log(chalk.dim('Aborted.'));
          return;
        }
      }

      const sqliteStore = new SQLiteStore(dbPath, logger);

      try {
        await clearMemories(sqliteStore);
        console.log(chalk.green('All memories have been cleared.'));
      } finally {
        sqliteStore.close();
      }
    });

  // ─── export ─────────────────────────────────────────────────────────
  command
    .command('export <file>')
    .description('Export all memories to a JSON file')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (file: string, opts: { config?: string }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });

      const dbPath = resolve(process.cwd(), config.store.path);
      if (!existsSync(dbPath)) {
        console.error(chalk.red(`Database not found at: ${dbPath}`));
        process.exit(1);
      }

      const sqliteStore = new SQLiteStore(dbPath, logger);
      const outputPath = resolve(file);

      try {
        const memories = await exportMemories(sqliteStore);

        const exportData = {
          version: 1,
          exportedAt: new Date().toISOString(),
          count: memories.length,
          memories,
        };

        writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
        console.log(chalk.green(`Exported ${memories.length} memories to: ${outputPath}`));
      } finally {
        sqliteStore.close();
      }
    });

  // ─── import ─────────────────────────────────────────────────────────
  command
    .command('import <file>')
    .description('Import memories from a JSON file')
    .option('-c, --config <path>', 'Path to config file')
    .option('--merge', 'Merge with existing memories (default: replace)')
    .action(async (file: string, opts: { config?: string; merge?: boolean }) => {
      const config = loadConfig(opts.config);
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });

      const inputPath = resolve(file);
      if (!existsSync(inputPath)) {
        console.error(chalk.red(`File not found: ${inputPath}`));
        process.exit(1);
      }

      const dbPath = resolve(process.cwd(), config.store.path);
      const sqliteStore = new SQLiteStore(dbPath, logger);

      try {
        const raw = readFileSync(inputPath, 'utf-8');
        const importData = JSON.parse(raw) as {
          version?: number;
          count?: number;
          memories: Array<Record<string, unknown>>;
        };

        if (!importData.memories || !Array.isArray(importData.memories)) {
          console.error(chalk.red('Invalid import file: missing "memories" array.'));
          process.exit(1);
        }

        if (!opts.merge) {
          await clearMemories(sqliteStore);
        }

        let imported = 0;
        for (const memory of importData.memories) {
          try {
            await importMemory(sqliteStore, memory);
            imported++;
          } catch (err) {
            logger.debug(`Skipped invalid memory entry: ${err}`);
          }
        }

        console.log(chalk.green(`Imported ${imported}/${importData.memories.length} memories from: ${inputPath}`));
        if (!opts.merge) {
          console.log(chalk.dim('  Previous memories were replaced.'));
        } else {
          console.log(chalk.dim('  Memories were merged with existing data.'));
        }
      } finally {
        sqliteStore.close();
      }
    });

  return command;
}

// ---------------------------------------------------------------------------
// Store interaction helpers
// ---------------------------------------------------------------------------

interface MemoryEntry {
  content: string;
  type?: string;
  channelId?: string;
  senderId?: string;
  createdAt?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Search memories in the SQLite store using simple text matching.
 */
async function searchMemoriesFromStore(
  store: SQLiteStore,
  query: string,
  limit: number,
  filters?: { type?: string; channelId?: string },
): Promise<MemoryEntry[]> {
  // The SQLiteStore exposes a general-purpose query method or
  // we fall back to searching through known tables.
  try {
    const db = (store as unknown as { db: { prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] } } }).db;
    if (!db?.prepare) return [];

    // Try the memories table first
    const queryLike = `%${query}%`;
    let sql = `SELECT * FROM memories WHERE content LIKE ? `;
    const params: unknown[] = [queryLike];

    if (filters?.type) {
      sql += ` AND type = ?`;
      params.push(filters.type);
    }
    if (filters?.channelId) {
      sql += ` AND channel_id = ?`;
      params.push(filters.channelId);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      content: String(row.content ?? ''),
      type: row.type as string | undefined,
      channelId: row.channel_id as string | undefined,
      senderId: row.sender_id as string | undefined,
      createdAt: row.created_at as number | undefined,
    }));
  } catch {
    // Table may not exist yet
    return [];
  }
}

async function getMemoryStats(store: SQLiteStore): Promise<{
  totalEntries: number;
  dbSizeBytes: number;
  typeBreakdown: Record<string, number>;
  channelBreakdown: Record<string, number>;
  oldest: number | null;
  newest: number | null;
}> {
  const result = {
    totalEntries: 0,
    dbSizeBytes: 0,
    typeBreakdown: {} as Record<string, number>,
    channelBreakdown: {} as Record<string, number>,
    oldest: null as number | null,
    newest: null as number | null,
  };

  try {
    const db = (store as unknown as { db: { prepare: (sql: string) => { get: (...params: unknown[]) => Record<string, unknown> | undefined; all: (...params: unknown[]) => Array<Record<string, unknown>> } } }).db;
    if (!db?.prepare) return result;

    // Total count
    const countRow = db.prepare('SELECT COUNT(*) as count FROM memories').get();
    result.totalEntries = (countRow?.count as number) ?? 0;

    // DB size
    const sizeRow = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get();
    result.dbSizeBytes = (sizeRow?.size as number) ?? 0;

    // Type breakdown
    const typeRows = db.prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type').all();
    for (const row of typeRows) {
      result.typeBreakdown[String(row.type ?? 'unknown')] = row.count as number;
    }

    // Channel breakdown
    const channelRows = db.prepare('SELECT channel_id, COUNT(*) as count FROM memories WHERE channel_id IS NOT NULL GROUP BY channel_id').all();
    for (const row of channelRows) {
      result.channelBreakdown[String(row.channel_id)] = row.count as number;
    }

    // Date range
    const dateRow = db.prepare('SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memories').get();
    if (dateRow) {
      result.oldest = dateRow.oldest as number | null;
      result.newest = dateRow.newest as number | null;
    }
  } catch {
    // Tables may not exist
  }

  return result;
}

async function clearMemories(store: SQLiteStore): Promise<void> {
  try {
    const db = (store as unknown as { db: { exec: (sql: string) => void } }).db;
    if (db?.exec) {
      db.exec('DELETE FROM memories');
    }
  } catch {
    // Table may not exist
  }
}

async function exportMemories(store: SQLiteStore): Promise<Array<Record<string, unknown>>> {
  try {
    const db = (store as unknown as { db: { prepare: (sql: string) => { all: () => Array<Record<string, unknown>> } } }).db;
    if (!db?.prepare) return [];
    return db.prepare('SELECT * FROM memories ORDER BY created_at ASC').all();
  } catch {
    return [];
  }
}

async function importMemory(store: SQLiteStore, memory: Record<string, unknown>): Promise<void> {
  const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...params: unknown[]) => void } } }).db;
  if (!db?.prepare) return;

  const content = memory.content as string;
  if (!content) return;

  db.prepare(
    'INSERT OR REPLACE INTO memories (id, content, type, channel_id, sender_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    memory.id ?? randomId(),
    content,
    memory.type ?? 'note',
    memory.channel_id ?? null,
    memory.sender_id ?? null,
    memory.created_at ?? Date.now(),
    memory.updated_at ?? Date.now(),
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function randomId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function confirmAction(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', (data) => {
      const answer = data.toString().trim().toLowerCase();
      resolve(answer === 'yes' || answer === 'y');
    });
    // If stdin is not a TTY, default to no
    if (!process.stdin.isTTY) {
      resolve(false);
    }
  });
}
