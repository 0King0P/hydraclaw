import {
  readFile,
  writeFile,
  readdir,
  rm,
  mkdir,
  cp,
  rename,
  stat,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
    name: 'fs_read',
    description: 'Read the contents of a file. Returns the file content as a string.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative path to the file to read',
        },
        encoding: {
          type: 'string',
          description: 'File encoding. Defaults to utf-8. Use "base64" for binary files.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'fs_write',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. Parent directories are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative path to the file to write',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'fs_list',
    description: 'List the contents of a directory. Returns file names, sizes, and types.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the directory to list',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list recursively. Defaults to false.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'fs_delete',
    description: 'Delete a file or directory.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file or directory to delete',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to delete directories recursively. Defaults to false.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'fs_search',
    description: 'Search file contents in a directory using a regex pattern. Returns matching lines with file paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to search in',
        },
        pattern: {
          type: 'string',
          description: 'Regular expression pattern to search for',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to search recursively. Defaults to true.',
        },
      },
      required: ['path', 'pattern'],
    },
  },
  {
    name: 'fs_mkdir',
    description: 'Create a directory. Creates parent directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the directory to create',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'fs_copy',
    description: 'Copy a file or directory to a new location.',
    parameters: {
      type: 'object',
      properties: {
        src: {
          type: 'string',
          description: 'Source path',
        },
        dest: {
          type: 'string',
          description: 'Destination path',
        },
      },
      required: ['src', 'dest'],
    },
  },
  {
    name: 'fs_move',
    description: 'Move or rename a file or directory.',
    parameters: {
      type: 'object',
      properties: {
        src: {
          type: 'string',
          description: 'Source path',
        },
        dest: {
          type: 'string',
          description: 'Destination path',
        },
      },
      required: ['src', 'dest'],
    },
  },
  {
    name: 'fs_stat',
    description: 'Get file or directory information including size, type, permissions, and timestamps.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file or directory',
        },
      },
      required: ['path'],
    },
  },
];

export class FilesystemTool implements Tool {
  readonly id = 'filesystem';
  readonly name = 'Filesystem';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'filesystem' });
    this.logger.info('Filesystem tool initialized');
  }

  async destroy(): Promise<void> {
    this.logger.info('Filesystem tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case 'fs_read':
          return await this.fsRead(call);
        case 'fs_write':
          return await this.fsWrite(call);
        case 'fs_list':
          return await this.fsList(call);
        case 'fs_delete':
          return await this.fsDelete(call);
        case 'fs_search':
          return await this.fsSearch(call);
        case 'fs_mkdir':
          return await this.fsMkdir(call);
        case 'fs_copy':
          return await this.fsCopy(call);
        case 'fs_move':
          return await this.fsMove(call);
        case 'fs_stat':
          return await this.fsStat(call);
        default:
          return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Filesystem error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private async fsRead(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path: string; encoding?: string };
    const filePath = resolve(args.path);
    const encoding = (args.encoding ?? 'utf-8') as BufferEncoding;

    this.logger.debug(`Reading file: ${filePath}`);
    const content = await readFile(filePath, { encoding });

    return { toolCallId: call.id, content };
  }

  private async fsWrite(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path: string; content: string };
    const filePath = resolve(args.path);

    this.logger.debug(`Writing file: ${filePath}`);

    // Ensure parent directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    if (dir) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(filePath, args.content, 'utf-8');
    return { toolCallId: call.id, content: `File written: ${filePath} (${args.content.length} bytes)` };
  }

  private async fsList(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path: string; recursive?: boolean };
    const dirPath = resolve(args.path);
    const recursive = args.recursive ?? false;

    this.logger.debug(`Listing directory: ${dirPath} (recursive: ${recursive})`);

    const entries = await readdir(dirPath, { withFileTypes: true, recursive });
    const result = [];

    for (const entry of entries) {
      const entryPath = join(entry.parentPath ?? dirPath, entry.name);
      try {
        const stats = await stat(entryPath);
        result.push({
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
          size: stats.size,
        });
      } catch {
        result.push({
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: 0,
        });
      }
    }

    return { toolCallId: call.id, content: JSON.stringify(result, null, 2) };
  }

  private async fsDelete(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path: string; recursive?: boolean };
    const targetPath = resolve(args.path);
    const recursive = args.recursive ?? false;

    this.logger.debug(`Deleting: ${targetPath} (recursive: ${recursive})`);
    await rm(targetPath, { recursive, force: true });

    return { toolCallId: call.id, content: `Deleted: ${targetPath}` };
  }

  private async fsSearch(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path: string; pattern: string; recursive?: boolean };
    const dirPath = resolve(args.path);
    const recursive = args.recursive ?? true;
    const regex = new RegExp(args.pattern);

    this.logger.debug(`Searching in ${dirPath} for pattern: ${args.pattern}`);

    const matches: Array<{ file: string; line: number; content: string }> = [];
    const maxMatches = 500;

    const entries = await readdir(dirPath, { withFileTypes: true, recursive });

    for (const entry of entries) {
      if (matches.length >= maxMatches) break;
      if (entry.isDirectory()) continue;

      const entryPath = join(entry.parentPath ?? dirPath, entry.name);

      try {
        const content = await readFile(entryPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxMatches) break;
          if (regex.test(lines[i])) {
            matches.push({
              file: entryPath,
              line: i + 1,
              content: lines[i].trim(),
            });
          }
        }
      } catch {
        // Skip files that cannot be read (binary, permissions, etc.)
      }
    }

    const truncated = matches.length >= maxMatches;
    return {
      toolCallId: call.id,
      content: JSON.stringify(
        { matches, totalMatches: matches.length, truncated },
        null, 2,
      ),
    };
  }

  private async fsMkdir(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path: string };
    const dirPath = resolve(args.path);

    this.logger.debug(`Creating directory: ${dirPath}`);
    await mkdir(dirPath, { recursive: true });

    return { toolCallId: call.id, content: `Directory created: ${dirPath}` };
  }

  private async fsCopy(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { src: string; dest: string };
    const srcPath = resolve(args.src);
    const destPath = resolve(args.dest);

    this.logger.debug(`Copying: ${srcPath} -> ${destPath}`);
    await cp(srcPath, destPath, { recursive: true });

    return { toolCallId: call.id, content: `Copied: ${srcPath} -> ${destPath}` };
  }

  private async fsMove(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { src: string; dest: string };
    const srcPath = resolve(args.src);
    const destPath = resolve(args.dest);

    this.logger.debug(`Moving: ${srcPath} -> ${destPath}`);
    await rename(srcPath, destPath);

    return { toolCallId: call.id, content: `Moved: ${srcPath} -> ${destPath}` };
  }

  private async fsStat(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path: string };
    const targetPath = resolve(args.path);

    this.logger.debug(`Getting stats: ${targetPath}`);
    const stats = await stat(targetPath);

    const info = {
      path: targetPath,
      type: stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : 'file',
      size: stats.size,
      mode: stats.mode.toString(8),
      uid: stats.uid,
      gid: stats.gid,
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
      accessed: stats.atime.toISOString(),
    };

    return { toolCallId: call.id, content: JSON.stringify(info, null, 2) };
  }
}

export default FilesystemTool;
