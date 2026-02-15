/**
 * Template engine for auto-reply responses.
 *
 * Supports {{variable}} placeholders with a set of built-in variables
 * and the ability to pass custom ones.
 */

export interface TemplateVars {
  sender?: string;
  channel?: string;
  time?: string;
  date?: string;
  message?: string;
  [key: string]: string | undefined;
}

/**
 * Render a template string by replacing all `{{var}}` placeholders
 * with their corresponding values from `vars`.
 *
 * Built-in variables (auto-populated if not explicitly provided):
 * - `{{sender}}` - The sender name or ID
 * - `{{channel}}` - The channel name or ID
 * - `{{time}}` - Current time (HH:MM:SS)
 * - `{{date}}` - Current date (YYYY-MM-DD)
 * - `{{message}}` - The original message content
 *
 * Unknown placeholders are left as-is.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const now = new Date();

  // Merge built-in defaults with provided vars (provided values take precedence)
  const resolved: TemplateVars = {
    time: formatTime(now),
    date: formatDate(now),
    ...vars,
  };

  return template.replace(/\{\{(\w+)}}/g, (_match, key: string) => {
    const value = resolved[key];
    return value !== undefined ? value : `{{${key}}}`;
  });
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
