import simpleGitModule, { type SimpleGit } from 'simple-git';

const simpleGit: (basePath?: string) => SimpleGit = (simpleGitModule as any).default ?? simpleGitModule;
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
    name: 'git_status',
    description: 'Get the current status of a git repository, including staged, modified, untracked, and conflicted files.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository. Defaults to current working directory.',
        },
      },
    },
  },
  {
    name: 'git_log',
    description: 'Get the commit log of a git repository.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository. Defaults to current working directory.',
        },
        maxCount: {
          type: 'number',
          description: 'Maximum number of commits to return. Defaults to 20.',
        },
      },
    },
  },
  {
    name: 'git_diff',
    description: 'Get the diff of changes in a git repository.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository. Defaults to current working directory.',
        },
        staged: {
          type: 'boolean',
          description: 'If true, show only staged changes. Defaults to false (show unstaged).',
        },
      },
    },
  },
  {
    name: 'git_commit',
    description: 'Stage all changes and create a commit with the given message.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Commit message',
        },
        path: {
          type: 'string',
          description: 'Path to the git repository. Defaults to current working directory.',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'git_push',
    description: 'Push commits to a remote repository.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository. Defaults to current working directory.',
        },
        remote: {
          type: 'string',
          description: 'Remote name. Defaults to "origin".',
        },
        branch: {
          type: 'string',
          description: 'Branch name. Defaults to current branch.',
        },
      },
    },
  },
  {
    name: 'git_pull',
    description: 'Pull changes from a remote repository.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository. Defaults to current working directory.',
        },
      },
    },
  },
  {
    name: 'git_clone',
    description: 'Clone a git repository to a local path.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the repository to clone',
        },
        path: {
          type: 'string',
          description: 'Local path to clone into',
        },
      },
      required: ['url', 'path'],
    },
  },
  {
    name: 'git_branch',
    description: 'List branches, or create/checkout a branch if a name is provided.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository. Defaults to current working directory.',
        },
        name: {
          type: 'string',
          description: 'Branch name to create. If omitted, lists all branches.',
        },
        checkout: {
          type: 'boolean',
          description: 'If true, checkout the branch after creating it (or checkout existing branch). Defaults to false.',
        },
      },
    },
  },
];

export class GitTool implements Tool {
  readonly id = 'git';
  readonly name = 'Git';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;
  private defaultPath!: string;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'git' });

    const config = ctx.config as Record<string, unknown>;
    this.defaultPath = (config.defaultPath as string) ?? process.cwd();

    this.logger.info('Git tool initialized');
  }

  async destroy(): Promise<void> {
    this.logger.info('Git tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  private getGit(path?: string): SimpleGit {
    return simpleGit(path ?? this.defaultPath);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case 'git_status':
          return await this.gitStatus(call);
        case 'git_log':
          return await this.gitLog(call);
        case 'git_diff':
          return await this.gitDiff(call);
        case 'git_commit':
          return await this.gitCommit(call);
        case 'git_push':
          return await this.gitPush(call);
        case 'git_pull':
          return await this.gitPull(call);
        case 'git_clone':
          return await this.gitClone(call);
        case 'git_branch':
          return await this.gitBranch(call);
        default:
          return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Git error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private async gitStatus(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path?: string };
    const git = this.getGit(args.path);

    this.logger.debug(`Getting status for: ${args.path ?? this.defaultPath}`);
    const status = await git.status();

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        staged: status.staged,
        modified: status.modified,
        not_added: status.not_added,
        deleted: status.deleted,
        conflicted: status.conflicted,
        created: status.created,
        renamed: status.renamed,
        isClean: status.isClean(),
      }, null, 2),
    };
  }

  private async gitLog(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path?: string; maxCount?: number };
    const git = this.getGit(args.path);
    const maxCount = args.maxCount ?? 20;

    this.logger.debug(`Getting log (max ${maxCount}) for: ${args.path ?? this.defaultPath}`);
    const log = await git.log({ maxCount });

    const commits = log.all.map((entry) => ({
      hash: entry.hash,
      date: entry.date,
      message: entry.message,
      author_name: entry.author_name,
      author_email: entry.author_email,
    }));

    return {
      toolCallId: call.id,
      content: JSON.stringify({ commits, total: log.total }, null, 2),
    };
  }

  private async gitDiff(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path?: string; staged?: boolean };
    const git = this.getGit(args.path);
    const staged = args.staged ?? false;

    this.logger.debug(`Getting diff (staged: ${staged}) for: ${args.path ?? this.defaultPath}`);

    let diff: string;
    if (staged) {
      diff = await git.diff(['--cached']);
    } else {
      diff = await git.diff();
    }

    // Truncate very large diffs
    const maxLen = 100000;
    if (diff.length > maxLen) {
      diff = diff.substring(0, maxLen) + '\n...[truncated]';
    }

    return {
      toolCallId: call.id,
      content: JSON.stringify({ diff, staged, length: diff.length }, null, 2),
    };
  }

  private async gitCommit(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { message: string; path?: string };
    const git = this.getGit(args.path);

    this.logger.info(`Committing: "${args.message}"`);

    // Stage all changes
    await git.add('-A');
    const result = await git.commit(args.message);

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        commit: result.commit,
        branch: result.branch,
        summary: {
          changes: result.summary.changes,
          insertions: result.summary.insertions,
          deletions: result.summary.deletions,
        },
      }, null, 2),
    };
  }

  private async gitPush(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path?: string; remote?: string; branch?: string };
    const git = this.getGit(args.path);
    const remote = args.remote ?? 'origin';

    this.logger.info(`Pushing to ${remote}${args.branch ? `/${args.branch}` : ''}`);

    const pushArgs = [remote];
    if (args.branch) pushArgs.push(args.branch);

    const result = await git.push(pushArgs);

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        pushed: true,
        remote,
        branch: args.branch ?? 'current',
        update: result.update,
      }, null, 2),
    };
  }

  private async gitPull(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path?: string };
    const git = this.getGit(args.path);

    this.logger.info(`Pulling from remote`);
    const result = await git.pull();

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        files: result.files,
        summary: {
          changes: result.summary.changes,
          insertions: result.summary.insertions,
          deletions: result.summary.deletions,
        },
        created: result.created,
        deleted: result.deleted,
      }, null, 2),
    };
  }

  private async gitClone(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { url: string; path: string };
    const git: SimpleGit = simpleGit();

    this.logger.info(`Cloning ${args.url} to ${args.path}`);
    await git.clone(args.url, args.path);

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        cloned: true,
        url: args.url,
        path: args.path,
      }, null, 2),
    };
  }

  private async gitBranch(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { path?: string; name?: string; checkout?: boolean };
    const git = this.getGit(args.path);

    if (args.name) {
      const checkout = args.checkout ?? false;

      if (checkout) {
        this.logger.info(`Creating and checking out branch: ${args.name}`);
        await git.checkoutLocalBranch(args.name);
      } else {
        this.logger.info(`Creating branch: ${args.name}`);
        await git.branch([args.name]);
      }

      return {
        toolCallId: call.id,
        content: JSON.stringify({
          branch: args.name,
          created: true,
          checkedOut: checkout,
        }, null, 2),
      };
    }

    // List branches
    this.logger.debug('Listing branches');
    const branches = await git.branch();

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        current: branches.current,
        all: branches.all,
        branches: Object.fromEntries(
          Object.entries(branches.branches).map(([key, val]) => [
            key,
            { current: val.current, name: val.name, commit: val.commit, label: val.label },
          ]),
        ),
      }, null, 2),
    };
  }
}

export default GitTool;
