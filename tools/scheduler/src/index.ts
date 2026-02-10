import { exec } from 'node:child_process';
import cron from 'node-cron';
import type {
  Tool,
  ToolDefinition,
  ToolCall,
  ToolResult,
  PluginContext,
  Logger,
} from '@hydraclaw/core';

interface ScheduledTask {
  taskName: string;
  command: string;
  type: 'cron' | 'once';
  cronExpression?: string;
  delayMs?: number;
  cronJob?: cron.ScheduledTask;
  timeout?: ReturnType<typeof setTimeout>;
  createdAt: string;
  lastRun?: string;
  runCount: number;
}

const DEFINITIONS: ToolDefinition[] = [
  {
    name: 'schedule_task',
    description: 'Schedule a recurring task using a cron expression. The command will be executed via the system shell on each trigger.',
    parameters: {
      type: 'object',
      properties: {
        cronExpression: {
          type: 'string',
          description: 'Cron expression (e.g. "*/5 * * * *" for every 5 minutes)',
        },
        taskName: {
          type: 'string',
          description: 'Unique name for this scheduled task',
        },
        command: {
          type: 'string',
          description: 'Shell command to execute on each trigger',
        },
      },
      required: ['cronExpression', 'taskName', 'command'],
    },
  },
  {
    name: 'schedule_once',
    description: 'Schedule a one-time task to execute after a delay in milliseconds.',
    parameters: {
      type: 'object',
      properties: {
        delayMs: {
          type: 'number',
          description: 'Delay in milliseconds before executing the command',
        },
        taskName: {
          type: 'string',
          description: 'Unique name for this scheduled task',
        },
        command: {
          type: 'string',
          description: 'Shell command to execute after the delay',
        },
      },
      required: ['delayMs', 'taskName', 'command'],
    },
  },
  {
    name: 'schedule_list',
    description: 'List all currently scheduled tasks with their details.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'schedule_cancel',
    description: 'Cancel a scheduled task by name.',
    parameters: {
      type: 'object',
      properties: {
        taskName: {
          type: 'string',
          description: 'Name of the task to cancel',
        },
      },
      required: ['taskName'],
    },
  },
];

export class SchedulerTool implements Tool {
  readonly id = 'scheduler';
  readonly name = 'Scheduler';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;
  private tasks: Map<string, ScheduledTask> = new Map();

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'scheduler' });
    this.logger.info('Scheduler tool initialized');
  }

  async destroy(): Promise<void> {
    // Cancel all tasks on shutdown
    for (const [name, task] of this.tasks) {
      if (task.cronJob) {
        task.cronJob.stop();
      }
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      this.logger.debug(`Cancelled task on destroy: ${name}`);
    }
    this.tasks.clear();
    this.logger.info('Scheduler tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case 'schedule_task':
          return this.scheduleTask(call);
        case 'schedule_once':
          return this.scheduleOnce(call);
        case 'schedule_list':
          return this.scheduleList(call);
        case 'schedule_cancel':
          return this.scheduleCancel(call);
        default:
          return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Scheduler error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private executeCommand(command: string, taskName: string): void {
    this.logger.info(`Executing task "${taskName}": ${command}`);
    exec(command, { shell: '/bin/bash', timeout: 60000 }, (error, stdout, stderr) => {
      const task = this.tasks.get(taskName);
      if (task) {
        task.lastRun = new Date().toISOString();
        task.runCount++;
      }
      if (error) {
        this.logger.error(`Task "${taskName}" failed: ${stderr || error.message}`);
      } else {
        this.logger.debug(`Task "${taskName}" output: ${stdout.trim()}`);
      }
    });
  }

  private scheduleTask(call: ToolCall): ToolResult {
    const args = call.arguments as { cronExpression: string; taskName: string; command: string };

    if (this.tasks.has(args.taskName)) {
      return {
        toolCallId: call.id,
        content: `Task "${args.taskName}" already exists. Cancel it first to reschedule.`,
        isError: true,
      };
    }

    if (!cron.validate(args.cronExpression)) {
      return {
        toolCallId: call.id,
        content: `Invalid cron expression: "${args.cronExpression}"`,
        isError: true,
      };
    }

    const cronJob = cron.schedule(args.cronExpression, () => {
      this.executeCommand(args.command, args.taskName);
    });

    const task: ScheduledTask = {
      taskName: args.taskName,
      command: args.command,
      type: 'cron',
      cronExpression: args.cronExpression,
      cronJob,
      createdAt: new Date().toISOString(),
      runCount: 0,
    };

    this.tasks.set(args.taskName, task);
    this.logger.info(`Scheduled recurring task "${args.taskName}" with cron: ${args.cronExpression}`);

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        taskName: args.taskName,
        type: 'cron',
        cronExpression: args.cronExpression,
        command: args.command,
        status: 'scheduled',
      }, null, 2),
    };
  }

  private scheduleOnce(call: ToolCall): ToolResult {
    const args = call.arguments as { delayMs: number; taskName: string; command: string };

    if (this.tasks.has(args.taskName)) {
      return {
        toolCallId: call.id,
        content: `Task "${args.taskName}" already exists. Cancel it first to reschedule.`,
        isError: true,
      };
    }

    const timeout = setTimeout(() => {
      this.executeCommand(args.command, args.taskName);
      this.tasks.delete(args.taskName);
    }, args.delayMs);

    const task: ScheduledTask = {
      taskName: args.taskName,
      command: args.command,
      type: 'once',
      delayMs: args.delayMs,
      timeout,
      createdAt: new Date().toISOString(),
      runCount: 0,
    };

    this.tasks.set(args.taskName, task);
    this.logger.info(`Scheduled one-time task "${args.taskName}" in ${args.delayMs}ms`);

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        taskName: args.taskName,
        type: 'once',
        delayMs: args.delayMs,
        command: args.command,
        status: 'scheduled',
        executesAt: new Date(Date.now() + args.delayMs).toISOString(),
      }, null, 2),
    };
  }

  private scheduleList(call: ToolCall): ToolResult {
    const tasks = Array.from(this.tasks.values()).map((task) => ({
      taskName: task.taskName,
      command: task.command,
      type: task.type,
      cronExpression: task.cronExpression,
      delayMs: task.delayMs,
      createdAt: task.createdAt,
      lastRun: task.lastRun ?? null,
      runCount: task.runCount,
    }));

    return {
      toolCallId: call.id,
      content: JSON.stringify({ tasks, total: tasks.length }, null, 2),
    };
  }

  private scheduleCancel(call: ToolCall): ToolResult {
    const args = call.arguments as { taskName: string };

    const task = this.tasks.get(args.taskName);
    if (!task) {
      return {
        toolCallId: call.id,
        content: `Task "${args.taskName}" not found.`,
        isError: true,
      };
    }

    if (task.cronJob) {
      task.cronJob.stop();
    }
    if (task.timeout) {
      clearTimeout(task.timeout);
    }
    this.tasks.delete(args.taskName);

    this.logger.info(`Cancelled task: ${args.taskName}`);

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        taskName: args.taskName,
        status: 'cancelled',
        ranTimes: task.runCount,
      }, null, 2),
    };
  }
}

export default SchedulerTool;
