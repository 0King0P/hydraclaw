export interface CronJob {
  id: string;
  name: string;
  schedule: string; // cron expression
  handler: () => Promise<void>;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  maxRuns?: number;
  timezone?: string;
}

export interface CronSchedule {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}
