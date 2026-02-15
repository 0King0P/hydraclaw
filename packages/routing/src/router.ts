import type { InboundMessage } from '@hydraclaw/core';
import type { Route, RouteResult } from './types.js';
import { matchAll } from './matchers.js';

/**
 * MessageRouter - Core routing engine for inbound messages.
 *
 * Routes are evaluated in priority order (lower number = higher priority).
 * The first matching, enabled route wins.
 */
export class MessageRouter {
  private routes: Map<string, Route> = new Map();

  /**
   * Register a new route. If a route with the same ID already exists, it is replaced.
   */
  addRoute(route: Route): void {
    this.routes.set(route.id, route);
  }

  /**
   * Remove a route by its ID.
   * Returns true if the route was found and removed, false otherwise.
   */
  removeRoute(id: string): boolean {
    return this.routes.delete(id);
  }

  /**
   * Find the first matching route for an inbound message.
   * Routes are evaluated in priority order (lower priority number = evaluated first).
   * Only enabled routes are considered.
   */
  route(message: InboundMessage): RouteResult {
    const sorted = this.getSortedRoutes();

    for (const route of sorted) {
      if (!route.enabled) {
        continue;
      }

      if (matchAll(message, route.match)) {
        return {
          matched: true,
          route,
          handler: route.handler,
        };
      }
    }

    return { matched: false };
  }

  /**
   * Get all registered routes, sorted by priority (lower number first).
   */
  getRoutes(): Route[] {
    return this.getSortedRoutes();
  }

  /**
   * Get a specific route by ID.
   */
  getRoute(id: string): Route | undefined {
    return this.routes.get(id);
  }

  /**
   * Enable a route by ID. Returns true if the route was found.
   */
  enableRoute(id: string): boolean {
    const route = this.routes.get(id);
    if (route) {
      route.enabled = true;
      return true;
    }
    return false;
  }

  /**
   * Disable a route by ID. Returns true if the route was found.
   */
  disableRoute(id: string): boolean {
    const route = this.routes.get(id);
    if (route) {
      route.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * Remove all routes.
   */
  clear(): void {
    this.routes.clear();
  }

  /**
   * Get the number of registered routes.
   */
  get size(): number {
    return this.routes.size;
  }

  private getSortedRoutes(): Route[] {
    return [...this.routes.values()].sort((a, b) => a.priority - b.priority);
  }
}
