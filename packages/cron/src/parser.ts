import type { CronSchedule } from './types.js';

/**
 * Named schedule aliases mapping to their cron expression equivalents.
 */
const ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

/**
 * Day-of-week name mappings.
 */
const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/**
 * Month name mappings.
 */
const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a cron expression string into a CronSchedule object.
 * Supports standard 5-field cron syntax and @aliases.
 *
 * Field order: minute hour dayOfMonth month dayOfWeek
 *
 * Supported syntax:
 * - `*` (any value)
 * - `5` (specific value)
 * - `1-5` (range)
 * - `*​/15` (step values)
 * - `1,3,5` (list)
 * - `1-5/2` (range with step)
 * - `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`
 */
export function parseCronExpression(expr: string): CronSchedule {
  const trimmed = expr.trim().toLowerCase();

  // Check for aliases
  if (trimmed.startsWith('@')) {
    const aliasExpr = ALIASES[trimmed];
    if (!aliasExpr) {
      throw new Error(`Unknown cron alias: "${trimmed}"`);
    }
    return parseCronExpression(aliasExpr);
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expr}": expected 5 fields (minute hour dayOfMonth month dayOfWeek), got ${parts.length}`
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Validate each field
  validateField(minute, 0, 59, 'minute');
  validateField(hour, 0, 23, 'hour');
  validateField(dayOfMonth, 1, 31, 'dayOfMonth');
  validateField(replaceNames(month, MONTH_NAMES), 1, 12, 'month');
  validateField(replaceNames(dayOfWeek, DAY_NAMES), 0, 7, 'dayOfWeek');

  return {
    minute,
    hour,
    dayOfMonth,
    month: replaceNames(month, MONTH_NAMES),
    dayOfWeek: replaceNames(dayOfWeek, DAY_NAMES),
  };
}

/**
 * Calculate the next occurrence of a cron schedule after the given date.
 */
export function getNextOccurrence(schedule: CronSchedule, from?: Date): Date {
  const start = from ? new Date(from.getTime()) : new Date();
  // Start from the next minute
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  // Search up to 2 years ahead to find a match
  const maxIterations = 366 * 24 * 60 * 2;
  const candidate = new Date(start.getTime());

  for (let i = 0; i < maxIterations; i++) {
    if (isMatch(schedule, candidate)) {
      return candidate;
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error('Could not find next occurrence within 2 years');
}

/**
 * Check if a given date matches a cron schedule.
 */
export function isMatch(schedule: CronSchedule, date: Date): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // JavaScript months are 0-based
  const dayOfWeek = date.getDay(); // 0 = Sunday

  return (
    matchesField(schedule.minute, minute, 0, 59) &&
    matchesField(schedule.hour, hour, 0, 23) &&
    matchesField(schedule.dayOfMonth, dayOfMonth, 1, 31) &&
    matchesField(schedule.month, month, 1, 12) &&
    matchesDayOfWeek(schedule.dayOfWeek, dayOfWeek)
  );
}

/**
 * Get a human-readable description of a cron expression.
 */
export function describeCronExpression(expr: string): string {
  const trimmed = expr.trim().toLowerCase();

  // Handle aliases
  if (trimmed === '@yearly' || trimmed === '@annually') return 'Once a year (January 1st at midnight)';
  if (trimmed === '@monthly') return 'Once a month (1st at midnight)';
  if (trimmed === '@weekly') return 'Once a week (Sunday at midnight)';
  if (trimmed === '@daily' || trimmed === '@midnight') return 'Once a day (at midnight)';
  if (trimmed === '@hourly') return 'Once an hour (at minute 0)';

  const schedule = parseCronExpression(expr);
  const parts: string[] = [];

  if (schedule.minute === '*') {
    parts.push('every minute');
  } else if (schedule.minute.includes('/')) {
    parts.push(`every ${schedule.minute.split('/')[1]} minutes`);
  } else {
    parts.push(`at minute ${schedule.minute}`);
  }

  if (schedule.hour !== '*') {
    if (schedule.hour.includes('/')) {
      parts.push(`every ${schedule.hour.split('/')[1]} hours`);
    } else {
      parts.push(`at hour ${schedule.hour}`);
    }
  }

  if (schedule.dayOfMonth !== '*') {
    parts.push(`on day ${schedule.dayOfMonth} of the month`);
  }

  if (schedule.month !== '*') {
    parts.push(`in month ${schedule.month}`);
  }

  if (schedule.dayOfWeek !== '*') {
    parts.push(`on day-of-week ${schedule.dayOfWeek}`);
  }

  return parts.join(', ');
}

/**
 * Replace named values (jan, feb, mon, tue, etc.) with their numeric equivalents.
 */
function replaceNames(field: string, names: Record<string, number>): string {
  let result = field;
  for (const [name, value] of Object.entries(names)) {
    result = result.replace(new RegExp(name, 'gi'), String(value));
  }
  return result;
}

/**
 * Validate a cron field expression.
 */
function validateField(field: string, min: number, max: number, name: string): void {
  if (field === '*') return;

  // Handle lists (e.g., "1,3,5")
  const items = field.split(',');

  for (const item of items) {
    // Handle step values (e.g., "*/5" or "1-10/2")
    const stepParts = item.split('/');
    if (stepParts.length > 2) {
      throw new Error(`Invalid step in ${name}: "${item}"`);
    }

    const step = stepParts.length === 2 ? parseInt(stepParts[1], 10) : null;
    if (step !== null && (isNaN(step) || step < 1)) {
      throw new Error(`Invalid step value in ${name}: "${stepParts[1]}"`);
    }

    const rangePart = stepParts[0];

    if (rangePart === '*') continue;

    // Handle ranges (e.g., "1-5")
    const rangeBounds = rangePart.split('-');
    if (rangeBounds.length > 2) {
      throw new Error(`Invalid range in ${name}: "${rangePart}"`);
    }

    for (const bound of rangeBounds) {
      const num = parseInt(bound, 10);
      if (isNaN(num) || num < min || num > max) {
        throw new Error(`Invalid value in ${name}: "${bound}" (must be ${min}-${max})`);
      }
    }

    if (rangeBounds.length === 2) {
      const start = parseInt(rangeBounds[0], 10);
      const end = parseInt(rangeBounds[1], 10);
      if (start > end) {
        throw new Error(`Invalid range in ${name}: start (${start}) > end (${end})`);
      }
    }
  }
}

/**
 * Check if a value matches a cron field expression.
 */
function matchesField(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;

  const items = field.split(',');

  for (const item of items) {
    if (matchesSingleItem(item, value, min, max)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a value matches a single cron field item (may include range and/or step).
 */
function matchesSingleItem(item: string, value: number, min: number, max: number): boolean {
  const stepParts = item.split('/');
  const step = stepParts.length === 2 ? parseInt(stepParts[1], 10) : null;
  const rangePart = stepParts[0];

  let rangeStart: number;
  let rangeEnd: number;

  if (rangePart === '*') {
    rangeStart = min;
    rangeEnd = max;
  } else if (rangePart.includes('-')) {
    const [s, e] = rangePart.split('-');
    rangeStart = parseInt(s, 10);
    rangeEnd = parseInt(e, 10);
  } else {
    const num = parseInt(rangePart, 10);
    if (step !== null) {
      rangeStart = num;
      rangeEnd = max;
    } else {
      return value === num;
    }
  }

  if (value < rangeStart || value > rangeEnd) {
    return false;
  }

  if (step !== null) {
    return (value - rangeStart) % step === 0;
  }

  return true;
}

/**
 * Day-of-week matching with special handling for 7 = Sunday (same as 0).
 */
function matchesDayOfWeek(field: string, dayOfWeek: number): boolean {
  if (field === '*') return true;

  // Normalize: 7 is treated as 0 (Sunday)
  const normalizedField = field.replace(/7/g, '0');

  return matchesField(normalizedField, dayOfWeek, 0, 6);
}
