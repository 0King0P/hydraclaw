import { randomUUID } from 'node:crypto';
import { createLogger } from '@hydraclaw/core';
import type { CronJob } from './types.js';
import { parseCronExpression, getNextOccurrence, isMatch } from './parser.js';

const logger = createLogger({ name: 'cron:scheduler' });

const DEFAULT_CHECK_INTERVAL_MS = 1_000; // Check every second

export interface CronJobDefinition {
  id?: string;
  name: string;
  schedule: string;
  handler: () => Promise<void>;
  enabled?: boolean;
  maxRuns?: number;
  timezone?: string;
}

export interface CronSchedulerConfig {
  checkInterval?: number;
  autoStart?: boolean;
}

export class CronScheduler {
  private jobs = new Map<string, CronJob>();
  private running = false;
  private checkInterval: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private executingJobs = new Set<string>();

  constructor(config: CronSchedulerConfig = {}) {
    this.checkInterval = config.checkInterval ?? DEFAULT_CHECK_INTERVAL_MS;

    if (config.autoStart) {
      this.start();
    }

    logger.debug('CronScheduler initialized', { checkInterval: this.checkInterval });
  }

  /**
   * Register a new cron job.
   */
  addJob(definition: CronJobDefinition): CronJob {
    const id = definition.id ?? randomUUID();

    // Validate the cron expression
    parseCronExpression(definition.schedule);

    if (this.jobs.has(id)) {
      throw new Error(`Job with id "${id}" already exists`);
    }

    const schedule = parseCronExpression(definition.schedule);
    const nextRun = getNextOccurrence(schedule).getTime();

    const job: CronJob = {
      id,
      name: definition.name,
      schedule: definition.schedule,
      handler: definition.handler,
      enabled: definition.enabled ?? true,
      runCount: 0,
      maxRuns: definition.maxRuns,
      timezone: definition.timezone,
      nextRun,
    };

    this.jobs.set(id, job);

    logger.info('Cron job added', {
      id,
      name: job.name,
      schedule: job.schedule,
      nextRun: new Date(nextRun).toISOString(),
    });

    return { ...job };
  }

  /**
   * Remove a cron job by ID.
   */
  removeJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) {
      logger.warn('Cannot remove job: not found', { id });
      return false;
    }

    this.jobs.delete(id);

    logger.info('Cron job removed', { id, name: job.name });
    return true;
  }

  /**
   * Enable a previously disabled job.
   */
  enableJob(id: string): void {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`Job "${id}" not found`);
    }

    job.enabled = true;

    // Recalculate next run
    const schedule = parseCronExpression(job.schedule);
    job.nextRun = getNextOccurrence(schedule).getTime();

    logger.debug('Job enabled', { id, name: job.name });
  }

  /**
   * Disable a job, preventing it from executing.
   */
  disableJob(id: string): void {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`Job "${id}" not found`);
    }

    job.enabled = false;

    logger.debug('Job disabled', { id, name: job.name });
  }

  /**
   * Start the scheduler. Begins checking for jobs to execute.
   */
  start(): void {
    if (this.running) {
      logger.warn('Scheduler is already running');
      return;
    }

    this.running = true;

    this.timer = setInterval(() => {
      this.tick();
    }, this.checkInterval);

    logger.info('Cron scheduler started', {
      jobCount: this.jobs.size,
      checkInterval: this.checkInterval,
    });
  }

  /**
   * Stop the scheduler. Running jobs will complete, but no new jobs will be started.
   */
  stop(): void {
    if (!this.running) {
      logger.warn('Scheduler is not running');
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.running = false;

    logger.info('Cron scheduler stopped', {
      executingJobs: this.executingJobs.size,
    });
  }

  /**
   * Get all registered jobs.
   */
  getJobs(): CronJob[] {
    return [...this.jobs.values()].map((job) => ({ ...job }));
  }

  /**
   * Get a specific job by ID.
   */
  getJob(id: string): CronJob | undefined {
    const job = this.jobs.get(id);
    return job ? { ...job } : undefined;
  }

  /**
   * Manually trigger a job to run immediately, regardless of its schedule.
   */
  async runNow(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`Job "${id}" not found`);
    }

    logger.info('Manually triggering job', { id, name: job.name });

    await this.executeJob(job);
  }

  /**
   * Get the next scheduled run time for a job.
   */
  getNextRun(id: string): Date | null {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`Job "${id}" not found`);
    }

    if (!job.enabled) {
      return null;
    }

    if (job.nextRun) {
      return new Date(job.nextRun);
    }

    const schedule = parseCronExpression(job.schedule);
    return getNextOccurrence(schedule);
  }

  /**
   * Check if the scheduler is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the number of currently executing jobs.
   */
  getExecutingCount(): number {
    return this.executingJobs.size;
  }

  /**
   * Clean up resources and stop the scheduler.
   */
  destroy(): void {
    this.stop();
    this.jobs.clear();
    this.executingJobs.clear();

    logger.debug('CronScheduler destroyed');
  }

  /**
   * Internal tick - checks all jobs and executes those that are due.
   */
  private tick(): void {
    const now = new Date();

    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;

      // Skip if already executing (prevent overlapping runs)
      if (this.executingJobs.has(job.id)) continue;

      // Skip if max runs reached
      if (job.maxRuns !== undefined && job.runCount >= job.maxRuns) {
        job.enabled = false;
        logger.debug('Job reached max runs, disabling', {
          id: job.id,
          name: job.name,
          runCount: job.runCount,
          maxRuns: job.maxRuns,
        });
        continue;
      }

      // Check if this job should run now
      const schedule = parseCronExpression(job.schedule);
      if (isMatch(schedule, now)) {
        // Only trigger once per matching minute
        const currentMinuteStart = new Date(now);
        currentMinuteStart.setSeconds(0, 0);
        const currentMinuteTs = currentMinuteStart.getTime();

        if (job.lastRun && job.lastRun >= currentMinuteTs) {
          continue; // Already ran in this minute
        }

        this.executeJob(job).catch((err) => {
          logger.error('Unhandled error executing job', {
            id: job.id,
            name: job.name,
            error: err,
          });
        });
      }
    }
  }

  /**
   * Execute a single job.
   */
  private async executeJob(job: CronJob): Promise<void> {
    this.executingJobs.add(job.id);
    const startTime = Date.now();

    logger.debug('Executing job', { id: job.id, name: job.name, runCount: job.runCount });

    try {
      await job.handler();

      job.lastRun = startTime;
      job.runCount++;

      // Calculate next run time
      const schedule = parseCronExpression(job.schedule);
      job.nextRun = getNextOccurrence(schedule, new Date(startTime)).getTime();

      const duration = Date.now() - startTime;

      logger.debug('Job completed', {
        id: job.id,
        name: job.name,
        duration,
        runCount: job.runCount,
        nextRun: new Date(job.nextRun).toISOString(),
      });
    } catch (err) {
      const duration = Date.now() - startTime;

      logger.error('Job failed', {
        id: job.id,
        name: job.name,
        duration,
        error: err instanceof Error ? err.message : String(err),
      });

      // Still update lastRun and nextRun even on failure
      job.lastRun = startTime;
      const schedule = parseCronExpression(job.schedule);
      job.nextRun = getNextOccurrence(schedule, new Date(startTime)).getTime();
    } finally {
      this.executingJobs.delete(job.id);
    }
  }
}
