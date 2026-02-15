import type { InboundMessage } from '@hydraclaw/core';

export interface Route {
  id: string;
  name: string;
  priority: number;
  match: RouteMatcher;
  handler: RouteHandler;
  enabled: boolean;
}

export interface RouteMatcher {
  channelIds?: string[];
  senderIds?: string[];
  groupIds?: string[];
  contentPatterns?: string[];
  isGroup?: boolean;
  custom?: (message: InboundMessage) => boolean;
}

export interface RouteHandler {
  type: 'agent' | 'forward' | 'auto-reply' | 'webhook' | 'skill' | 'drop';
  config: Record<string, unknown>;
}

export interface RouteResult {
  matched: boolean;
  route?: Route;
  handler?: RouteHandler;
}
