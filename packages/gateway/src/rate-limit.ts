import type { Request, Response, NextFunction } from 'express';
import type { Logger } from '@hydraclaw/core';

/**
 * Configuration for the RateLimiter.
 */
export interface RateLimiterConfig {
  /** Maximum number of requests allowed in the time window. */
  maxRequests: number;
  /** Time window in milliseconds. Defaults to 60 000 (1 minute). */
  windowMs?: number;
  /** Maximum burst of requests allowed at once (token bucket capacity). */
  burstLimit?: number;
  /** Custom key resolver. Defaults to extracting `clientId` from the request or falling back to IP. */
  keyResolver?: (req: Request) => string;
  /** Whether to include rate-limit headers in responses. Defaults to true. */
  headers?: boolean;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  requestCount: number;
  windowStart: number;
}

/**
 * Token-bucket rate limiter with per-client tracking.
 *
 * Each client gets a bucket that refills at a steady rate over the configured
 * time window. The burst limit controls the maximum bucket capacity so short
 * spikes are tolerated while sustained abuse is blocked.
 */
export class RateLimiter {
  private config: Required<Omit<RateLimiterConfig, 'keyResolver'>> & Pick<RateLimiterConfig, 'keyResolver'>;
  private buckets = new Map<string, TokenBucket>();
  private logger: Logger;

  constructor(config: RateLimiterConfig, logger: Logger) {
    this.logger = logger;
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs ?? 60_000,
      burstLimit: config.burstLimit ?? Math.ceil(config.maxRequests * 1.5),
      keyResolver: config.keyResolver,
      headers: config.headers ?? true,
    };
  }

  // ---------------------------------------------------------------------------
  // Core check
  // ---------------------------------------------------------------------------

  /**
   * Check whether a request from `clientId` should be allowed.
   *
   * Returns an object describing the outcome:
   *   - `allowed` – whether the request may proceed
   *   - `remaining` – how many requests remain in the current window
   *   - `retryAfterMs` – milliseconds until the next token is available (0 when allowed)
   */
  check(clientId: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const now = Date.now();
    let bucket = this.buckets.get(clientId);

    if (!bucket) {
      bucket = {
        tokens: this.config.burstLimit,
        lastRefill: now,
        requestCount: 0,
        windowStart: now,
      };
      this.buckets.set(clientId, bucket);
    }

    // Refill tokens based on elapsed time
    this.refill(bucket, now);

    // Reset window counter if the window has elapsed
    if (now - bucket.windowStart >= this.config.windowMs) {
      bucket.requestCount = 0;
      bucket.windowStart = now;
    }

    if (bucket.tokens < 1 || bucket.requestCount >= this.config.maxRequests) {
      const msPerToken = this.config.windowMs / this.config.maxRequests;
      const retryAfterMs = Math.ceil(msPerToken - (now - bucket.lastRefill));
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(retryAfterMs, 1),
      };
    }

    bucket.tokens -= 1;
    bucket.requestCount += 1;

    const remaining = Math.min(
      Math.floor(bucket.tokens),
      this.config.maxRequests - bucket.requestCount,
    );

    return { allowed: true, remaining: Math.max(remaining, 0), retryAfterMs: 0 };
  }

  /**
   * Reset the rate-limit state for a specific client.
   */
  reset(clientId: string): void {
    this.buckets.delete(clientId);
    this.logger.debug(`Rate limit reset for client: ${clientId}`);
  }

  /**
   * Reset all clients.
   */
  resetAll(): void {
    this.buckets.clear();
  }

  // ---------------------------------------------------------------------------
  // Express middleware
  // ---------------------------------------------------------------------------

  /**
   * Returns an Express middleware that enforces rate limits.
   *
   * The client key is resolved (in order of precedence) via:
   *   1. Custom `keyResolver` supplied in config
   *   2. `req.clientId` (set by the auth middleware)
   *   3. `req.ip`
   */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
      const clientId = this.resolveKey(req);
      const result = this.check(clientId);

      if (this.config.headers) {
        res.setHeader('X-RateLimit-Limit', String(this.config.maxRequests));
        res.setHeader('X-RateLimit-Remaining', String(result.remaining));
        res.setHeader(
          'X-RateLimit-Reset',
          String(Math.ceil((Date.now() + this.config.windowMs) / 1000)),
        );
      }

      if (!result.allowed) {
        if (this.config.headers) {
          res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
        }
        this.logger.debug(`Rate limit exceeded for client: ${clientId}`);
        res.status(429).json({
          error: 'Too many requests',
          retryAfterMs: result.retryAfterMs,
        });
        return;
      }

      next();
    };
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /**
   * Return a snapshot of the current rate-limit state for all tracked clients.
   */
  stats(): Array<{ clientId: string; tokens: number; requestCount: number }> {
    const entries: Array<{ clientId: string; tokens: number; requestCount: number }> = [];
    for (const [clientId, bucket] of this.buckets) {
      entries.push({
        clientId,
        tokens: Math.floor(bucket.tokens),
        requestCount: bucket.requestCount,
      });
    }
    return entries;
  }

  /**
   * Prune tracking state for clients that have been idle longer than the window.
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [clientId, bucket] of this.buckets) {
      if (now - bucket.lastRefill > this.config.windowMs * 2) {
        this.buckets.delete(clientId);
        pruned++;
      }
    }
    return pruned;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private refill(bucket: TokenBucket, now: number): void {
    const elapsed = now - bucket.lastRefill;
    const refillRate = this.config.burstLimit / this.config.windowMs; // tokens per ms
    const newTokens = elapsed * refillRate;

    bucket.tokens = Math.min(bucket.tokens + newTokens, this.config.burstLimit);
    bucket.lastRefill = now;
  }

  private resolveKey(req: Request): string {
    if (this.config.keyResolver) {
      return this.config.keyResolver(req);
    }
    const clientId = (req as Record<string, unknown>).clientId;
    if (typeof clientId === 'string') {
      return clientId;
    }
    return req.ip ?? 'unknown';
  }
}
