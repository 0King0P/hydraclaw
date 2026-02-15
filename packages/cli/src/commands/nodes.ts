import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig } from '@hydraclaw/core';

const NODES_FILE = resolve(homedir(), '.hydraclaw', 'nodes.json');

interface PairedNode {
  nodeId: string;
  address: string;
  pairedAt: number;
  lastSeen: number | null;
  label?: string;
}

interface NodesState {
  nodes: PairedNode[];
}

/**
 * Create the `hydraclaw nodes` command group.
 *
 * Subcommands:
 *   hydraclaw nodes list              - List connected nodes
 *   hydraclaw nodes pair <address>    - Pair with another node
 *   hydraclaw nodes unpair <nodeId>   - Remove pairing
 *   hydraclaw nodes status            - Show node network status
 */
export function createNodesCommand(): Command {
  const command = new Command('nodes');
  command.description('Manage multi-node HydraClaw network');

  // ─── list ───────────────────────────────────────────────────────────
  command
    .command('list')
    .description('List all paired nodes')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      const state = readNodesState();

      if (opts.json) {
        console.log(JSON.stringify(state.nodes, null, 2));
        return;
      }

      console.log(chalk.bold.cyan('\nPaired Nodes\n'));

      if (state.nodes.length === 0) {
        console.log(chalk.yellow('  No paired nodes.'));
        console.log(chalk.dim('  Pair with another node: hydraclaw nodes pair <address>'));
        return;
      }

      for (const node of state.nodes) {
        const label = node.label ? ` (${node.label})` : '';
        const pairedDate = new Date(node.pairedAt).toLocaleDateString();
        const lastSeen = node.lastSeen
          ? formatRelativeTime(node.lastSeen)
          : chalk.dim('never');

        console.log(`  ${chalk.bold(node.nodeId)}${chalk.dim(label)}`);
        console.log(`    Address:    ${node.address}`);
        console.log(`    Paired:     ${pairedDate}`);
        console.log(`    Last seen:  ${lastSeen}`);
        console.log();
      }

      console.log(chalk.dim(`  Total: ${state.nodes.length} paired node(s)`));
    });

  // ─── pair ───────────────────────────────────────────────────────────
  command
    .command('pair <address>')
    .description('Pair with another HydraClaw node')
    .option('--label <label>', 'Friendly label for the node')
    .option('--node-id <id>', 'Override the node ID (auto-detected by default)')
    .action(async (address: string, opts: { label?: string; nodeId?: string }) => {
      console.log(chalk.cyan(`Attempting to pair with node at ${address}...`));

      // Normalise the address
      const normalizedAddress = address.startsWith('http') ? address : `http://${address}`;

      // Probe the remote node's health endpoint
      let remoteNodeId: string;
      try {
        const healthUrl = `${normalizedAddress}/health`;
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });

        if (!response.ok) {
          console.error(chalk.red(`Node at ${address} responded with HTTP ${response.status}`));
          process.exit(1);
        }

        const health = await response.json() as { nodeId?: string; status?: string };
        remoteNodeId = opts.nodeId ?? health.nodeId ?? generateNodeId(address);

        console.log(chalk.green(`  Node is reachable (status: ${health.status ?? 'ok'})`));
      } catch (err) {
        console.error(chalk.red(`Cannot reach node at ${address}`));
        console.error(chalk.dim(err instanceof Error ? err.message : String(err)));

        // Allow pairing anyway if the user explicitly provides a node ID
        if (!opts.nodeId) {
          console.error(chalk.dim('\nTo pair with an unreachable node, provide --node-id explicitly.'));
          process.exit(1);
        }
        remoteNodeId = opts.nodeId;
        console.log(chalk.yellow('  Pairing anyway with explicit --node-id'));
      }

      const state = readNodesState();

      // Check if already paired
      const existing = state.nodes.find((n) => n.nodeId === remoteNodeId);
      if (existing) {
        existing.address = address;
        existing.lastSeen = Date.now();
        if (opts.label) existing.label = opts.label;
        writeNodesState(state);
        console.log(chalk.yellow(`\n  Node "${remoteNodeId}" was already paired. Address updated.`));
        return;
      }

      state.nodes.push({
        nodeId: remoteNodeId,
        address,
        pairedAt: Date.now(),
        lastSeen: Date.now(),
        label: opts.label,
      });

      writeNodesState(state);
      console.log(chalk.green(`\n  Paired with node: ${remoteNodeId}`));
      console.log(chalk.dim(`  Address: ${address}`));
    });

  // ─── unpair ─────────────────────────────────────────────────────────
  command
    .command('unpair <nodeId>')
    .description('Remove pairing with a node')
    .action((nodeId: string) => {
      const state = readNodesState();
      const index = state.nodes.findIndex((n) => n.nodeId === nodeId);

      if (index === -1) {
        console.error(chalk.red(`Node "${nodeId}" is not paired.`));
        process.exit(1);
      }

      const removed = state.nodes.splice(index, 1)[0];
      writeNodesState(state);

      console.log(chalk.green(`Unpaired from node: ${nodeId}`));
      console.log(chalk.dim(`  Address was: ${removed.address}`));
    });

  // ─── status ─────────────────────────────────────────────────────────
  command
    .command('status')
    .description('Show node network status with live connectivity checks')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (opts: { config?: string }) => {
      const config = loadConfig(opts.config);
      const state = readNodesState();

      console.log(chalk.bold.cyan('\nNode Network Status\n'));

      // Local node info
      console.log(chalk.bold('  Local Node:'));
      console.log(`    HTTP: http://${config.gateway.host}:${config.gateway.port}`);
      console.log(`    WS:   ws://${config.gateway.host}:${config.gateway.wsPort}`);

      // Check if local gateway is running
      try {
        const localHost = config.gateway.host === '0.0.0.0' ? '127.0.0.1' : config.gateway.host;
        const response = await fetch(`http://${localHost}:${config.gateway.port}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const health = await response.json() as { uptime?: number };
          console.log(`    Status: ${chalk.green('running')}`);
          if (health.uptime) {
            console.log(`    Uptime: ${formatUptime(health.uptime)}`);
          }
        } else {
          console.log(`    Status: ${chalk.yellow(`HTTP ${response.status}`)}`);
        }
      } catch {
        console.log(`    Status: ${chalk.red('not running')}`);
      }

      if (state.nodes.length === 0) {
        console.log(chalk.dim('\n  No paired remote nodes.'));
        return;
      }

      console.log(chalk.bold('\n  Remote Nodes:'));

      for (const node of state.nodes) {
        const label = node.label ? ` (${node.label})` : '';
        console.log(`\n    ${chalk.bold(node.nodeId)}${chalk.dim(label)}`);
        console.log(`      Address: ${node.address}`);

        // Probe remote node
        const normalizedAddress = node.address.startsWith('http')
          ? node.address
          : `http://${node.address}`;

        try {
          const response = await fetch(`${normalizedAddress}/health`, {
            signal: AbortSignal.timeout(5000),
          });

          if (response.ok) {
            const health = await response.json() as { uptime?: number; status?: string };
            console.log(`      Status:  ${chalk.green(health.status ?? 'ok')}`);
            if (health.uptime) {
              console.log(`      Uptime:  ${formatUptime(health.uptime)}`);
            }

            // Update last seen
            node.lastSeen = Date.now();
          } else {
            console.log(`      Status:  ${chalk.yellow(`HTTP ${response.status}`)}`);
          }
        } catch {
          console.log(`      Status:  ${chalk.red('unreachable')}`);
          if (node.lastSeen) {
            console.log(`      Last seen: ${formatRelativeTime(node.lastSeen)}`);
          }
        }
      }

      // Persist updated lastSeen timestamps
      writeNodesState(state);

      const reachableCount = state.nodes.filter((n) => {
        if (!n.lastSeen) return false;
        return Date.now() - n.lastSeen < 30_000; // Seen in last 30s
      }).length;

      console.log(chalk.dim(`\n  Network: ${reachableCount}/${state.nodes.length} remote node(s) reachable`));
    });

  return command;
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function readNodesState(): NodesState {
  try {
    if (!existsSync(NODES_FILE)) {
      return { nodes: [] };
    }
    const raw = readFileSync(NODES_FILE, 'utf-8');
    return JSON.parse(raw) as NodesState;
  } catch {
    return { nodes: [] };
  }
}

function writeNodesState(state: NodesState): void {
  const dir = resolve(homedir(), '.hydraclaw');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(NODES_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function generateNodeId(address: string): string {
  // Derive a stable node ID from the address
  const clean = address.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `node-${clean}`;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}
