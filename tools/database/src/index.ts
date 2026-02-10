import Database from 'better-sqlite3';
import type {
  Tool,
  ToolDefinition,
  ToolCall,
  ToolResult,
  PluginContext,
  Logger,
} from '@hydraclaw/core';

const DEFINITIONS: ToolDefinition[] = [
  {
    name: 'db_query',
    description: 'Execute a SQL SELECT query and return the resulting rows. Supports parameterized queries.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL query to execute (e.g. "SELECT * FROM users WHERE id = ?")',
        },
        params: {
          type: 'array',
          description: 'Optional array of parameters for parameterized queries',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'db_execute',
    description: 'Execute a SQL statement that modifies data (INSERT, UPDATE, DELETE, CREATE, DROP, ALTER). Returns the number of changes made.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL statement to execute',
        },
        params: {
          type: 'array',
          description: 'Optional array of parameters for parameterized queries',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'db_tables',
    description: 'List all tables in the database with their row counts.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'db_schema',
    description: 'Get the schema of a specific table including column names, types, and constraints.',
    parameters: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: 'Name of the table to inspect',
        },
      },
      required: ['table'],
    },
  },
];

export class DatabaseTool implements Tool {
  readonly id = 'database';
  readonly name = 'Database';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;
  private db!: Database.Database;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'database' });

    const config = ctx.config as Record<string, unknown>;
    const dbPath = (config.path as string) ?? ':memory:';
    const readonly = (config.readonly as boolean) ?? false;

    this.db = new Database(dbPath, { readonly });

    // Enable WAL mode for better concurrent performance
    if (!readonly && dbPath !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }

    this.logger.info(`Database tool initialized (path: ${dbPath}, readonly: ${readonly})`);
  }

  async destroy(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
    this.logger.info('Database tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case 'db_query':
          return this.dbQuery(call);
        case 'db_execute':
          return this.dbExecute(call);
        case 'db_tables':
          return this.dbTables(call);
        case 'db_schema':
          return this.dbSchema(call);
        default:
          return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Database error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private dbQuery(call: ToolCall): ToolResult {
    const args = call.arguments as { query: string; params?: unknown[] };

    this.logger.debug(`SQL Query: ${args.query}`);

    const stmt = this.db.prepare(args.query);
    const rows = args.params ? stmt.all(...args.params) : stmt.all();

    return {
      toolCallId: call.id,
      content: JSON.stringify({ rows, rowCount: rows.length }, null, 2),
    };
  }

  private dbExecute(call: ToolCall): ToolResult {
    const args = call.arguments as { query: string; params?: unknown[] };

    this.logger.debug(`SQL Execute: ${args.query}`);

    const stmt = this.db.prepare(args.query);
    const result = args.params ? stmt.run(...args.params) : stmt.run();

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid?.toString(),
      }, null, 2),
    };
  }

  private dbTables(call: ToolCall): ToolResult {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;

    const result = tables.map((t) => {
      const countRow = this.db
        .prepare(`SELECT COUNT(*) as count FROM "${t.name}"`)
        .get() as { count: number };
      return {
        name: t.name,
        rowCount: countRow.count,
      };
    });

    return {
      toolCallId: call.id,
      content: JSON.stringify({ tables: result, total: result.length }, null, 2),
    };
  }

  private dbSchema(call: ToolCall): ToolResult {
    const args = call.arguments as { table: string };

    const columns = this.db.prepare(`PRAGMA table_info("${args.table}")`).all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;

    if (columns.length === 0) {
      return {
        toolCallId: call.id,
        content: `Table "${args.table}" not found or has no columns.`,
        isError: true,
      };
    }

    const indexes = this.db.prepare(`PRAGMA index_list("${args.table}")`).all() as Array<{
      seq: number;
      name: string;
      unique: number;
    }>;

    const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list("${args.table}")`).all();

    // Get the CREATE TABLE statement
    const sqlRow = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
      .get(args.table) as { sql: string } | undefined;

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        table: args.table,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type,
          notNull: c.notnull === 1,
          defaultValue: c.dflt_value,
          primaryKey: c.pk > 0,
        })),
        indexes: indexes.map((i) => ({
          name: i.name,
          unique: i.unique === 1,
        })),
        foreignKeys,
        createStatement: sqlRow?.sql ?? null,
      }, null, 2),
    };
  }
}

export default DatabaseTool;
