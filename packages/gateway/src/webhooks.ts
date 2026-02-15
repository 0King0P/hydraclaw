import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type { Logger, MessageBus } from '@hydraclaw/core';

/**
 * Handler invoked when an incoming webhook request is received.
 */
export type IncomingWebhookHandler = (
  payload: unknown,
  headers: Record<string, string | string[] | undefined>,
) => Promise<{ status?: number; body?: unknown } | void>;

/**
 * Registration for an incoming webhook endpoint.
 */
export interface IncomingWebhook {
  id: string;
  /** URL path (e.g. `/hooks/github`). Will be prefixed if needed. */
  path: string;
  /** The handler to call when a request hits this path. */
  handler: IncomingWebhookHandler;
  /** Optional shared secret for HMAC signature verification. */
  secret?: string;
  /** Which header contains the HMAC signature. Defaults to `x-hub-signature-256`. */
  signatureHeader?: string;
}

/**
 * Registration for an outgoing webhook.
 */
export interface OutgoingWebhook {
  id: string;
  /** The remote URL to POST to. */
  url: string;
  /** Events this webhook should receive. Use `['*']` for all events. */
  events: string[];
  /** Optional shared secret. If set, a `X-HydraClaw-Signature` header is added. */
  secret?: string;
  /** Additional static headers to include in every request. */
  headers?: Record<string, string>;
  /** Whether this webhook is currently active. Defaults to true. */
  active?: boolean;
}

interface OutgoingDeliveryResult {
  webhookId: string;
  event: string;
  statusCode: number | null;
  success: boolean;
  error?: string;
  timestamp: number;
}

/**
 * Manages incoming and outgoing webhooks for the gateway.
 *
 * Incoming webhooks register Express routes that accept POST requests and
 * optionally verify HMAC signatures. Outgoing webhooks dispatch events to
 * remote URLs with optional signature headers.
 */
export class WebhookManager {
  private logger: Logger;
  private bus: MessageBus;

  private incoming = new Map<string, IncomingWebhook>();
  private outgoing = new Map<string, OutgoingWebhook>();
  private router: Router;
  private deliveryLog: OutgoingDeliveryResult[] = [];
  private maxDeliveryLog = 200;

  constructor(logger: Logger, bus: MessageBus) {
    this.logger = logger;
    this.bus = bus;
    this.router = createRouter();
  }

  // ---------------------------------------------------------------------------
  // Incoming webhooks
  // ---------------------------------------------------------------------------

  /**
   * Register an incoming webhook endpoint.
   *
   * The route is mounted on the internal router and will handle POST requests
   * at the given path.
   */
  registerIncoming(id: string, path: string, handler: IncomingWebhookHandler, options?: { secret?: string; signatureHeader?: string }): void {
    if (this.incoming.has(id)) {
      throw new Error(`Incoming webhook "${id}" is already registered`);
    }

    const webhook: IncomingWebhook = {
      id,
      path,
      handler,
      secret: options?.secret,
      signatureHeader: options?.signatureHeader ?? 'x-hub-signature-256',
    };

    this.incoming.set(id, webhook);

    // Mount the route
    this.router.post(path, async (req: Request, res: Response) => {
      await this.handleIncoming(req, res, webhook);
    });

    this.logger.info(`Incoming webhook registered: ${id} -> POST ${path}`);
  }

  /**
   * Register an outgoing webhook.
   */
  registerOutgoing(id: string, url: string, events: string[], options?: { secret?: string; headers?: Record<string, string> }): void {
    if (this.outgoing.has(id)) {
      throw new Error(`Outgoing webhook "${id}" is already registered`);
    }

    this.outgoing.set(id, {
      id,
      url,
      events,
      secret: options?.secret,
      headers: options?.headers,
      active: true,
    });

    this.logger.info(`Outgoing webhook registered: ${id} -> ${url} (events: ${events.join(', ')})`);
  }

  /**
   * Remove a webhook (incoming or outgoing) by ID.
   */
  removeWebhook(id: string): boolean {
    const removedIn = this.incoming.delete(id);
    const removedOut = this.outgoing.delete(id);
    const removed = removedIn || removedOut;

    if (removed) {
      this.logger.info(`Webhook removed: ${id}`);
    }

    return removed;
  }

  // ---------------------------------------------------------------------------
  // Incoming handler
  // ---------------------------------------------------------------------------

  /**
   * Process an incoming webhook request. This is called automatically by the
   * Express router but can also be invoked manually for testing.
   */
  async handleIncoming(req: Request, res: Response, webhook?: IncomingWebhook): Promise<void> {
    // If no webhook is provided, look it up by path
    const hook = webhook ?? this.findIncomingByPath(req.path);
    if (!hook) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    // Verify signature if a secret is configured
    if (hook.secret) {
      const signatureHeader = hook.signatureHeader ?? 'x-hub-signature-256';
      const providedSignature = req.headers[signatureHeader] as string | undefined;

      if (!providedSignature) {
        this.logger.warn(`Webhook ${hook.id}: missing signature header "${signatureHeader}"`);
        res.status(401).json({ error: 'Missing signature' });
        return;
      }

      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!this.verifySignature(body, providedSignature, hook.secret)) {
        this.logger.warn(`Webhook ${hook.id}: invalid signature`);
        res.status(403).json({ error: 'Invalid signature' });
        return;
      }
    }

    try {
      const result = await hook.handler(req.body, req.headers as Record<string, string | string[] | undefined>);

      this.bus.emitSync('webhook:incoming', { webhookId: hook.id, path: hook.path });

      if (result) {
        res.status(result.status ?? 200).json(result.body ?? { ok: true });
      } else {
        res.status(200).json({ ok: true });
      }
    } catch (err) {
      this.logger.error(`Webhook ${hook.id} handler error: ${err}`);
      res.status(500).json({ error: 'Internal webhook error' });
    }
  }

  // ---------------------------------------------------------------------------
  // Outgoing dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatch an event to all outgoing webhooks that subscribe to it.
   *
   * @returns The number of webhooks the event was dispatched to.
   */
  async dispatchOutgoing(event: string, data: unknown): Promise<number> {
    const matching = Array.from(this.outgoing.values()).filter(
      (wh) =>
        wh.active !== false &&
        (wh.events.includes('*') || wh.events.includes(event)),
    );

    if (matching.length === 0) {
      return 0;
    }

    const body = JSON.stringify({ event, data, timestamp: Date.now() });

    const deliveries = await Promise.allSettled(
      matching.map((wh) => this.deliverOutgoing(wh, event, body)),
    );

    let sent = 0;
    for (const d of deliveries) {
      if (d.status === 'fulfilled' && d.value.success) sent++;
    }

    this.logger.debug(`Dispatched event "${event}" to ${sent}/${matching.length} webhook(s)`);
    return sent;
  }

  // ---------------------------------------------------------------------------
  // Router & queries
  // ---------------------------------------------------------------------------

  /**
   * Return the Express router containing all incoming webhook routes.
   * Mount this on the main app, e.g. `app.use('/webhooks', manager.getRouter())`.
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * List all registered webhooks.
   */
  listWebhooks(): {
    incoming: Array<{ id: string; path: string }>;
    outgoing: Array<{ id: string; url: string; events: string[]; active: boolean }>;
  } {
    return {
      incoming: Array.from(this.incoming.values()).map((wh) => ({
        id: wh.id,
        path: wh.path,
      })),
      outgoing: Array.from(this.outgoing.values()).map((wh) => ({
        id: wh.id,
        url: wh.url,
        events: wh.events,
        active: wh.active !== false,
      })),
    };
  }

  /**
   * Return recent outgoing delivery log entries.
   */
  getDeliveryLog(limit: number = 50): OutgoingDeliveryResult[] {
    return this.deliveryLog.slice(-limit);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private findIncomingByPath(path: string): IncomingWebhook | undefined {
    for (const wh of this.incoming.values()) {
      if (wh.path === path) return wh;
    }
    return undefined;
  }

  /**
   * Verify an HMAC-SHA256 signature.
   *
   * Supports both plain hex signatures and `sha256=<hex>` prefixed signatures
   * (GitHub-style).
   */
  private verifySignature(body: string, providedSignature: string, secret: string): boolean {
    const expectedHex = createHmac('sha256', secret).update(body).digest('hex');

    // Handle `sha256=<hex>` format
    const normalized = providedSignature.startsWith('sha256=')
      ? providedSignature.slice(7)
      : providedSignature;

    try {
      const bufA = Buffer.from(normalized, 'hex');
      const bufB = Buffer.from(expectedHex, 'hex');
      if (bufA.length !== bufB.length) return false;
      return timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  /**
   * Deliver a payload to a single outgoing webhook.
   */
  private async deliverOutgoing(
    webhook: OutgoingWebhook,
    event: string,
    body: string,
  ): Promise<OutgoingDeliveryResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'HydraClaw-Webhook/1.0',
      'X-HydraClaw-Event': event,
      ...webhook.headers,
    };

    if (webhook.secret) {
      const signature = createHmac('sha256', webhook.secret).update(body).digest('hex');
      headers['X-HydraClaw-Signature'] = `sha256=${signature}`;
    }

    const result: OutgoingDeliveryResult = {
      webhookId: webhook.id,
      event,
      statusCode: null,
      success: false,
      timestamp: Date.now(),
    };

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });

      result.statusCode = response.status;
      result.success = response.ok;

      if (!response.ok) {
        result.error = `HTTP ${response.status}: ${response.statusText}`;
        this.logger.warn(`Outgoing webhook ${webhook.id} failed: ${result.error}`);
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Outgoing webhook ${webhook.id} delivery error: ${result.error}`);
    }

    // Add to delivery log (bounded)
    this.deliveryLog.push(result);
    if (this.deliveryLog.length > this.maxDeliveryLog) {
      this.deliveryLog.splice(0, this.deliveryLog.length - this.maxDeliveryLog);
    }

    this.bus.emitSync('webhook:outgoing', {
      webhookId: webhook.id,
      event,
      success: result.success,
    });

    return result;
  }
}
