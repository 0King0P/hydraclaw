import { exec, spawn } from 'node:child_process';
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
    name: 'shell_exec',
    description: 'Execute a shell command and return stdout, stderr, and exit code. Supports optional working directory and timeout.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command. Defaults to current working directory.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds. Defaults to 60000 (60 seconds).',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'shell_exec_background',
    description: 'Run a shell command in the background. Returns immediately with the PID. The process will continue running independently.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to run in the background',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command. Defaults to current working directory.',
        },
      },
      required: ['command'],
    },
  },
];

export class ShellTool implements Tool {
  readonly id = 'shell';
  readonly name = 'Shell';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'shell' });
    this.logger.info('Shell tool initialized');
  }

  async destroy(): Promise<void> {
    this.logger.info('Shell tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    switch (call.name) {
      case 'shell_exec':
        return this.shellExec(call);
      case 'shell_exec_background':
        return this.shellExecBackground(call);
      default:
        return {
          toolCallId: call.id,
          content: `Unknown tool: ${call.name}`,
          isError: true,
        };
    }
  }

  private async shellExec(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { command: string; cwd?: string; timeout?: number };
    const timeout = args.timeout ?? 60000;
    const cwd = args.cwd ?? process.cwd();

    this.logger.info(`Executing: ${args.command} (cwd: ${cwd}, timeout: ${timeout}ms)`);

    return new Promise<ToolResult>((resolve) => {
      exec(
        args.command,
        {
          cwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          shell: '/bin/bash',
        },
        (error, stdout, stderr) => {
          const exitCode = error ? (error as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0;
          const result = {
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: typeof exitCode === 'number' ? exitCode : 1,
          };

          this.logger.debug(`Command exited with code ${result.exitCode}`);

          resolve({
            toolCallId: call.id,
            content: JSON.stringify(result, null, 2),
            isError: result.exitCode !== 0,
          });
        },
      );
    });
  }

  private async shellExecBackground(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { command: string; cwd?: string };
    const cwd = args.cwd ?? process.cwd();

    this.logger.info(`Running in background: ${args.command} (cwd: ${cwd})`);

    try {
      const child = spawn(args.command, {
        cwd,
        shell: '/bin/bash',
        detached: true,
        stdio: 'ignore',
      });

      child.unref();

      const pid = child.pid;
      this.logger.info(`Background process started with PID: ${pid}`);

      return {
        toolCallId: call.id,
        content: JSON.stringify({ pid, command: args.command, status: 'running' }, null, 2),
      };
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Failed to start background process: ${err}`,
        isError: true,
      };
    }
  }
}

export default ShellTool;
