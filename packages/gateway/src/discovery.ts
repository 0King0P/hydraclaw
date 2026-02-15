import type { Logger, MessageBus } from '@hydraclaw/core';

/**
 * Represents a node in the gateway cluster.
 */
export interface DiscoveryNode {
  /** Unique identifier for the node (e.g. hostname or UUID). */
  nodeId: string;
  /** Reachable address including port, e.g. `192.168.1.10:3000`. */
  address: string;
  /** Timestamp (ms) when the node was first registered. */
  registeredAt: number;
  /** Timestamp (ms) of the most recent heartbeat. */
  lastHeartbeat: number;
  /** Arbitrary metadata attached to the node. */
  metadata?: Record<string, unknown>;
}

/**
 * Simple in-memory service discovery for multi-node HydraClaw setups.
 *
 * This implementation keeps all state in memory making it suitable for
 * single-process or small cluster deployments. For production multi-host
 * clusters it can be extended to use mDNS/Bonjour, etcd, Consul, or a
 * shared database.
 *
 * Lifecycle events are emitted via the message bus so other components can
 * react to topology changes:
 *   - `discovery:registered`   – a new node has joined
 *   - `discovery:deregistered` – a node has left
 *   - `discovery:heartbeat`    – a node reported in
 *   - `discovery:pruned`       – stale nodes were removed
 */
export class ServiceDiscovery {
  private nodes = new Map<string, DiscoveryNode>();
  private logger: Logger;
  private bus: MessageBus;

  constructor(logger: Logger, bus: MessageBus) {
    this.logger = logger;
    this.bus = bus;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a node in the discovery table. If the node already exists its
   * address and heartbeat are updated.
   */
  register(nodeId: string, address: string, metadata?: Record<string, unknown>): DiscoveryNode {
    const existing = this.nodes.get(nodeId);
    const now = Date.now();

    if (existing) {
      existing.address = address;
      existing.lastHeartbeat = now;
      if (metadata) {
        existing.metadata = { ...existing.metadata, ...metadata };
      }
      this.logger.info(`Node updated: ${nodeId} -> ${address}`);
      this.bus.emitSync('discovery:registered', { node: existing });
      return existing;
    }

    const node: DiscoveryNode = {
      nodeId,
      address,
      registeredAt: now,
      lastHeartbeat: now,
      metadata,
    };

    this.nodes.set(nodeId, node);
    this.logger.info(`Node registered: ${nodeId} -> ${address}`);
    this.bus.emitSync('discovery:registered', { node });
    return node;
  }

  /**
   * Remove a node from the discovery table.
   */
  deregister(nodeId: string): boolean {
    const removed = this.nodes.delete(nodeId);
    if (removed) {
      this.logger.info(`Node deregistered: ${nodeId}`);
      this.bus.emitSync('discovery:deregistered', { nodeId });
    }
    return removed;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Return all currently registered nodes.
   */
  getNodes(): DiscoveryNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Return a specific node by its ID, or `undefined` if not found.
   */
  getNode(nodeId: string): DiscoveryNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Return the number of registered nodes.
   */
  count(): number {
    return this.nodes.size;
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  /**
   * Update the heartbeat timestamp for a node. Returns `false` if the node
   * is not registered.
   */
  heartbeat(nodeId: string, metadata?: Record<string, unknown>): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) {
      this.logger.debug(`Heartbeat from unknown node: ${nodeId}`);
      return false;
    }

    node.lastHeartbeat = Date.now();
    if (metadata) {
      node.metadata = { ...node.metadata, ...metadata };
    }

    this.bus.emitSync('discovery:heartbeat', { nodeId, lastHeartbeat: node.lastHeartbeat });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------

  /**
   * Remove nodes whose last heartbeat is older than `maxAge` milliseconds.
   *
   * @param maxAge  Maximum age in milliseconds. Defaults to 60 000 (1 minute).
   * @returns       The list of pruned node IDs.
   */
  pruneStale(maxAge: number = 60_000): string[] {
    const now = Date.now();
    const pruned: string[] = [];

    for (const [nodeId, node] of this.nodes) {
      if (now - node.lastHeartbeat > maxAge) {
        this.nodes.delete(nodeId);
        pruned.push(nodeId);
        this.logger.info(`Pruned stale node: ${nodeId} (last heartbeat ${now - node.lastHeartbeat}ms ago)`);
      }
    }

    if (pruned.length > 0) {
      this.bus.emitSync('discovery:pruned', { pruned });
    }

    return pruned;
  }

  /**
   * Start an automatic prune interval that removes stale nodes periodically.
   *
   * @param intervalMs  How often to run the prune check. Defaults to 30 000 (30s).
   * @param maxAge      Maximum node staleness before pruning. Defaults to 60 000 (1m).
   * @returns           A handle that can be passed to `clearInterval`.
   */
  startAutoPrune(intervalMs: number = 30_000, maxAge: number = 60_000): NodeJS.Timeout {
    const handle = setInterval(() => {
      this.pruneStale(maxAge);
    }, intervalMs);

    // Unref so the timer does not keep the process alive
    if (typeof handle === 'object' && 'unref' in handle) {
      handle.unref();
    }

    this.logger.debug(`Auto-prune started: interval=${intervalMs}ms, maxAge=${maxAge}ms`);
    return handle;
  }

  /**
   * Return diagnostic info about the discovery state.
   */
  stats(): {
    totalNodes: number;
    oldestHeartbeat: number | null;
    newestHeartbeat: number | null;
  } {
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const node of this.nodes.values()) {
      if (oldest === null || node.lastHeartbeat < oldest) oldest = node.lastHeartbeat;
      if (newest === null || node.lastHeartbeat > newest) newest = node.lastHeartbeat;
    }

    return {
      totalNodes: this.nodes.size,
      oldestHeartbeat: oldest,
      newestHeartbeat: newest,
    };
  }
}
