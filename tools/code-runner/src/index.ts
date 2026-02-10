import { exec } from 'node:child_process';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
    name: 'code_run_python',
    description: 'Execute Python code and return stdout and stderr. Code is written to a temporary file and run with the python3 interpreter.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Python code to execute',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'code_run_node',
    description: 'Execute Node.js/JavaScript code and return stdout and stderr. Code is written to a temporary .mjs file and run with the node interpreter.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript/Node.js code to execute',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'code_run_bash',
    description: 'Execute a bash script and return stdout and stderr. Code is written to a temporary .sh file and run with bash.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Bash script code to execute',
        },
      },
      required: ['code'],
    },
  },
];

interface RunnerConfig {
  interpreter: string;
  extension: string;
}

const RUNNERS: Record<string, RunnerConfig> = {
  code_run_python: { interpreter: 'python3', extension: '.py' },
  code_run_node: { interpreter: 'node', extension: '.mjs' },
  code_run_bash: { interpreter: 'bash', extension: '.sh' },
};

const TIMEOUT_MS = 60000;

export class CodeRunnerTool implements Tool {
  readonly id = 'coderunner';
  readonly name = 'Code Runner';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'coderunner' });
    this.logger.info('Code Runner tool initialized');
  }

  async destroy(): Promise<void> {
    this.logger.info('Code Runner tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const runner = RUNNERS[call.name];
    if (!runner) {
      return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
    }

    try {
      return await this.runCode(call, runner);
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Code runner error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private async runCode(call: ToolCall, runner: RunnerConfig): Promise<ToolResult> {
    const args = call.arguments as { code: string };
    const code = args.code;

    // Create a temp directory for isolation
    const tempDir = await mkdtemp(join(tmpdir(), 'hydraclaw-code-'));
    const filePath = join(tempDir, `script${runner.extension}`);

    this.logger.info(`Running ${runner.interpreter} code (${code.length} chars)`);

    try {
      await writeFile(filePath, code, 'utf-8');

      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
        exec(
          `${runner.interpreter} "${filePath}"`,
          {
            timeout: TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024, // 10MB
            cwd: tempDir,
          },
          (error, stdout, stderr) => {
            let exitCode = 0;
            if (error) {
              exitCode = (error as NodeJS.ErrnoException & { code?: number }).code ?? 1;
              if (typeof exitCode !== 'number') exitCode = 1;
              // Check for timeout
              if (error.killed) {
                stderr += `\nProcess killed: execution exceeded ${TIMEOUT_MS}ms timeout`;
                exitCode = 124;
              }
            }
            resolve({
              stdout: stdout.toString(),
              stderr: stderr.toString(),
              exitCode,
            });
          },
        );
      });

      this.logger.debug(`Code execution finished with exit code ${result.exitCode}`);

      return {
        toolCallId: call.id,
        content: JSON.stringify({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          language: runner.interpreter,
        }, null, 2),
        isError: result.exitCode !== 0,
      };
    } finally {
      // Clean up temp files
      try {
        await unlink(filePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export default CodeRunnerTool;
