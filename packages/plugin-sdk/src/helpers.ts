/**
 * Common utility helpers for plugin developers.
 */

// ---------------------------------------------------------------------------
// HTTP Client
// ---------------------------------------------------------------------------

export interface HttpClientOptions {
  /** Default headers sent with every request */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds. Defaults to 30000 */
  timeout?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
}

export interface HttpClient {
  get<T = unknown>(path: string, headers?: Record<string, string>): Promise<HttpResponse<T>>;
  post<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>>;
  put<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>>;
  delete<T = unknown>(path: string, headers?: Record<string, string>): Promise<HttpResponse<T>>;
}

/**
 * Create a pre-configured HTTP client backed by the native `fetch` API.
 */
export function createHttpClient(
  baseUrl: string,
  options?: HttpClientOptions,
): HttpClient {
  const defaultHeaders = options?.headers ?? {};
  const timeout = options?.timeout ?? 30_000;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<HttpResponse<T>> {
    const url = path.startsWith('http') ? path : `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    const headers: Record<string, string> = {
      ...defaultHeaders,
      ...extraHeaders,
    };

    if (body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') ?? '';
      const data = contentType.includes('application/json')
        ? ((await response.json()) as T)
        : ((await response.text()) as unknown as T);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get: <T>(path: string, headers?: Record<string, string>) =>
      request<T>('GET', path, undefined, headers),
    post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
      request<T>('POST', path, body, headers),
    put: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
      request<T>('PUT', path, body, headers),
    delete: <T>(path: string, headers?: Record<string, string>) =>
      request<T>('DELETE', path, undefined, headers),
  };
}

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

export interface RateLimiter {
  /** Acquire permission to proceed. Resolves when within limits, or rejects if maxWaitMs exceeded. */
  acquire(): Promise<void>;
  /** Number of remaining permits in the current window */
  remaining(): number;
  /** Reset the rate limiter */
  reset(): void;
}

/**
 * Create a sliding-window rate limiter that allows up to `maxPerMinute`
 * operations per 60-second window.
 */
export function rateLimiter(maxPerMinute: number): RateLimiter {
  const windowMs = 60_000;
  let timestamps: number[] = [];

  function pruneOld(): void {
    const cutoff = Date.now() - windowMs;
    timestamps = timestamps.filter((t) => t > cutoff);
  }

  return {
    async acquire(): Promise<void> {
      pruneOld();
      if (timestamps.length < maxPerMinute) {
        timestamps.push(Date.now());
        return;
      }

      // Wait until the oldest timestamp exits the window
      const oldest = timestamps[0];
      const waitMs = oldest + windowMs - Date.now() + 1;
      if (waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
      pruneOld();
      timestamps.push(Date.now());
    },

    remaining(): number {
      pruneOld();
      return Math.max(0, maxPerMinute - timestamps.length);
    },

    reset(): void {
      timestamps = [];
    },
  };
}

// ---------------------------------------------------------------------------
// Retry with Backoff
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of retries (default 3) */
  maxRetries?: number;
  /** Initial delay in ms (default 1000) */
  initialDelayMs?: number;
  /** Maximum delay in ms (default 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default 2) */
  multiplier?: number;
  /** Optional predicate to decide whether to retry a given error */
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Retry an async function with exponential backoff and jitter.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const initialDelayMs = options?.initialDelayMs ?? 1_000;
  const maxDelayMs = options?.maxDelayMs ?? 30_000;
  const multiplier = options?.multiplier ?? 2;
  const shouldRetry = options?.shouldRetry ?? (() => true);

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt > maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Jitter: randomize between 50%-100% of the computed delay
      const jitter = delay * (0.5 + Math.random() * 0.5);
      const actualDelay = Math.min(jitter, maxDelayMs);

      await new Promise<void>((resolve) => setTimeout(resolve, actualDelay));
      delay = Math.min(delay * multiplier, maxDelayMs);
    }
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Wrap an async function with a simple TTL-based cache.
 * The cache key is derived by JSON-serializing the function arguments.
 */
export function cacheResult<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  ttlMs: number,
): (...args: TArgs) => Promise<TResult> {
  const cache = new Map<string, CacheEntry<TResult>>();

  return async (...args: TArgs): Promise<TResult> => {
    const key = JSON.stringify(args);
    const now = Date.now();

    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = await fn(...args);
    cache.set(key, { value, expiresAt: now + ttlMs });

    // Lazy eviction of expired entries
    if (cache.size > 1000) {
      for (const [k, entry] of cache) {
        if (entry.expiresAt <= now) {
          cache.delete(k);
        }
      }
    }

    return value;
  };
}

// ---------------------------------------------------------------------------
// Safe JSON Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string safely, returning the parsed value or `undefined`
 * if parsing fails.
 */
export function parseJsonSafely<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Text Truncation
// ---------------------------------------------------------------------------

/**
 * Truncate text to `maxLength` characters, appending an ellipsis if truncated.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 3) {
    return text.slice(0, maxLength);
  }
  return text.slice(0, maxLength - 3) + '...';
}
