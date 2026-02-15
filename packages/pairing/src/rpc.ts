import { randomUUID } from 'node:crypto';
import { createLogger } from '@hydraclaw/core';

const logger = createLogger({ name: 'pairing:rpc' });

const DEFAULT_TIMEOUT_MS = 30_000;
const JSON_RPC_VERSION = '2.0';

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC 2.0 error codes
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

type RPCMethodHandler = (params: unknown) => Promise<unknown>;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface RPCClientConfig {
  url: string;
  timeout?: number;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

/**
 * JSON-RPC 2.0 client over WebSocket.
 * Sends RPC calls to remote nodes and handles responses.
 */
export class RPCClient {
  private url: string;
  private timeout: number;
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private reconnect: boolean;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private destroyed = false;

  constructor(config: RPCClientConfig) {
    this.url = config.url;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this.reconnect = config.reconnect ?? true;
    this.reconnectInterval = config.reconnectInterval ?? 5_000;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;

    logger.debug('RPCClient created', { url: this.url, timeout: this.timeout });
  }

  /**
   * Connect to the remote RPC server.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        reject(new Error(`Failed to create WebSocket connection: ${err}`));
        return;
      }

      this.ws.addEventListener('open', () => {
        this.connected = true;
        this.reconnectAttempts = 0;

        logger.debug('RPC client connected', { url: this.url });
        resolve();
      });

      this.ws.addEventListener('message', (event) => {
        this.handleMessage(event.data as string);
      });

      this.ws.addEventListener('close', () => {
        this.connected = false;
        logger.debug('RPC client disconnected', { url: this.url });

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Connection closed'));
          this.pendingRequests.delete(id);
        }

        // Attempt reconnection
        if (this.reconnect && !this.destroyed) {
          this.attemptReconnect();
        }
      });

      this.ws.addEventListener('error', (event) => {
        logger.error('RPC client WebSocket error', { url: this.url, error: event });
        if (!this.connected) {
          reject(new Error(`WebSocket connection failed: ${this.url}`));
        }
      });
    });
  }

  /**
   * Make an RPC call to the remote server.
   */
  async call(method: string, params?: unknown): Promise<unknown> {
    if (!this.connected || !this.ws) {
      throw new Error('RPC client is not connected');
    }

    const id = randomUUID();

    const request: JSONRPCRequest = {
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      params,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC call "${method}" timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.ws!.send(JSON.stringify(request));

      logger.debug('RPC call sent', { id, method });
    });
  }

  /**
   * Send a notification (no response expected).
   */
  notify(method: string, params?: unknown): void {
    if (!this.connected || !this.ws) {
      throw new Error('RPC client is not connected');
    }

    const notification = {
      jsonrpc: JSON_RPC_VERSION,
      method,
      params,
    };

    this.ws.send(JSON.stringify(notification));

    logger.debug('RPC notification sent', { method });
  }

  /**
   * Disconnect from the remote server.
   */
  disconnect(): void {
    this.destroyed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }

    this.connected = false;

    // Clean up pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disconnected'));
    }
    this.pendingRequests.clear();

    logger.debug('RPC client disconnected');
  }

  /**
   * Check if the client is connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  private handleMessage(data: string): void {
    let response: JSONRPCResponse;

    try {
      response = JSON.parse(data);
    } catch {
      logger.warn('Received invalid JSON from RPC server', { data: data.slice(0, 200) });
      return;
    }

    if (response.jsonrpc !== JSON_RPC_VERSION) {
      logger.warn('Received non-JSON-RPC 2.0 message');
      return;
    }

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      logger.warn('Received response for unknown request', { id: response.id });
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(`RPC error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached', {
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
      });
      return;
    }

    this.reconnectAttempts++;

    const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 5);

    logger.debug('Scheduling reconnect', {
      attempt: this.reconnectAttempts,
      delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        logger.error('Reconnect failed', { error: err, attempt: this.reconnectAttempts });
      });
    }, delay);
  }
}

export interface RPCServerConfig {
  port?: number;
  host?: string;
}

/**
 * JSON-RPC 2.0 server that handles incoming RPC calls.
 * Designed to work with any WebSocket server implementation.
 */
export class RPCServer {
  private handlers = new Map<string, RPCMethodHandler>();

  constructor(_config: RPCServerConfig = {}) {
    logger.debug('RPCServer created');
  }

  /**
   * Register an RPC method handler.
   */
  registerHandler(method: string, handler: RPCMethodHandler): void {
    if (this.handlers.has(method)) {
      logger.warn('Overwriting existing RPC handler', { method });
    }

    this.handlers.set(method, handler);
    logger.debug('RPC handler registered', { method });
  }

  /**
   * Unregister an RPC method handler.
   */
  unregisterHandler(method: string): void {
    this.handlers.delete(method);
    logger.debug('RPC handler unregistered', { method });
  }

  /**
   * List all registered method names.
   */
  getMethods(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Process an incoming JSON-RPC message and return the response.
   * This should be called by the WebSocket message handler.
   */
  async handleMessage(rawMessage: string): Promise<string | null> {
    let request: JSONRPCRequest;

    try {
      request = JSON.parse(rawMessage);
    } catch {
      return JSON.stringify(this.createErrorResponse('', RPC_ERRORS.PARSE_ERROR, 'Parse error'));
    }

    // Validate the request
    if (request.jsonrpc !== JSON_RPC_VERSION || !request.method) {
      return JSON.stringify(
        this.createErrorResponse(request.id ?? '', RPC_ERRORS.INVALID_REQUEST, 'Invalid request')
      );
    }

    // Check if this is a notification (no id = no response)
    if (!request.id) {
      await this.executeHandler(request.method, request.params);
      return null;
    }

    // Find the handler
    const handler = this.handlers.get(request.method);
    if (!handler) {
      return JSON.stringify(
        this.createErrorResponse(request.id, RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${request.method}`)
      );
    }

    // Execute the handler
    try {
      const result = await handler(request.params);

      const response: JSONRPCResponse = {
        jsonrpc: JSON_RPC_VERSION,
        id: request.id,
        result,
      };

      return JSON.stringify(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';

      return JSON.stringify(
        this.createErrorResponse(request.id, RPC_ERRORS.INTERNAL_ERROR, message)
      );
    }
  }

  /**
   * Process a batch of JSON-RPC requests.
   */
  async handleBatch(rawMessage: string): Promise<string> {
    let requests: JSONRPCRequest[];

    try {
      requests = JSON.parse(rawMessage);
    } catch {
      return JSON.stringify(this.createErrorResponse('', RPC_ERRORS.PARSE_ERROR, 'Parse error'));
    }

    if (!Array.isArray(requests) || requests.length === 0) {
      return JSON.stringify(
        this.createErrorResponse('', RPC_ERRORS.INVALID_REQUEST, 'Invalid batch request')
      );
    }

    const responses = await Promise.all(
      requests.map((req) => this.handleMessage(JSON.stringify(req)))
    );

    // Filter out null responses (notifications)
    const validResponses = responses.filter((r): r is string => r !== null);

    return `[${validResponses.join(',')}]`;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.handlers.clear();
    logger.debug('RPCServer destroyed');
  }

  private async executeHandler(method: string, params: unknown): Promise<void> {
    const handler = this.handlers.get(method);
    if (!handler) {
      logger.warn('No handler for notification method', { method });
      return;
    }

    try {
      await handler(params);
    } catch (err) {
      logger.error('Notification handler error', { method, error: err });
    }
  }

  private createErrorResponse(id: string, code: number, message: string): JSONRPCResponse {
    return {
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: { code, message },
    };
  }
}
