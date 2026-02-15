import { randomUUID } from 'node:crypto';
import { cpus, totalmem, freemem } from 'node:os';
import { createLogger } from '@hydraclaw/core';
import type { NodeInfo } from './types.js';

const logger = createLogger({ name: 'pairing:node-host' });

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const VERSION = '1.0.0';

type RPCHandler = (params: unknown) => Promise<unknown>;

export interface NodeHostConfig {
  id?: string;
  name?: string;
  address?: string;
  port?: number;
  capabilities?: string[];
  heartbeatInterval?: number;
  discoveryUrl?: string;
}

export class NodeHost {
  private id: string;
  private nodeName: string;
  private address: string;
  private port: number;
  private capabilities: string[];
  private heartbeatInterval: number;
  private discoveryUrl: string | null;
  private status: NodeInfo['status'] = 'offline';
  private activeSessions = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private rpcHandlers = new Map<string, RPCHandler>();
  private registered = false;

  constructor(config: NodeHostConfig = {}) {
    this.id = config.id ?? randomUUID();
    this.nodeName = config.name ?? `node-${this.id.slice(0, 8)}`;
    this.address = config.address ?? '0.0.0.0';
    this.port = config.port ?? 0;
    this.capabilities = config.capabilities ?? [];
    this.heartbeatInterval = config.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.discoveryUrl = config.discoveryUrl ?? null;

    logger.debug('NodeHost created', {
      id: this.id,
      name: this.nodeName,
      capabilities: this.capabilities,
    });
  }

  /**
   * Register this node with the discovery service and start heartbeats.
   */
  async register(): Promise<void> {
    if (this.registered) {
      logger.warn('Node is already registered');
      return;
    }

    logger.info('Registering node with discovery service', {
      id: this.id,
      name: this.nodeName,
      address: this.address,
      port: this.port,
    });

    if (this.discoveryUrl) {
      try {
        const nodeInfo = this.buildNodeInfo();

        const response = await fetch(`${this.discoveryUrl}/nodes/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nodeInfo),
        });

        if (!response.ok) {
          throw new Error(`Registration failed: ${response.status} ${response.statusText}`);
        }

        logger.info('Node registered with discovery service');
      } catch (err) {
        logger.error('Failed to register with discovery service', { error: err });
        throw err;
      }
    }

    this.status = 'ready';
    this.registered = true;

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat().catch((err) => {
        logger.error('Heartbeat failed', { error: err });
      });
    }, this.heartbeatInterval);

    logger.info('Node is now ready', { id: this.id, name: this.nodeName });
  }

  /**
   * Deregister this node from the discovery service and stop heartbeats.
   */
  async deregister(): Promise<void> {
    if (!this.registered) {
      logger.warn('Node is not registered');
      return;
    }

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.discoveryUrl) {
      try {
        const response = await fetch(`${this.discoveryUrl}/nodes/${this.id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          logger.warn('Failed to deregister from discovery service', {
            status: response.status,
          });
        }
      } catch (err) {
        logger.error('Failed to deregister from discovery service', { error: err });
      }
    }

    this.status = 'offline';
    this.registered = false;

    logger.info('Node deregistered', { id: this.id });
  }

  /**
   * Send a heartbeat to the discovery service with current status and load.
   */
  async heartbeat(): Promise<void> {
    if (!this.registered) return;

    const nodeInfo = this.buildNodeInfo();

    if (this.discoveryUrl) {
      try {
        const response = await fetch(`${this.discoveryUrl}/nodes/${this.id}/heartbeat`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nodeInfo),
        });

        if (!response.ok) {
          logger.warn('Heartbeat request failed', { status: response.status });
        }
      } catch (err) {
        logger.warn('Heartbeat failed', { error: err });
      }
    }

    logger.debug('Heartbeat sent', {
      id: this.id,
      status: this.status,
      load: nodeInfo.load,
    });
  }

  /**
   * Get the current status of this node.
   */
  getStatus(): NodeInfo['status'] {
    return this.status;
  }

  /**
   * Set the node status.
   */
  setStatus(status: NodeInfo['status']): void {
    const previous = this.status;
    this.status = status;

    logger.debug('Node status changed', { from: previous, to: status });
  }

  /**
   * Get the current load metrics for this node.
   */
  getLoad(): NodeInfo['load'] {
    return {
      cpu: this.getCpuUsage(),
      memory: this.getMemoryUsage(),
      activeSessions: this.activeSessions,
    };
  }

  /**
   * Get the full node info.
   */
  getNodeInfo(): NodeInfo {
    return this.buildNodeInfo();
  }

  /**
   * Increment the active session count.
   */
  addSession(): void {
    this.activeSessions++;

    logger.debug('Session added', { activeSessions: this.activeSessions });
  }

  /**
   * Decrement the active session count.
   */
  removeSession(): void {
    if (this.activeSessions > 0) {
      this.activeSessions--;
    }

    logger.debug('Session removed', { activeSessions: this.activeSessions });
  }

  /**
   * Handle an incoming RPC call.
   */
  async handleRPC(method: string, params: unknown): Promise<unknown> {
    const handler = this.rpcHandlers.get(method);
    if (!handler) {
      throw new Error(`Unknown RPC method: ${method}`);
    }

    logger.debug('Handling RPC call', { method });

    try {
      const result = await handler(params);
      logger.debug('RPC call completed', { method });
      return result;
    } catch (err) {
      logger.error('RPC call failed', { method, error: err });
      throw err;
    }
  }

  /**
   * Register an RPC handler for a specific method.
   */
  registerRPCHandler(method: string, handler: RPCHandler): void {
    this.rpcHandlers.set(method, handler);
    logger.debug('RPC handler registered', { method });
  }

  /**
   * Unregister an RPC handler.
   */
  unregisterRPCHandler(method: string): void {
    this.rpcHandlers.delete(method);
    logger.debug('RPC handler unregistered', { method });
  }

  /**
   * Get the node ID.
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get the node name.
   */
  getName(): string {
    return this.nodeName;
  }

  /**
   * Clean up resources.
   */
  async destroy(): Promise<void> {
    if (this.registered) {
      await this.deregister();
    }

    this.rpcHandlers.clear();

    logger.debug('NodeHost destroyed');
  }

  private buildNodeInfo(): NodeInfo {
    return {
      id: this.id,
      name: this.nodeName,
      version: VERSION,
      address: this.address,
      port: this.port,
      capabilities: [...this.capabilities],
      load: this.getLoad(),
      status: this.status,
    };
  }

  private getCpuUsage(): number {
    const cpuList = cpus();
    if (cpuList.length === 0) return 0;

    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpuList) {
      const { user, nice, sys, idle, irq } = cpu.times;
      totalTick += user + nice + sys + idle + irq;
      totalIdle += idle;
    }

    return totalTick === 0 ? 0 : Math.round((1 - totalIdle / totalTick) * 100) / 100;
  }

  private getMemoryUsage(): number {
    const total = totalmem();
    const free = freemem();

    return total === 0 ? 0 : Math.round(((total - free) / total) * 100) / 100;
  }
}
