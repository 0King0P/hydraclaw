import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Logger } from '@hydraclaw/core';

/**
 * Configuration for the GatewayAuth middleware.
 */
export interface GatewayAuthConfig {
  /** Shared secret used to sign and verify tokens. */
  secret: string;
  /** Token expiration time in milliseconds. Defaults to 24 hours. */
  tokenTtlMs?: number;
  /** Static API keys that are always valid (e.g. for service-to-service calls). */
  apiKeys?: string[];
  /** Paths that do not require authentication. */
  publicPaths?: string[];
}

interface TokenRecord {
  clientId: string;
  token: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Authentication manager for the HydraClaw gateway.
 *
 * Supports three authentication mechanisms:
 *   1. Bearer token (JWT-like HMAC tokens issued by `generateToken`)
 *   2. Static API key validation (via `x-api-key` header)
 *   3. Session tokens attached to WebSocket sessions
 */
export class GatewayAuth {
  private config: GatewayAuthConfig;
  private logger: Logger;
  private tokens = new Map<string, TokenRecord>();
  private revokedTokens = new Set<string>();
  private readonly defaultTtl: number;

  constructor(config: GatewayAuthConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.defaultTtl = config.tokenTtlMs ?? 24 * 60 * 60 * 1000; // 24h
  }

  // ---------------------------------------------------------------------------
  // Token management
  // ---------------------------------------------------------------------------

  /**
   * Generate an HMAC-signed token for the given client.
   */
  generateToken(clientId: string): string {
    const nonce = randomBytes(24).toString('hex');
    const expiresAt = Date.now() + this.defaultTtl;
    const payload = `${clientId}:${nonce}:${expiresAt}`;
    const signature = this.sign(payload);
    const token = `${Buffer.from(payload).toString('base64url')}.${signature}`;

    this.tokens.set(token, {
      clientId,
      token,
      createdAt: Date.now(),
      expiresAt,
    });

    this.logger.debug(`Token generated for client: ${clientId}`);
    return token;
  }

  /**
   * Validate a token string. Returns the client ID if valid, or `null` if
   * the token is invalid, expired, or has been revoked.
   */
  validateToken(token: string): string | null {
    if (this.revokedTokens.has(token)) {
      this.logger.debug('Token rejected: revoked');
      return null;
    }

    const dotIndex = token.indexOf('.');
    if (dotIndex === -1) {
      return null;
    }

    const encodedPayload = token.slice(0, dotIndex);
    const providedSignature = token.slice(dotIndex + 1);

    let payload: string;
    try {
      payload = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    } catch {
      return null;
    }

    // Verify HMAC signature
    const expectedSignature = this.sign(payload);
    if (!this.safeCompare(providedSignature, expectedSignature)) {
      this.logger.debug('Token rejected: invalid signature');
      return null;
    }

    // Parse payload
    const parts = payload.split(':');
    if (parts.length < 3) {
      return null;
    }

    const clientId = parts[0];
    const expiresAt = parseInt(parts[parts.length - 1], 10);

    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      this.logger.debug(`Token rejected: expired for client ${clientId}`);
      this.tokens.delete(token);
      return null;
    }

    return clientId;
  }

  /**
   * Revoke a previously issued token so it can no longer be used.
   */
  revokeToken(token: string): void {
    this.tokens.delete(token);
    this.revokedTokens.add(token);
    this.logger.debug('Token revoked');
  }

  // ---------------------------------------------------------------------------
  // API key validation
  // ---------------------------------------------------------------------------

  /**
   * Check whether the provided API key is in the static allowlist.
   */
  validateApiKey(apiKey: string): boolean {
    const keys = this.config.apiKeys ?? [];
    return keys.some((k) => this.safeCompare(k, apiKey));
  }

  // ---------------------------------------------------------------------------
  // Session token helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate a short-lived session token, useful for pairing a WebSocket
   * connection with an already-authenticated HTTP session.
   */
  generateSessionToken(clientId: string, ttlMs: number = 5 * 60 * 1000): string {
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + ttlMs;
    const payload = `session:${clientId}:${nonce}:${expiresAt}`;
    const signature = this.sign(payload);
    const token = `${Buffer.from(payload).toString('base64url')}.${signature}`;

    this.tokens.set(token, {
      clientId,
      token,
      createdAt: Date.now(),
      expiresAt,
    });

    return token;
  }

  // ---------------------------------------------------------------------------
  // Express middleware
  // ---------------------------------------------------------------------------

  /**
   * Create an Express middleware that authenticates incoming requests using
   * Bearer tokens or API keys.
   */
  createAuthMiddleware(
    config?: Partial<Pick<GatewayAuthConfig, 'publicPaths'>>,
  ): (req: Request, res: Response, next: NextFunction) => void {
    const publicPaths = new Set([
      ...(this.config.publicPaths ?? []),
      ...(config?.publicPaths ?? []),
    ]);

    return (req: Request, res: Response, next: NextFunction): void => {
      // Skip authentication for public paths
      if (publicPaths.has(req.path)) {
        next();
        return;
      }

      // Try Bearer token
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const clientId = this.validateToken(token);
        if (clientId) {
          (req as unknown as Record<string, unknown>).clientId = clientId;
          next();
          return;
        }
      }

      // Try API key header
      const apiKey = req.headers['x-api-key'] as string | undefined;
      if (apiKey && this.validateApiKey(apiKey)) {
        (req as unknown as Record<string, unknown>).clientId = `apikey:${apiKey.slice(0, 8)}`;
        next();
        return;
      }

      // Try query parameter token (for WebSocket upgrades)
      const queryToken = (req.query as Record<string, string | undefined>).token;
      if (queryToken) {
        const clientId = this.validateToken(queryToken);
        if (clientId) {
          (req as unknown as Record<string, unknown>).clientId = clientId;
          next();
          return;
        }
      }

      this.logger.debug(`Auth rejected: ${req.method} ${req.path}`);
      res.status(401).json({ error: 'Unauthorized' });
    };
  }

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------

  /**
   * Remove expired tokens from internal storage.
   */
  pruneExpiredTokens(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, record] of this.tokens) {
      if (now > record.expiresAt) {
        this.tokens.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.logger.debug(`Pruned ${pruned} expired token(s)`);
    }

    return pruned;
  }

  /**
   * Return diagnostic information about the current token state.
   */
  stats(): { activeTokens: number; revokedTokens: number } {
    return {
      activeTokens: this.tokens.size,
      revokedTokens: this.revokedTokens.size,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private sign(payload: string): string {
    return createHmac('sha256', this.config.secret).update(payload).digest('base64url');
  }

  private safeCompare(a: string, b: string): boolean {
    try {
      const bufA = Buffer.from(a, 'utf-8');
      const bufB = Buffer.from(b, 'utf-8');
      if (bufA.length !== bufB.length) {
        return false;
      }
      return timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }
}
