export type {
  AutoReplyRule,
  AutoReplyTrigger,
  AutoReplyResponse,
  AutoReplyCondition,
  PollDefinition,
  PollVote,
  PollResults,
} from './types.js';

export { AutoReplyEngine, type AutoReplyResult } from './auto-reply.js';
export { PollManager } from './polls.js';
export { renderTemplate, type TemplateVars } from './templates.js';
