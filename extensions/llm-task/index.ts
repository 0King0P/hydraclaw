import type { Extension, ExtensionContext } from '@hydraclaw/extensions';

type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

interface LlmTask {
  id: string;
  prompt: string;
  model: string;
  status: TaskStatus;
  priority: number;
  result: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  metadata: Record<string, unknown>;
}

/**
 * LLM Task Extension
 *
 * Background task queue for scheduling and executing asynchronous
 * LLM inference jobs. Supports priority queuing, task lifecycle
 * tracking, cancellation, and result retrieval.
 */
class LlmTaskExtension implements Extension {
  id = 'llm-task';
  name = 'LLM Task';
  description = 'Background LLM task queue for scheduling and executing asynchronous inference jobs';
  version = '1.0.0';
  type = 'provider' as const;

  private tasks = new Map<string, LlmTask>();
  private queue: string[] = [];
  private processing = false;
  private taskCounter = 0;
  private ctx: ExtensionContext | null = null;

  async init(context: ExtensionContext): Promise<void> {
    this.ctx = context;

    context.logger.info('LLM Task extension initializing');

    context.bus.on('llm:submit', async (...args: unknown[]) => {
      const [prompt, model, priority, metadata] = args as [string, string?, number?, Record<string, unknown>?];
      const task = this.submitTask(prompt, model, priority, metadata);
      await context.bus.emit('llm:task:queued', task);
    });

    context.bus.on('llm:cancel', async (...args: unknown[]) => {
      const [taskId] = args as [string];
      this.cancelTask(taskId);
      await context.bus.emit('llm:task:cancelled', taskId);
    });

    context.bus.on('llm:status', async (...args: unknown[]) => {
      const [taskId, callback] = args as [string, (task: LlmTask | null) => void];
      callback(this.tasks.get(taskId) ?? null);
    });

    context.bus.on('llm:result', async (...args: unknown[]) => {
      const [taskId, result] = args as [string, string];
      this.completeTask(taskId, result);
    });

    context.bus.on('llm:fail', async (...args: unknown[]) => {
      const [taskId, error] = args as [string, string];
      this.failTask(taskId, error);
    });

    context.bus.on('llm:queue-info', async (...args: unknown[]) => {
      const [callback] = args as [(info: { size: number; running: number; completed: number }) => void];
      callback(this.getQueueInfo());
    });

    context.logger.info('LLM Task initialized');
  }

  async destroy(): Promise<void> {
    this.tasks.clear();
    this.queue = [];
    this.processing = false;
    this.ctx?.logger.info('LLM Task destroyed');
  }

  submitTask(prompt: string, model?: string, priority?: number, metadata?: Record<string, unknown>): LlmTask {
    const id = `llm_${++this.taskCounter}_${Date.now()}`;
    const task: LlmTask = {
      id,
      prompt,
      model: model ?? 'default',
      status: 'queued',
      priority: priority ?? 0,
      result: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      metadata: metadata ?? {},
    };

    this.tasks.set(id, task);

    // Insert into queue based on priority (higher priority first)
    const insertIndex = this.queue.findIndex(qId => {
      const qTask = this.tasks.get(qId);
      return qTask && qTask.priority < task.priority;
    });

    if (insertIndex === -1) {
      this.queue.push(id);
    } else {
      this.queue.splice(insertIndex, 0, id);
    }

    this.ctx?.logger.info(`LLM task queued: ${id} (model: ${task.model}, priority: ${task.priority})`);
    return task;
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'failed') return false;

    task.status = 'cancelled';
    task.completedAt = Date.now();
    this.queue = this.queue.filter(id => id !== taskId);
    this.ctx?.logger.info(`LLM task cancelled: ${taskId}`);
    return true;
  }

  completeTask(taskId: string, result: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'completed';
    task.result = result;
    task.completedAt = Date.now();
    this.ctx?.logger.info(`LLM task completed: ${taskId}`);
    this.ctx?.bus.emit('llm:task:completed', task).catch(() => {});
  }

  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'failed';
    task.error = error;
    task.completedAt = Date.now();
    this.ctx?.logger.warn(`LLM task failed: ${taskId} - ${error}`);
    this.ctx?.bus.emit('llm:task:failed', task).catch(() => {});
  }

  getNextTask(): LlmTask | null {
    while (this.queue.length > 0) {
      const taskId = this.queue.shift()!;
      const task = this.tasks.get(taskId);
      if (task && task.status === 'queued') {
        task.status = 'running';
        task.startedAt = Date.now();
        return task;
      }
    }
    return null;
  }

  getTask(taskId: string): LlmTask | undefined {
    return this.tasks.get(taskId);
  }

  getQueueInfo(): { size: number; running: number; completed: number } {
    let running = 0;
    let completed = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'running') running++;
      if (task.status === 'completed') completed++;
    }
    return { size: this.queue.length, running, completed };
  }
}

export default new LlmTaskExtension();
