import type { InboundMessage } from '@hydraclaw/core';
import type { RouteMatcher } from './types.js';

/**
 * Check if the message's channel ID matches any of the matcher's channel IDs.
 */
export function matchChannel(message: InboundMessage, matcher: RouteMatcher): boolean {
  if (!matcher.channelIds || matcher.channelIds.length === 0) {
    return true;
  }
  return matcher.channelIds.includes(message.channelId);
}

/**
 * Check if the message's sender ID matches any of the matcher's sender IDs.
 * Supports allowlist-style matching.
 */
export function matchSender(message: InboundMessage, matcher: RouteMatcher): boolean {
  if (!matcher.senderIds || matcher.senderIds.length === 0) {
    return true;
  }
  return matcher.senderIds.some((pattern) => {
    if (pattern === '*') {
      return true;
    }
    if (pattern.endsWith('*')) {
      return message.senderId.startsWith(pattern.slice(0, -1));
    }
    return message.senderId === pattern;
  });
}

/**
 * Check if the message content matches any of the matcher's regex patterns.
 */
export function matchContent(message: InboundMessage, matcher: RouteMatcher): boolean {
  if (!matcher.contentPatterns || matcher.contentPatterns.length === 0) {
    return true;
  }
  return matcher.contentPatterns.some((pattern) => {
    try {
      const regex = new RegExp(pattern, 'i');
      return regex.test(message.content);
    } catch {
      return false;
    }
  });
}

/**
 * Check if the message's group ID matches any of the matcher's group IDs.
 * Also checks the isGroup flag if specified.
 */
export function matchGroup(message: InboundMessage, matcher: RouteMatcher): boolean {
  if (matcher.isGroup !== undefined && message.isGroup !== matcher.isGroup) {
    return false;
  }
  if (!matcher.groupIds || matcher.groupIds.length === 0) {
    return true;
  }
  if (!message.groupId) {
    return false;
  }
  return matcher.groupIds.includes(message.groupId);
}

/**
 * Composite AND matcher - all conditions must be satisfied.
 * Each individual matcher returns true if its criteria are not specified (vacuous truth),
 * so only explicitly set criteria are enforced.
 */
export function matchAll(message: InboundMessage, matcher: RouteMatcher): boolean {
  if (!matchChannel(message, matcher)) return false;
  if (!matchSender(message, matcher)) return false;
  if (!matchContent(message, matcher)) return false;
  if (!matchGroup(message, matcher)) return false;
  if (matcher.custom && !matcher.custom(message)) return false;
  return true;
}
